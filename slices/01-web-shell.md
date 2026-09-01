# Slice 1 — Web shell, deployed

Prove the Next.js → OpenNext → Workers pipeline with a bare app before any backend exists.

```bash
mkdir -p apps && cd apps
# Every prompt answered as a flag, so nothing blocks on stdin. Check `--help` first: this
# CLI's flag set moves between majors. Tailwind must be yes — a later slice themes what it
# scaffolds rather than installing its own.
pnpm create next-app@latest web --src-dir --ts --app --tailwind --eslint \
  --import-alias "@/*" --use-pnpm --disable-git --skip-install
cd web
```

**Checked against `create-next-app@16.3.3`** — every flag above still exists in the 16 line
and still means what it says. What _moved_ is worth knowing anyway, because it is what breaks
an older recipe copied forward: `--turbopack` is gone, since Turbopack is now the default
bundler and `--rspack` is the way out of it; `--biome` has joined `--eslint` as a linter
choice; and `--agents-md` is new and **on by default**, which is what writes the `AGENTS.md`
discussed a few blocks down. `--ts`, `--tailwind` and `--app` are also defaults in 16, but
they stay spelled out: a default is someone else's decision to change later, and this repo
depends on all three.

`--skip-install` is the important one, and it is why the next block can be trusted:
create-next-app otherwise installs _before_ you have deleted the standalone-repo files
below, which is the one moment the nested workspace can actually build a second dependency
tree. Skipping the install makes that trap unreachable rather than merely survivable — the
root `pnpm install` a few blocks down is the first install this app ever gets.

`--src-dir` is passed explicitly because create-next-app's `src/` prompt **defaults to No**,
and accepting that default puts `app/` at the package root. This repo wants `src/`: the Slice 0
standard-package contract gives every other package `"include": ["src"]` and a vitest config
globbing `src/**/*.test.ts` (and turbo's `codegen` task declares `outputs: ["src/generated/**"]`).
Taking Next's default here would make `apps/web` the one package needing a divergent copy of a
config block that is otherwise identical in four places. If you already scaffolded without it:
`mkdir -p src && mv app src/app`, then repoint the alias in `tsconfig.json` from
`"@/*": ["./*"]` to `"@/*": ["./src/*"]`.

**`create-next-app` scaffolds a standalone repo, not a workspace member — undo that first.**
It writes its own `pnpm-workspace.yaml`, `pnpm-lock.yaml`, and `packageManager` field into
`apps/web`, which makes `apps/web` the **root of its own pnpm workspace**: `pnpm` resolves the
workspace root by walking _up_ to the nearest `pnpm-workspace.yaml`, so it stops at `apps/web`
and never sees yours. Every install run from that directory then builds a second, parallel
dependency tree in `apps/web/node_modules` against a second lockfile — `@__PROJECT__/*`
workspace links silently fail to resolve, and the root `pnpm install` manages none of it.
Delete all three before installing anything:

```bash
rm -f pnpm-workspace.yaml pnpm-lock.yaml
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));delete p.packageManager;fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")'
```

(The nested `pnpm-workspace.yaml` is also where create-next-app parks its own `allowBuilds`
list. What it puts there varies by version — literal `set this to true or false`
placeholders in some, real `sharp`/`unrs-resolver` entries in others — and the first shape
raises `ERR_PNPM_IGNORED_BUILDS`. Do not bother matching the version: Slice 0's root block
already answers that question for the whole workspace, so deleting the file is the whole fix
either way. `packageManager` goes because it's a root-marker field, and the root
already pins the exact pnpm version.)

Then the package name, the Cloudflare adapter, and the shared TypeScript:

```bash
pnpm pkg set name="@__PROJECT__/web"   # create-next-app names it "web"; --filter deploys in Slice 2 need the scoped name
pnpm add @opennextjs/cloudflare@latest
pnpm add -D wrangler@latest
pnpm add -D typescript@catalog:      # create-next-app pins ^5; the catalog is the workspace's single answer
pnpm add -D eslint@catalog:          # same reason: create-next-app pins a bare ^9 of its own
pnpm add -D @types/node@catalog:     # and again: it scaffolds ^20 while .nvmrc says 24
```

**The adapter and Next are pinned to each other far more tightly than two `@latest`s
suggest.** `@opennextjs/cloudflare@1.20.4` declares `next: ">=15.5.24 <16 || >=16.3.3"` and
`wrangler: "^4.125.0"`, and `create-next-app@latest` currently scaffolds Next **16.3.3** — the
exact bottom edge of that upper range. The hole in the middle is real: every Next 16 before
16.3.3 is unsupported by this adapter. Two `@latest`s happening to agree today is luck, not a
guarantee, so check the _pair_ rather than either half — if a pinned or cached invocation ever
hands you 16.0–16.3.2, the install succeeds and the failure surfaces later, in the OpenNext
build, saying nothing about versions.

Verify the workspace is single-rooted before moving on — one lockfile, and `next` resolved
through the root store:

```bash
cd ../.. && find . -name pnpm-lock.yaml -not -path '*/node_modules/*'   # must print exactly one
pnpm install   # from the root; postinstalls for esbuild + workerd should run, with no ERR_PNPM_IGNORED_BUILDS
cd apps/web
```

(create-next-app also drops an `apps/web/AGENTS.md` — version-specific Next.js guidance — plus
a `CLAUDE.md` that is just `@AGENTS.md`. Keep both: they're correctly scoped to this app, and
agent tooling reads the nearest one alongside the root `CLAUDE.md`.)

One more rule to drop, from `apps/web/.gitignore` — it also assumes a standalone repo. That
file ships a bare `.env*`, and for paths inside `apps/web` the **deepest** `.gitignore` wins —
so it would re-ignore the `.env.example` the root `.gitignore` deliberately re-admits, and
this app's key checklist would vanish with no error. Replace the rule with a note, so nobody
re-adds it:

```bash
node -e 'const fs=require("fs"),f=".gitignore";fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace("# env files (can opt-in for committing if needed)\n.env*\n","# env files: governed by the root .gitignore, which ignores .env* but re-admits\n# .env.example. Re-declaring .env* here would override that negation for this\n# directory (deepest .gitignore wins) — see the environment file convention in Slice 0.\n"))'
```

The root's ignore-then-negate policy now governs the whole repo from one place.

`wrangler.jsonc` (service bindings come later — keep this slice minimal):

```bash
cat > wrangler.jsonc <<'EOF'
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "__PROJECT__-web",
  "main": ".open-next/worker.js",
  "compatibility_date": "2026-08-28",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
  "images": { "binding": "IMAGES" },
  "services": [
    { "binding": "WORKER_SELF_REFERENCE", "service": "__PROJECT__-web" },
  ],
}
EOF
```

(The trailing commas and the split `services` array are prettier's, not a style choice —
`.jsonc` permits them and prettier inserts them. The heredoc above is written the way
prettier leaves the file _after_ the fact, because it was not, and `pnpm docs:check` caught
the disagreement on the very first run. That is the whole reason that tool exists: nothing
about the original was wrong, it was just formatted by hand, and a hand-formatted heredoc
disagrees with disk from the first `pnpm format` onward.)

Two of those values are research output rather than copies of the reference.

**`compatibility_date` is capped by the workerd you have, not by today's date.** A runtime
cannot implement a compatibility date it was built before, so asking for one past its build
is an error rather than a forward-compatible request. wrangler 4.127.1 depends on
`workerd@1.20260828.1`, which is where `2026-08-28` comes from — not from the calendar. Read
it as a floor you raise on purpose when you upgrade wrangler, which is the entire point of
the field: bumping it is how you opt into changed runtime behaviour deliberately instead of
inheriting it on a redeploy.

**The `images` binding is not in the reference; it is in the vendor's docs**, which say
plainly that it "must be defined to enable image optimization". It belongs in this slice
rather than a later one because the page `create-next-app` scaffolds already renders
`next/image`, so the very first gate exercises the optimizer. The docs do not say what
failure looks like without the binding, and this slice does not go and find out — it is one
line, and the alternative (a custom loader plus Cloudflare Images enabled on the zone by
hand) is a much larger commitment than the default page justifies.

`open-next.config.ts`:

```bash
cat > open-next.config.ts <<'EOF'
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
export default defineCloudflareConfig();
EOF
```

(Add the R2 incremental cache override later only if you use ISR.)

Append the dev hook to the existing `next.config.ts` (imports hoist, so end-of-file is fine):

```bash
cat >> next.config.ts <<'EOF'

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
EOF
```

The standard package setup (the Slice 0 contract), minus its `tsconfig.json` —
create-next-app already made one:

```bash
pnpm add -D vitest
pnpm pkg set type="module"
pnpm pkg set \
  scripts.typecheck="tsc --noEmit" \
  scripts.lint="eslint . --max-warnings 0" \
  scripts.format="prettier --write . --ignore-path ../../.gitignore --ignore-path ../../.prettierignore" \
  scripts.test="vitest run" \
  'scripts["test:unit"]=vitest run --project unit' \
  'scripts["test:integration"]=vitest run --project integration'
```

(create-next-app writes a bare `"lint": "eslint"` — the `pkg set` above replaces it. Its
version of the script skips `--max-warnings 0`, which is exactly the asymmetry Slice 0
describes: this is the one package whose config downgrades rules to `warn`.)

**The `format` script passes _two_ `--ignore-path`s, and that is a correction to Slice 0's
convention rather than an embellishment of it.** Slice 0 says every package's `format` must
pass `--ignore-path ../../.prettierignore`, because prettier looks for `.prettierignore` in
its working directory and `turbo run format` runs it inside each package. All true — but
`--ignore-path` **replaces** prettier's default ignore list rather than adding to it, and
that default is `.gitignore`. So the single-flag form silently switches gitignore-based
exclusion _off_, and the first package with build output pays for it: `pnpm format` here
reformatted all of `.next/`, `.next/standalone/` and `.open-next/` — thousands of generated
files, every one of them about to be overwritten by the next build.

`packages/mock` could never have caught this. It had no build output and, being a throwaway,
ran a bare `prettier --write .` that kept the default. `apps/web` is the first package where
the flag's semantics have any consequence at all. The fix is to name both files explicitly,
which is also the more honest script: the ignore set was always two files, and the previous
version just happened to inherit one of them invisibly.

Slice 0's own prose has been amended to match — the convention it states is the thing that
was wrong, so leaving the correction only here would let the next package reintroduce it.

**`type: "module"` is set here and is not cosmetic.** create-next-app omits it, which leaves
`apps/web` a CommonJS package containing `vitest.config.ts` written in ESM. Vitest 4 loads
that file and warns:

```
(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is
planned to become the default in a future major version of Vite:
  - ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1).
```

"Planned to become the default" is the part that matters: this is a warning now and a broken
config load later, in every package that copies this shape — so it is worth spending one line
on at the first opportunity rather than fixing four times. The root `package.json` already
declares `"type": "module"`; this just stops `apps/web` from being the exception. `next build`,
`opennextjs-cloudflare build`, `tsc`, ESLint and vitest were all re-run against it before this
was written down — nothing else moved, and the warning is gone.

This is the one package whose `eslint.config.mjs` is not the two-line re-export — it already
has one from create-next-app, and the Next.js configs it loads are worth keeping. Prepend the
shared base to it rather than replacing the file:

```bash
cat > eslint.config.mjs <<'EOF'
import { createRequire } from "node:module";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import base from "../../packages/config/eslint.base.mjs";

// eslint-plugin-react (a transitive dep of eslint-config-next) defaults to
// `version: "detect"`, and its detection path calls `context.getFilename()` —
// removed in ESLint 10, so every rule it owns throws before linting a line.
// Naming the version explicitly skips detection entirely. Read from the
// installed React rather than hardcoded, so it cannot drift from package.json.
// Remove once eslint-plugin-react supports ESLint 10; 7.37.5 is the latest
// published and still peers `eslint: "... || ^9.7"`.
const reactVersion = createRequire(import.meta.url)(
  "react/package.json",
).version;

const eslintConfig = defineConfig([
  // The workspace base first, then Next's configs on top: eslint-config-next
  // carries the React/hooks/core-web-vitals rules the base cannot know about,
  // and later blocks win on any rule both set.
  ...base,
  ...nextVitals,
  ...nextTs,
  { settings: { react: { version: reactVersion } } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
EOF
```

**The React-version line is the one genuinely hard thing in this slice, and it will bite
again.** Slice 0's catalog pins ESLint to 10.x, with a stated rationale that checked
typescript-eslint's peer range and found it allowed 10. That rationale was sound and
incomplete: `apps/graphql` and `packages/mock` only ever load the shared base, and this is
the first package to pull in `eslint-config-next` — which drags in `eslint-plugin-react`,
`eslint-plugin-jsx-a11y` and `eslint-plugin-import`, none of which have shipped ESLint 10
support. `pnpm install` says so, quietly, as a peer warning; `pnpm lint` says so loudly:

```
TypeError: Error while loading rule 'react/display-name':
  contextOrFilename.getFilename is not a function
```

There is no version to upgrade to. `eslint-plugin-react@7.37.5` is the **latest published**
release, not a stale pin, and it still peers `eslint: "^3 || … || ^9.7"` — so a pnpm override
would only mask a genuine API removal.

That leaves the shape of the fix mattering a lot, because the obvious three are all bad
trades:

- **Drop the catalog to ESLint 9** — repo-wide surrender to one package's transitive dep, and
  9.x is deprecated on npm, which is exactly why Slice 0 went to 10.
- **Pin ESLint 9 in `apps/web` only** — two ESLint majors in one workspace is precisely what
  the catalog exists to prevent, and `pnpm lint` from the root would then run two linters.
- **Drop `nextVitals`** — throws away the React and core-web-vitals rules, which are the only
  reason this package has a custom config at all.

The fix used instead is narrower than all three, because the crash is not general: reading
the stack trace, `getFilename` is reached only via `detectReactVersion`, and
`getReactVersionFromContext` skips that call entirely when `settings.react.version` is a
literal string. So declaring the version — which is good hygiene regardless, since it is what
gates the plugin's version-dependent rules — routes around the removed API without giving up
ESLint 10, the catalog, or a single Next.js rule. It is a real workaround with a real
expiry date, which is why the comment says when to delete it.

```bash
cat > vitest.config.ts <<'EOF'
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["**/*.int.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["src/**/*.int.test.ts"],
        },
      },
    ],
  },
});
EOF
```

(This app adds jsdom + the React plugin to this config when component tests arrive — don't
set that up before there's a component worth testing.)

Then the app-specific scripts:

```bash
pnpm pkg set \
  scripts.dev="next dev" \
  scripts.build="next build" \
  scripts.preview="opennextjs-cloudflare build && opennextjs-cloudflare preview" \
  'scripts["deploy:production"]=opennextjs-cloudflare build && opennextjs-cloudflare deploy' \
  scripts.codegen="next typegen && wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts" \
  'scripts["cf-typegen"]=pnpm run codegen'
```

The binding types are wired as **`codegen`**, with `cf-typegen` kept as an alias for the
familiar name. That is what puts this app's generated `cloudflare-env.d.ts` under the same
`pnpm turbo codegen` as `apps/graphql`'s resolver types — one command refreshes every
generated artifact in the repo, and the turbo `codegen` dependency below keeps a stale one from
reaching a gate.

**`next typegen` is chained in front of it here, and that is a change from the reference**,
which defers route-type generation to "a later slice". It lands in this one because Slice 0
already decided it: `turbo.json`'s `codegen` task declares `.next/types/**` among its outputs,
and an output no task ever writes is a claim the build never has to honour. Making `codegen`
actually produce it closes that loop on the first slice that has routes at all — and it is
what lets the gate below drop the reference's ordering constraint (see there). Both halves
are generators of _types from configuration_, which is one job, so they share one script
rather than being two things to remember.

```bash
echo "NEXTJS_ENV=development" > .env.development
cat > .env.example <<'EOF'
# Keys used by this package, and which (gitignored) file each belongs in.

# .env.development — loaded by `next dev`. Tells the OpenNext worker which Next
# env file set to load at runtime; unset means "production".
NEXTJS_ENV=development

# .env.production — read ONLY by `deploy:production`, via wrangler's --env-file.
# Which Cloudflare account the Worker is uploaded to. `wrangler whoami` lists
# yours. Deliberately not in .env.development: the deploy target is not a value
# your machine gets to supply, and the two may be different accounts.
CLOUDFLARE_ACCOUNT_ID=
EOF
```

`NEXTJS_ENV` tells the OpenNext worker which Next env file set to load at runtime, and it
defaults to `production` when unset — which is what both `preview` and a real deploy get,
since each runs `next build`. `.env.development` and not `.env.local`: `.env.local` is read
in _every_ mode and outranks `.env.<mode>`, so it silently supplies development values to a
production build. `.env.development` is the filename the convention in Slice 0 settled on for
every package's local values; this is the first package to use it.

**`.env.example` is written in the same breath, and is not decoration.** Slice 0's convention
makes it the committed fresh-clone checklist while `.env.development` is gitignored — so a
key that exists only in the latter is a key nobody else ever learns about. `NEXTJS_ENV` is
the sharpest possible example of why that matters: it is not a secret whose absence throws,
it is a value that silently _defaults to `production`_. Clone this repo without the checklist
and `pnpm dev` comes up loading production env files, with nothing anywhere saying so. The
`.env.example` is the whole checklist for the package, spanning both gitignored files, which
is why each key says which one it lives in. The second key is the subject of the next
section.

Add the **first real unit test**. Its job is to prove the Slice 0 harness end to end from
root — a pure function, no React, no jsdom:

```bash
mkdir -p src/lib
cat > src/lib/formatPrice.ts <<'EOF'
// Prices are stored as integer cents everywhere (no floats in money paths).
export function formatPrice(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    cents / 100,
  );
}
EOF
cat > src/lib/formatPrice.test.ts <<'EOF'
import { expect, test } from "vitest";
import { formatPrice } from "./formatPrice";

test("renders cents as a currency string", () => {
  expect(formatPrice(1999)).toBe("$19.99");
});

test("keeps trailing zeros", () => {
  expect(formatPrice(500)).toBe("$5.00");
});

test("honours a non-default currency", () => {
  expect(formatPrice(1999, "EUR")).toBe("€19.99");
});
EOF
```

This is the first slice where the harness has something to run, so it is the first slice whose
gate carries an expected test count.

**The deploy target is a third env file, and it is the one place this slice needed a
decision it could not make for itself.** A Cloudflare OAuth token can carry several accounts.
When it does, `wrangler deploy` refuses rather than guessing:

```
✘ [ERROR] More than one account available but unable to select one in non-interactive mode.
  Please set the appropriate `account_id` in your Wrangler configuration file or assign it to
  the `CLOUDFLARE_ACCOUNT_ID` environment variable.
```

Which account is genuinely the operator's call — it decides where the Worker lives and who
pays. _How the answer is stored_ is not; Slice 0's environment convention already settled it,
and the deploy target is the textbook case for the row nothing had used yet: **production
values go in a gitignored `.env.production`, read only by the script that needs it.**

```bash
echo "CLOUDFLARE_ACCOUNT_ID=<your account id>" > .env.production   # `wrangler whoami` lists them
```

**Not `.env.development`, and the distinction is load-bearing rather than tidy.** That file
is by definition _your machine's_ values; the account a deploy uploads to is not one of them.
Conflating the two forecloses the case that is actually common — a personal or staging
account for day-to-day work, a separate one for what users hit — and there would be no second
place to put the second answer. Two files, two scripts, one account each, and `preview` needs
neither because it is local workerd. (`.env.development` would not even have worked: wrangler
loads `.env`, or `.env.<name>` for a _wrangler_ environment, and never reads a filename Next
chose. That was found the direct way, by watching the deploy fail with the error above while
the value sat in the file.)

`--env-file` is what connects the file to the one command allowed to read it, and
`opennextjs-cloudflare` forwards trailing arguments to wrangler, so it threads through:

```bash
pnpm pkg set 'scripts["deploy:production"]=opennextjs-cloudflare build && opennextjs-cloudflare deploy -- --env-file .env.production'
```

Read that as the convention's "read only by the script that needs it" made literal: no other
script names the file, so no other script can pick up the production account by accident.

**`packages/mock` has done its job — delete it.** Slice 0 created it to prove the harness
against something trivial _before_ a real package could confuse the diagnosis, and `apps/web`
is now that real package: it runs the same six-piece contract, and its `formatPrice` test is
a strictly better smoke test because a break in it is a break in something that matters.
Keeping both would mean a permanent package whose only purpose was to be temporary.

```bash
cd ../.. && rm -rf packages/mock
```

Its files are invisible to `docs:check` by construction — Slice 0 wrote them with a `MOCKEOF`
heredoc terminator precisely so that deleting them would not leave a permanent "not built
yet" line behind — so nothing else needs unpicking. The one trace it leaves is in `CLAUDE.md`,
whose closing paragraph told the reader to do exactly what was just done:

```diff
--- CLAUDE.md
 pnpm workspace. What is in it:

+- `apps/web` — Next.js on Cloudflare Workers via OpenNext.
 - `packages/config` — shared tsconfig and ESLint base, extended by every package.
@@
 - `packages/config` — shared tsconfig and ESLint base, extended by every package.
-- `packages/mock` — throwaway harness smoke test, not part of the stack. Delete it
-  once a real package or app exists.
```

Two hunks, because this slice does two things to that file: `apps/web` now exists and earns
a line, and `packages/mock` no longer does. Nothing else is added. Slice 0's rule for
`CLAUDE.md` is that it carries the package map plus the one fact about a layer nobody can
afford to miss, and this slice has no second kind of fact: the `deploy:production` naming
rule below is real but is a `setup-project` concern, and how the Worker reaches Cloudflare is
not something a session editing a page needs loaded on every turn.

```bash
cd apps/web
```

**Local gate** — the last block left you in `apps/web`, so the first two run there; the test
and typecheck rows run from the **repo root**, because a gate checks the whole workspace, not
just the package you were editing.

**The trap this gate is built around, and why it is already disarmed.** The scaffolded
`src/app/layout.tsx` types its props as `LayoutProps<"/">` — a global Next _generates_ rather
than ships. It lands under `.next/`, which is gitignored, and `tsconfig.json` includes it. So
`pnpm typecheck` against a tree that has never generated it fails with
`TS2304: Cannot find name 'LayoutProps'`, and nothing is actually wrong: the generator simply
has not run. Historically the fix was to run `pnpm dev` first, which made the row order
load-bearing and the whole thing unreproducible on a fresh clone or in CI, where no human
starts a dev server.

Folding `next typegen` into `codegen` above is what retires that. `turbo.json` makes both
`typecheck` and `lint` depend on `codegen`, so the types are generated by the same run that
needs them, from a cold clone, with no ordering to remember. The rows below can be read as
independent checks again — which is what a gate should be.

| Where      | Check                   | Expect                                                          |
| ---------- | ----------------------- | --------------------------------------------------------------- |
| `apps/web` | `pnpm dev`              | page renders at `localhost:3000`                                |
| `apps/web` | `pnpm preview`          | same page under workerd — catches what `next dev` hides         |
| root       | **`pnpm typecheck`**    | **`2 successful`** — 1 typecheck (web) + the `codegen` it needs |
| root       | **`pnpm lint`**         | **`2 successful`** — 1 lint (web) + the `codegen` it depends on |
| root       | **`pnpm test:unit`**    | **`Test Files 1 passed` / `Tests 3 passed`** — `formatPrice`    |
| root       | `pnpm test:integration` | 0 — no real dependency exists until Slice 3                     |
| root       | `pnpm docs:check`       | no drift — this plan still describes the repo                   |

Every root row now reads `2 successful` rather than `1`, and that second task is the
`codegen` turbo inserted — the disarmed trap, visible in the output.

Root and package give the same answer here, since `apps/web` is the only package with tests —
but that stops being true at Slice 3, and root is the habit that keeps working. From root the
scripts fan out through turbo (`turbo run test:unit`); inside a package they run that package
alone. `cd ../..` gets you back.

**Production gate** — from `apps/web`: `pnpm deploy:production` → the
`__PROJECT__-web.<account>.workers.dev` URL renders. Commit.

**Why the script is not just called `deploy`.** `deploy` is a _built-in pnpm command_
(`pnpm --filter=<project> deploy <target directory>` — it copies a workspace package into a
directory), so it is the one obvious script name in this repo that collides with pnpm itself.
Bare `pnpm deploy` inside a package happens to fall through to the script, but the moment a
`--filter` is present the built-in wins and your script never runs:

```
$ pnpm --filter @__PROJECT__/web deploy
[ERR_PNPM_INVALID_DEPLOY_TARGET] This command requires one parameter
```

That `--filter` form is exactly how Slices 3 and 4 deploy both Workers from the root. Naming
the script `deploy:production` retires the collision entirely — it is not a pnpm builtin, so
no `run` is needed anywhere — and it earns the name twice over by marking the command as the
production-touching one, matching `migrate:production` in Slice 3.

## Sources and findings

The documentation this slice's §3 research rests on, and what running it actually turned up —
kept here rather than in a shared bibliography so that reading the slice is reading its
evidence. **Every version and claim below is dated.** A pin is only as good as its date;
re-check rather than inherit, and add a dated entry when you do (SKILL.md §7).

### Sources

- [OpenNext Cloudflare get-started](https://opennext.js.org/cloudflare/get-started)
- [Next.js on Workers · Cloudflare framework guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- [Next.js environment variables](https://nextjs.org/docs/app/guides/environment-variables)

### 2026-08-31 — Slice 1, first full execution

Registry (`npm view <pkg> version`, plus `peerDependencies` where it decides something):

| Package                | Found   | Decision                                                                 |
| ---------------------- | ------- | ------------------------------------------------------------------------ |
| next / create-next-app | 16.3.3  | Scaffolds Next 16.3.3, React 19.2.8                                      |
| @opennextjs/cloudflare | 1.20.4  | Peers `next: ">=15.5.24 <16 \|\| >=16.3.3"` — 16.3.3 is the bottom edge  |
| wrangler               | 4.127.1 | Depends on `workerd@1.20260828.1` — **this caps `compatibility_date`**   |
| eslint-config-next     | 16.3.3  | Peers `eslint: ">=9.0.0"`, but its transitive plugins do not (see below) |
| eslint-plugin-react    | 7.37.5  | **Latest published**, still peers `eslint: "… \|\| ^9.7"`. No fix exists |
| vitest                 | 4.1.11  | Unchanged                                                                |

Docs read: [OpenNext get-started](https://opennext.js.org/cloudflare/get-started) and
[the image how-to](https://opennext.js.org/cloudflare/howtos/image). Both were ahead of the
reference — get-started now shows an `"images": { "binding": "IMAGES" }` block the slice did
not have, and the image page states the binding "must be defined to enable image
optimization". Added, and the deployed Worker reports it bound.

Behaviour, reproduced rather than assumed:

- **`create-next-app` 16 flags**: `--turbopack` is gone (Turbopack is the default; `--rspack`
  opts out), `--biome` joins `--eslint`, and `--agents-md` is new and default-on. Every flag
  the slice passes still exists.
- **The nested-workspace trap is still real**, and its `allowBuilds` shape was the benign one
  this time (`sharp: false`, `unrs-resolver: false` — no `ERR_PNPM_IGNORED_BUILDS`). Deleting
  the file remains the fix either way.
- **`eslint-config-next` against eslint 10 — the open question from Slice 0 — is answered,
  and the answer is no.** `pnpm lint` dies with
  `TypeError: Error while loading rule 'react/display-name': contextOrFilename.getFilename is not a function`.
  `getFilename` was removed in ESLint 10; `eslint-plugin-react` still calls it from
  `resolveBasedir`, reached only via `detectReactVersion`. Since
  `getReactVersionFromContext` skips detection when `settings.react.version` is a literal
  string, declaring the version routes around the removed API — no downgrade, no split
  catalog, no rules dropped. Recheck each time: the workaround should be deleted the moment
  the plugin supports ESLint 10.
- **`compatibility_date` cannot exceed the bundled workerd's build date.** Not a
  forward-compatibility request — wrangler rejects it. Read the date off
  `npm view wrangler@<v> dependencies` rather than the calendar.
- **wrangler does not read `.env.development`.** It loads `.env`, or `.env.<name>` for a
  _wrangler_ environment. A multi-account OAuth token therefore still fails with
  `More than one account available but unable to select one in non-interactive mode` with
  `CLOUDFLARE_ACCOUNT_ID` sitting in that file. `--env-file <path>` is the flag that works,
  and `opennextjs-cloudflare deploy -- <args>` forwards it to wrangler.
- **Vitest 4 warns on an ESM `vitest.config.ts` in a package without `"type": "module"`** —
  "planned to become the default in a future major version of Vite". Setting `type` on the
  package clears it; `next build`, the OpenNext build, tsc, ESLint and vitest were all re-run
  against it with no other change.
- **`--ignore-path` replaces prettier's default ignore list rather than adding to it**, so
  Slice 0's single-flag `format` script silently disabled `.gitignore` exclusion. Harmless
  until a package has build output; here it reformatted all of `.next/`, `.next/standalone/`
  and `.open-next/`. Both slices corrected — the script now names both files.

## Leaves behind

Read by Slice 99 (the audit), which treats this as a **cross-check and never as the source of truth** —
the code is that. An entry here is a claim about the repo; where the two disagree, the code
wins and this table is the finding.

**Provisional** is something built to prove a mechanism, with the condition that retires it.
**Accepted** is a risk taken knowingly, with the reasoning written down so a later slice can
re-decide it rather than rediscover it.

### Provisional

Nothing. This slice **retires** `packages/mock` — it is the first real workspace package, which
is the condition Slice 0 named.

### Accepted

| Risk                                                   | Reachable by        | Why this is the right trade                                                                             |
| ------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------- |
| `apps/web` is deployed to a public `*.workers.dev` URL | The entire internet | It is a public web app; that is the point. Worth re-reading once the app serves anything user-specific. |
