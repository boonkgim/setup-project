# Slice 0 — Workspace foundation

No deploy in this slice; the gate is that the workspace installs and tooling runs.

**First file in the repo: lock the Node version.** Everything that follows — corepack, pnpm,
every install and build — runs on whatever Node is active, so pin it before anything else:

```bash
echo "24" > .nvmrc
nvm use   # or fnm/mise — auto-switching managers pick .nvmrc up on cd
node -v   # confirm 24.x before proceeding
```

Then:

```bash
pnpm init
```

**Immediately after `pnpm init`, remove the `devEngines` block it wrote.** pnpm 11's init
emits `devEngines.packageManager` with a caret range — `"version": "^11.x.y"` alongside
`"onFail": "download"`, still true as of pnpm 11.15.1 — and corepack rejects ranges — every subsequent `pnpm` command in the repo dies with
`Invalid package manager specification in package.json; expected a semver version`. Since
pnpm itself can no longer run here, use node:

```bash
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));delete p.devEngines;fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")'
```

The exact-version `packageManager` field set below covers the same ground without a second
place to keep in sync (corepack auto-downloads from it once `corepack enable` has run).

Set the root `package.json` fields with `pnpm pkg set` — scripted, deterministic JSON edits
instead of hand-editing (`--json` makes `true` a real boolean, not the string `"true"`):

```bash
pnpm pkg set private=true --json
pnpm pkg set packageManager="pnpm@$(pnpm -v)"
pnpm pkg set engines.node=">=24"
echo "engine-strict=true" > .npmrc   # pnpm hard-fails (not warns) on the wrong Node
```

Three mechanisms, one version: `.nvmrc` switches you to it, `engines` declares it,
`engine-strict` enforces it.

**Quoting rule for `pnpm pkg set`:** pnpm's path parser only accepts plain identifiers after
a dot — keys containing `:` or `-` (like `test:unit` or `cf-typegen`) error with
`ERR_PNPM_UNEXPECTED_TOKEN_IN_PROPERTY_PATH` and must use the quoted-bracket form instead,
with the whole argument single-quoted so the inner quotes survive the shell:
`'scripts["test:unit"]=vitest run --project unit'`. (Known npm-parity gap —
[pnpm#13163](https://github.com/pnpm/pnpm/issues/13163); dot paths for these keys may start
working in a future pnpm.)

(`pnpm pkg set` — like `jq` — only speaks strict JSON. `turbo.json` and the `wrangler.jsonc`
files below are JSONC, which it can't patch — so every file in this plan is created whole by
a copy-pasteable `cat` heredoc: paste the block, the file exists. Directory convention: every
slice starts at the repo root, and `cd` lines inside blocks are written from wherever the
previous block left you.)

```bash
pnpm add -D turbo typescript
```

`pnpm-workspace.yaml`:

```bash
cat > pnpm-workspace.yaml <<'EOF'
packages:
  - "apps/*"
  - "packages/*"

# Postinstall scripts are blocked by default (supply-chain hardening). These two
# fetch/link platform binaries and must run: workerd is the Workers runtime behind
# `wrangler dev` and `opennextjs-cloudflare preview`; esbuild is wrangler's bundler.
allowBuilds:
  esbuild: true
  workerd: true
  sharp: false
  unrs-resolver: false

# One version of shared tooling across every package. Packages write
# "typescript": "catalog:" and the version is resolved from here.
#
# Verify all three before running this slice — they are the pins most likely to
# have moved, and two of the three moved between writing this and last checking it.
#
# TypeScript is held at 6.x, NOT the 7.x native port: typescript-eslint 8.68.0
# still declares `typescript: ">=4.8.4 <6.1.0"` and hard-errors ("typescript-eslint
# does not support TS 7.0") rather than warning, which takes the shared ESLint base —
# and so `pnpm lint` in every package — down with it. tsc and `next build` are
# both fine on 7; ESLint is the sole blocker. npm's `latest` for typescript is 7.x,
# so a bare `pnpm add -D typescript` lands on the broken side and the catalog pin
# is what pulls it back — you will see it do exactly that on `pnpm install`.
# Revisit when typescript-eslint ships TS >= 7.1 support:
# https://github.com/typescript-eslint/typescript-eslint/issues/10940
#
# ESLint is 10.x. 9.x is deprecated on npm ("no longer supported") and installing it
# prints that on every run; typescript-eslint 8.68.0 peers
# `eslint: ^8.57.0 || ^9.0.0 || ^10.0.0`, so nothing holds this back. @eslint/js
# follows eslint's major and is installed unpinned below, which is why it needs no
# catalog entry.
#
# @types/node tracks the runtime in .nvmrc / engines (Node 24), not whatever
# create-next-app happened to scaffold. It drifts to ^20 otherwise — four majors
# behind the runtime, which under-declares newer APIs and mistypes changed ones.
# Track the newest release of the Node major this repo runs, not npm's `latest`:
# @types/node ships majors for Node versions you are not on.
catalog:
  typescript: ^6.0.3
  eslint: ^10.9.1
  "@types/node": ^24.13.3
EOF
```

The `allowBuilds` block is written now, before the packages that need it exist, because it's a
**workspace-root-only** setting — pnpm reads it from the root `pnpm-workspace.yaml` and nowhere
else. Without it, Slice 1's installs end in
`[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@…, workerd@…` and every later install
repeats the warning. (`pnpm approve-builds <pkg>…` writes the same block interactively; naming
the packages up front skips the prompt. `sharp`/`unrs-resolver` are pinned to `false` rather
than omitted so the list is a decision record, not a to-do.)

The `catalog:` block is the answer to "which TypeScript?" asked once. Four packages install
TypeScript across Slices 0–3, and left to their own defaults they drift: `pnpm add -D
typescript` takes npm's `latest` (7.x today), while create-next-app pins `^5`. That drift is
not cosmetic here — it decides whether `pnpm lint` runs at all. So point the root at the
catalog now, and every later package does the same:

```bash
pnpm pkg set devDependencies.typescript="catalog:"
pnpm install
```

Anything else installed in more than one package (`vitest`, `wrangler`) can move into the
catalog the same way once the second copy appears. Never `pnpm add -D typescript` bare in a
package after this — that's exactly the drift the catalog exists to prevent. `pnpm peers
check` is the audit that catches it if it happens anyway.

`turbo.json`:

```bash
cat > turbo.json <<'EOF'
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", ".open-next/**", "dist/**"]
    },
    "dev": { "cache": false, "persistent": true },
    // Only the *.generated.* files are listed, not the resolver files codegen also
    // scaffolds under src/schema/**/resolvers/. Those are seeded once and then
    // hand-edited, so they are source, not build output — caching them would let a
    // restored cache overwrite real implementations.
    "codegen": {
      "outputs": [
        "src/generated/**",
        "src/schema/**/*.generated.*",
        "cloudflare-env.d.ts",
        "src/worker-env.d.ts",
        // `next typegen`'s route types (LayoutProps, PageProps). Inside .next, which
        // is gitignored, so a fresh clone has none until codegen runs — listing it
        // here is what lets a cache hit restore them instead of only a full build.
        ".next/types/**"
      ]
    },
    "typecheck": { "dependsOn": ["^build", "codegen", "^codegen"] },
    "lint": { "dependsOn": ["codegen", "^codegen"] },
    "format": { "cache": false },
    "test": { "dependsOn": ["^build", "^codegen"] },
    "test:unit": { "dependsOn": ["^build", "^codegen"] },
    "test:integration": { "dependsOn": ["^build", "^codegen"], "cache": false }
  }
}
EOF
```

(`test:integration` is uncacheable on purpose — it talks to a real database. `lint` depends on
`^codegen` rather than `^build`: ESLint reads source, so it needs generated files to exist — but
making it wait on full builds would put an OpenNext build in front of every lint run. The
`codegen` outputs are written now, before either generator exists, for the same reason
`allowBuilds` is: the shape of the answer does not depend on the packages. The one subtlety —
why the resolver files Slice 2's codegen _also_ writes are deliberately not listed — is in the
comment, and earns its explanation there.)

`.gitignore`:

```bash
cat > .gitignore <<'EOF'
node_modules/
.next
.open-next
.turbo
.wrangler
.cache
.env*
!.env.example
EOF
```

(Ignore every env file, with exactly one exception: `.env.example`, which holds keys and dummy
values only. Nothing else in the `.env` family is ever committed — see the convention below
for how a production value reaches the build without a second committed file. The negation
works because `.env*` never excludes a parent directory, so git still descends far enough to
see it. `.cache` is the one entry no slice produces: it is where a skill's run artifacts go —
inventories, review files and other regenerable working notes, not source.)

## Environment file convention

Every package this project adds — a Next.js app, a Worker, a database client — follows one
rule from here on: **a file holding a real value is never committed.** Two files per package,
and only one of them is:

| File               | Committed | Holds                                             |
| ------------------ | --------- | ------------------------------------------------- |
| `.env.example`     | yes       | every key, dummy values — a fresh-clone checklist |
| `.env.development` | **no**    | your machine's values, including local secrets    |

One name across every package, and deliberately not `.env.local` — several tools treat
`.env.local` as loaded in _every_ mode, including a production build, so a value meant only
for your machine can silently ride along into what gets deployed. `.env.development` cannot,
because nothing outside development reads it. Each package's own slice names the exact flag
or config its tooling needs to point at this file; the naming choice is settled here so every
later slice inherits it instead of picking its own.

There is no root `.env`. Env files live beside the package whose tooling reads them — a
shared one would have to satisfy every tool in the workspace and would fit none of them well.

Where a value actually lives follows the same rule, split by kind:

- **Production, non-secret** → whatever config mechanism the platform gives that package (a
  deploy-time flag, a platform-native `vars` block) — never a file.
- **Production, secret, needed at runtime** → the platform's own secret store. Never in the
  repo.
- **Production, secret, needed by you to operate the package** (a migration, a one-off
  script) → a gitignored `.env.production`, read only by the script that needs it.
- **Tests** → an in-code default. A test that depends on a gitignored file passes for you and
  fails on a fresh clone or in CI.
- **Local** → `.env.development`, created from `.env.example` on first clone.

`.gitignore` above already enforces the committed half of this — `.env*` ignored,
`.env.example` re-admitted. Everything past that is a naming and placement discipline, not a
tool, and it costs nothing to settle now.

`packages/config` (`@__PROJECT__/config`) — the shared tsconfig every package extends:

```bash
mkdir -p packages/config && cd packages/config && pnpm init
pnpm pkg set name="@__PROJECT__/config"
pnpm pkg delete scripts.test   # init's failing placeholder would break root `pnpm test` via turbo
```

`packages/config/tsconfig.base.json`:

```bash
cat > tsconfig.base.json <<'EOF'
{
  "compilerOptions": {
    "strict": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022"
  }
}
EOF
cd ../..   # back to the repo root
```

## Quality harness (wired now, exercised from Slice 1 on)

The harness skeleton is part of the foundation: every later slice creates packages that copy
this pattern, and every gate from Slice 1 onward runs it. It starts trivially green
(`passWithNoTests`) — the first real unit test lands in Slice 1, the first real integration
test in Slice 3 (the first moment a real dependency exists to integrate against).

Install prettier now, at the workspace root (this is the only prettier install in the whole
repo — packages reuse it, see below), along with a `.prettierrc` (even an empty `{}` — the
point is one shared config). The `-w` flag is required: now that `pnpm-workspace.yaml`
exists, pnpm refuses root installs (`ERR_PNPM_ADDING_TO_ROOT`) unless you say the root is
what you mean:

```bash
pnpm add -Dw prettier eslint@catalog:
echo '{}' > .prettierrc
cat > .prettierignore <<'EOF'
# Generated, machine-owned files. prettier already skips everything in .gitignore
# (its default --ignore-path), so this file is only for generated files that ARE
# committed — reformatting those produces a huge diff that the generator reverts.
pnpm-lock.yaml
**/src/generated/
packages/db/migrations/
# `wrangler types` output: ~15k lines of runtime types per app, rewritten on every
# regeneration. Prettier disagrees with its formatting, so without these two the first
# `pnpm format` reformats both files and the next `pnpm codegen` puts them back.
apps/web/cloudflare-env.d.ts
apps/graphql/src/worker-env.d.ts
EOF
```

**`.prettierignore` is not optional here.** prettier defaults to `.gitignore` as its ignore
path, which covers build output — but `pnpm-lock.yaml`, `apps/web/src/generated/`,
`packages/db/migrations/` (added in Slice 3) and the two `wrangler types` files (Slices 1
and 4) are _committed_ generated files, so nothing excludes them. Without this file the
first `pnpm format:changed` after any install reformats the entire lockfile (~10k lines of
diff on a file no human reads), and the next `pnpm install` quietly reverts it. drizzle-kit's
migration snapshots are the same trade in miniature: prettier adds a trailing newline and
`drizzle-kit generate` strips it again, forever. The `wrangler types` output is that trade at
~15k lines an app.

(One committed generator's output is deliberately _absent_ from this list: `apps/graphql`'s
`*.generated.*` files, which Slice 2 formats by chaining prettier onto its own `codegen`
script. That generator emits type annotations prettier would immediately rewrite, so the two
have to reach a fixed point together rather than be kept apart. Ignoring them here instead
would leave them permanently mid-fight.)

**And every package's `format` script must pass two ignore paths:
`--ignore-path ../../.gitignore --ignore-path ../../.prettierignore`.** prettier looks for
its ignore files in the _working directory_, not up the tree — so `turbo run format`, which
runs `prettier --write .` inside each package, sees neither root file. Only
`pnpm format:changed` honors them, because that one runs from the root. Without the flags the
ignore list silently covers half the harness: `pnpm format:changed` leaves the generated files
alone, `pnpm format` reformats them, and the two fight every time you run them.

**Both flags, not just `.prettierignore` — this paragraph originally said one, and was
wrong.** `--ignore-path` _replaces_ prettier's default ignore list rather than adding to it,
and that default is `.gitignore`. Naming only `.prettierignore` therefore switches
gitignore-based exclusion off, which costs nothing until a package has build output — and
then costs everything: the first `pnpm format` in Slice 1 reformatted the whole of `.next/`,
`.next/standalone/` and `.open-next/`. `packages/mock` could not have caught it, having no
build output and (as a throwaway) a bare `prettier --write .` that kept the default. Read the
two flags as the ignore set always having been two files, one of which used to be inherited
invisibly.

ESLint installs at the root for the same reason as prettier — one binary on every package's
PATH — but unlike prettier it needs a _config_ per package, and flat config resolves plugin
imports relative to the file doing the importing. So the shared rules live in
`packages/config` (which owns the deps) and each package's `eslint.config.mjs` is a two-line
re-export:

```bash
cd packages/config
pnpm add -D eslint@catalog: @eslint/js typescript-eslint
cat > eslint.base.mjs <<'EOF'
import js from "@eslint/js";
import tseslint from "typescript-eslint";

// The workspace's one ESLint answer. Every package's eslint.config.mjs starts
// from this array and appends only what is specific to it (apps/web adds the
// Next.js configs). Kept type-UNaware on purpose: `projectService` would need
// every file ESLint sees to belong to a tsconfig `include`, and each package's
// tsconfig deliberately includes only `src` — so vitest.config.ts, codegen.ts,
// and drizzle.config.ts would all error out. Upgrade to
// `tseslint.configs.recommendedTypeChecked` when a rule needing types
// (no-floating-promises is the one that will drive it) is worth that wiring.
export default tseslint.config(
  {
    // A lone `ignores` key makes these global — they apply to every later block.
    // Build output and generated code: never authored, never linted.
    ignores: [
      "**/.next/**",
      "**/.open-next/**",
      "**/.turbo/**",
      "**/.wrangler/**",
      "**/dist/**",
      // Two shapes, because the two codegen configs disagree on naming: apps/web's
      // client preset writes a src/generated/ directory, while apps/graphql's server
      // preset interleaves *.generated.ts among the hand-written resolvers it seeds,
      // so there is no directory to exclude. Both are machine-owned and full of the
      // `any`s that typescript-resolvers emits for unconstrained context types.
      "**/src/generated/**",
      "**/*.generated.ts",
      "**/*.d.ts",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx,mts,cts}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      // Underscore-prefixed args are the repo's "deliberately unused" marker —
      // GraphQL resolvers take (_parent, _args, env) and would otherwise all flag.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
EOF
cd ../..   # back to the repo root
```

**Why lint at all, when TypeScript is already strict.** They do not overlap much: `tsc` proves
types, ESLint catches what is well-typed but wrong — `no-explicit-any` (the escape hatch that
makes the strict config a lie), unreachable/unused code, and in `apps/web` the React and
`core-web-vitals` rules no type checker knows about. Prettier is a third, disjoint job
(formatting). Three tools, three questions, no rule duplicated between them — which is also
why no `eslint-config-prettier` is needed here: neither the base nor `eslint-config-next` ships
formatting rules.

**Never silence a rule with an inline `eslint-disable` where a base-config decision would
do.** The disable is invisible to everyone else and gets copy-pasted; a rule genuinely not
worth failing on gets turned off in `eslint.base.mjs` instead, where the decision is visible
and applies everywhere at once.

## Mock package — proving the harness before Slice 1

Nothing above has actually been run: no package exists yet to typecheck, lint, format, or
test. Slice 1 will be the first real exercise, but by then the harness is competing with
`create-next-app`'s own scaffolding for attention — a broken `eslint.base.mjs` or
`tsconfig.base.json` reads as a Next.js problem, not a Slice 0 one. `packages/mock` is a
throwaway package that runs the full contract — vitest, ESLint, prettier, tsc — against one
trivial assertion, so a harness bug fails here, in isolation, before anything real depends on
it. It follows the same six-piece contract every later package does (`reference/slices.md`):

```bash
mkdir -p packages/mock/src && cd packages/mock && pnpm init
pnpm pkg set name="@__PROJECT__/mock"
pnpm pkg set devDependencies.typescript="catalog:"
pnpm add -D vitest
pnpm pkg set \
  scripts.typecheck="tsc --noEmit" \
  scripts.lint="eslint . --max-warnings 0" \
  scripts.format="prettier --write ." \
  scripts.test="vitest run" \
  'scripts["test:unit"]=vitest run --project unit' \
  'scripts["test:integration"]=vitest run --project integration'
```

The four files it needs — `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, and one
real test — are written with a `MOCKEOF` heredoc terminator instead of the plan's usual `EOF`,
on purpose. `scripts/docs-check.mjs` only recognizes the literal `cat > path <<'EOF'` form, so
these files are invisible to it — deliberately, because `packages/mock` gets deleted, not
amended, and `docs-check.mjs` has no "removed on purpose" op. Tracking it here would leave a
permanent, harmless-but-wrong "not built yet" line in `pnpm docs:check` once it's gone.

```bash
cat > tsconfig.json <<'MOCKEOF'
{
  "extends": "../config/tsconfig.base.json",
  "compilerOptions": { "outDir": "dist" },
  "include": ["src"]
}
MOCKEOF
cat > eslint.config.mjs <<'MOCKEOF'
import base from "../config/eslint.base.mjs";
export default [...base];
MOCKEOF
cat > vitest.config.ts <<'MOCKEOF'
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      { test: { name: "unit", include: ["src/**/*.test.ts"] } },
      { test: { name: "integration", include: ["src/**/*.int.test.ts"] } },
    ],
  },
});
MOCKEOF
cat > src/mock.test.ts <<'MOCKEOF'
import { describe, expect, it } from "vitest";

describe("harness smoke test", () => {
  it("runs one real assertion through vitest, eslint, tsc, and prettier", () => {
    expect(1 + 1).toBe(2);
  });
});
MOCKEOF
cd ../..
```

**Delete `packages/mock` the moment a real package or app exists** — not necessarily Slice 1's
job to say so. Naming a specific downstream slice here would assume this file already knows
what gets built next, which is a decision `/setup-project` makes at dispatch time, not
something this slice gets to bank on. `setup-project`'s own SKILL.md owns this check instead —
see its "Read the reference slice" step.

Root `package.json` scripts mirror everything through turbo:

```bash
pnpm pkg set \
  scripts.dev="turbo run dev" \
  scripts.build="turbo run build" \
  scripts.typecheck="turbo run typecheck" \
  scripts.lint="turbo run lint" \
  scripts.format="turbo run format" \
  scripts.test="turbo run test" \
  'scripts["test:unit"]=turbo run test:unit' \
  'scripts["test:integration"]=turbo run test:integration' \
  'scripts["format:changed"]=git diff --name-only --diff-filter=ACMR HEAD | xargs -r prettier --write --ignore-unknown --cache' \
  'scripts["docs:check"]=node scripts/docs-check.mjs' \
  'scripts.verify=pnpm format:changed && pnpm docs:check && turbo run lint typecheck test:unit --filter="...[HEAD]"'
```

## `docs:check` — this plan is executable, so check it

Every file below is a `cat > … <<'EOF'` heredoc and every script a `pnpm pkg set`, which
makes this plan mechanically comparable to the repo it describes. That matters because
the two drift _invisibly_: a heredoc that is not already prettier-formatted gets rewritten by
the first `pnpm format`, and disagrees silently from then on. Reading carefully does not catch
it; diffing does.

````bash
mkdir -p scripts
cat > scripts/docs-check.mjs <<'EOF'
#!/usr/bin/env node
// Compare __DOCS__ — the plan of record — against the repo it describes.
//
// The plan is executable: every file is a `cat > … <<'EOF'` heredoc and every script a
// `pnpm pkg set`. That makes drift mechanically checkable, which matters because it is
// invisible by eye: a doc block that is not prettier-formatted gets rewritten by
// `pnpm format` on first contact and silently disagrees from then on.
//
// Three checks, matching the three ways the plan configures a package:
//   1. file contents vs the file on disk         (composed — see below)
//   2. `pnpm pkg set scripts.x=…` vs package.json
//   3. `pnpm pkg set field=…` / `pnpm pkg delete field` vs package.json
//
// A path's expected contents are COMPOSED, not taken from a single block. The last
// `cat >` heredoc is the base, and every ```diff hunk after it is applied in slice order;
// the result is what disk must equal. That exists because the alternative rots: when a
// later slice only *adds* to a shared file, writing it whole means copying someone else's
// heredoc, and only the last copy was ever compared — so amending the upstream slice left
// every copy above it silently wrong. A slice that adds three catalog entries now says so
// in three lines, and a hunk that stops applying is a hard error naming the file, which is
// the upstream amendment announcing itself.
//
// Package context comes from following `cd` through the plan, in line order: a trailing
// `cd ../..` must not be applied to heredocs written earlier in the same block. The plan
// is one file per slice and a slice does not always `cd` back to the root before it ends,
// so the slice files are read in filename order — which is what the numeric prefixes are
// for. Nothing but slice files lives here, so that order is total and the `cwd` it threads
// is the plan's own: any other .md dropped into this directory joins the chain at its
// filename's position, and one carrying a `cd` would silently move every slice after it.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC = "__DOCS__";
const slices = readdirSync(join(REPO, DOC))
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map((f) => [f, readFileSync(join(REPO, DOC, f), "utf8")]);

const DELETED = Symbol("deleted");
const ops = new Map(); // repo-relative path -> [{ slice, body } | { slice, hunks }]
const scripts = new Map(); // package dir -> Map(script -> command)
const fields = new Map(); // package dir -> Map(field -> value | DELETED)

const put = (m, pkg, k, v) => {
  if (!m.has(pkg)) m.set(pkg, new Map());
  m.get(pkg).set(k, v);
};

/** Resolve a `cd` target. The doc does not always return to the root between slices, so
 *  a target naming a top-level workspace directory is treated as repo-relative. */
function resolveCd(base, target) {
  if (target.startsWith("apps/") || target.startsWith("packages/"))
    return target;
  if (target === "../..") return "";
  if (target.startsWith("../../")) return target.slice("../../".length);
  const r = normalize(base ? join(base, target) : target);
  return r === "." ? "" : r;
}

const op = (rel, o) => {
  if (!ops.has(rel)) ops.set(rel, []);
  ops.get(rel).push(o);
};

/** Split a ```diff body into hunks. `@@` lines separate them and carry nothing the
 *  checker needs — the anchor is the context, not a line number the doc would have to
 *  keep true. A line that is neither + nor - is context, with one leading space stripped
 *  if present: prettier trims trailing whitespace in markdown, so a blank context line
 *  reaches us as "" rather than " ". */
function hunksOf(body) {
  // The newline before the closing fence splits into a trailing "", which would become an
  // empty context line the base has no reason to carry — every hunk would fail to anchor.
  if (body.at(-1) === "") body = body.slice(0, -1);

  const out = [[]];
  for (const line of body) {
    if (/^@@/.test(line)) out.push([]);
    else if (line !== "\\ No newline at end of file") out.at(-1).push(line);
  }
  return out.filter((h) => h.some((l) => l.trim()));
}

let cwd = "";
// The fence length is captured and back-referenced so a longer fence can contain a
// shorter one. This file is itself embedded in the doc and contains a fence in the
// regex above, so its block is written with four backticks; matching greedily on
// three would truncate it silently — which is exactly the drift this tool exists to
// catch, and did catch, on itself.
//
// `cd` state carries across slice files, so the slices are walked in filename order and
// share one `cwd`. A ```diff header names a repo-relative path and is deliberately not
// cwd-sensitive: a delta is read where the change is explained, which is not always where
// the shell happens to be standing.
for (const [slice, text] of slices) {
  for (const [, , lang, block] of text.matchAll(
    /(`{3,})(bash|diff)\n([\s\S]*?)\1/g,
  )) {
    const lines = block.split("\n");

    if (lang === "diff") {
      const head = lines[0]?.match(/^--- (\S+)$/);
      if (!head) continue; // an illustrative diff, not a claim about a file
      op(normalize(head[1]), { slice, hunks: hunksOf(lines.slice(1)) });
      continue;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const hd = line.trim().match(/^cat > (\S+) <<'EOF'$/);
      if (hd) {
        const body = [];
        i++;
        while (i < lines.length && lines[i] !== "EOF") body.push(lines[i++]);
        op(normalize(join(cwd, hd[1])), { slice, body: body.join("\n") });
        continue;
      }
      if (line.trim().startsWith("#")) continue;

      const cd = line.match(/(?:mkdir -p \S+ && )?\bcd (\S+)/);
      if (cd) cwd = resolveCd(cwd, cd[1]);

      for (const m of line.matchAll(/scripts\.([A-Za-z0-9_-]+)="([^"]*)"/g))
        put(scripts, cwd, m[1], m[2]);
      for (const m of line.matchAll(/'scripts\["([^"]+)"\]=([^']*)'/g))
        put(scripts, cwd, m[1], m[2]);
      for (const m of line.matchAll(
        /pnpm pkg set ([A-Za-z][A-Za-z0-9_-]*)="([^"]*)"/g,
      ))
        if (m[1] !== "scripts") put(fields, cwd, m[1], m[2]);
      for (const m of line.matchAll(
        /pnpm pkg delete ([A-Za-z][A-Za-z0-9_.-]*)/g,
      ))
        if (!m[1].includes(".")) put(fields, cwd, m[1], DELETED);
    }
  }
}

// Baseline of known-expected mismatches (see docs-check.ignore for why they exist).
const ignorePath = join(REPO, "scripts/docs-check.ignore");
const ignored = new Map(); // key -> reason
if (existsSync(ignorePath)) {
  for (const line of readFileSync(ignorePath, "utf8").split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const [key, ...rest] = s.split(/\s+#\s*/);
    ignored.set(key.trim(), rest.join(" ") || "no reason given");
  }
}
const usedIgnores = new Set();
/** Route a mismatch to the baseline when it is listed there. */
const report = (key, message) => {
  if (ignored.has(key)) usedIgnores.add(key);
  else drift.push(message);
};

const drift = [];
const pending = [];
// A doc value built by shell substitution cannot be compared literally.
const literal = (v) => typeof v === "string" && !v.includes("$(");
const byKey = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

/** Apply one hunk to `lines`, anchored on its context rather than a line number.
 *
 *  The match must be unique. An ambiguous hunk is not a near miss to be resolved by
 *  picking the first occurrence — it means the context does not identify the place, and
 *  guessing would let the doc claim a change it did not describe. */
function applyHunk(lines, hunk) {
  const before = [];
  const after = [];
  for (const l of hunk) {
    if (l.startsWith("+")) after.push(l.slice(1));
    else if (l.startsWith("-")) before.push(l.slice(1));
    else {
      const c = l.startsWith(" ") ? l.slice(1) : l;
      before.push(c);
      after.push(c);
    }
  }
  if (!before.length)
    return { error: "hunk has no context or removed lines to anchor on" };

  const at = [];
  for (let i = 0; i + before.length <= lines.length; i++)
    if (before.every((l, j) => lines[i + j] === l)) at.push(i);

  if (at.length === 0) {
    // Name the line the hunk stopped agreeing on, not its first line. The longest prefix
    // that still matches somewhere points at what the upstream slice changed; reporting
    // `before[0]` instead sends you to a line that is usually still correct.
    let best = 0;
    for (let n = 1; n <= before.length; n++) {
      const head = before.slice(0, n);
      const found = lines.some((_, i) =>
        head.every((l, j) => lines[i + j] === l),
      );
      if (!found) break;
      best = n;
    }
    return {
      error: `hunk does not apply — the doc expects this line and the base no longer has it:\n      ${before[best]}`,
    };
  }
  if (at.length > 1)
    return { error: `hunk is ambiguous — context matches ${at.length} places` };

  return {
    lines: [
      ...lines.slice(0, at[0]),
      ...after,
      ...lines.slice(at[0] + before.length),
    ],
  };
}

/** The doc's expected contents for a path: the last whole-file heredoc, plus every
 *  delta written after it, in slice order. */
function compose(rel, list) {
  const base = list.findLastIndex((o) => o.body !== undefined);
  if (base === -1) {
    drift.push(
      `${rel} — a ${list[0].slice} delta with no heredoc to apply it to`,
    );
    return null;
  }
  let lines = list[base].body.split("\n");
  for (const o of list.slice(base + 1)) {
    for (const hunk of o.hunks) {
      const r = applyHunk(lines, hunk);
      if (r.error) {
        // Never baselined. This is the doc disagreeing with itself, which no build
        // state excuses — and it is what an amended upstream slice looks like.
        drift.push(`${rel} — ${o.slice}: ${r.error}`);
        return null;
      }
      lines = r.lines;
    }
  }
  return lines.join("\n");
}

for (const [rel, list] of [...ops].sort(byKey)) {
  const want = compose(rel, list);
  if (want === null) continue;
  const f = join(REPO, rel);
  if (!existsSync(f)) {
    // Absent AND baselined is the baseline doing its job, not a stale entry. Two of the
    // permanent entries name gitignored files, so a fresh clone has neither — and a
    // missing file never reached report(), which left those entries looking unused and
    // failed the check on every clone before the first `pnpm dev`. Only an unbaselined
    // path is genuinely "not built yet".
    if (ignored.has(rel)) usedIgnores.add(rel);
    else pending.push(`${rel} — not built yet`);
  } else if (
    readFileSync(f, "utf8").replace(/\n+$/, "") !== want.replace(/\n+$/, "")
  ) {
    report(rel, `${rel} — contents differ from the doc`);
  }
}

const pkgJson = (pkg) => {
  const f = join(REPO, pkg, "package.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
};

for (const [pkg, want] of [...scripts].sort(byKey)) {
  const pj = pkgJson(pkg);
  if (!pj) continue;
  const have = pj.scripts ?? {};
  for (const [name, cmd] of [...want].sort(byKey)) {
    if (!literal(cmd)) continue;
    if (!(name in have))
      pending.push(`${pkg || "(root)"}: script \`${name}\` — not added yet`);
    else if (have[name] !== cmd)
      report(
        `${pkg}:${name}`,
        `${pkg || "(root)"}: script \`${name}\`\n    doc:  ${cmd}\n    repo: ${have[name]}`,
      );
  }
}

for (const [pkg, want] of [...fields].sort(byKey)) {
  const pj = pkgJson(pkg);
  if (!pj) continue;
  for (const [name, val] of [...want].sort(byKey)) {
    if (val === DELETED) {
      if (name in pj)
        drift.push(
          `${pkg || "(root)"}: \`${name}\` should be deleted, still ${JSON.stringify(pj[name])}`,
        );
    } else if (!literal(val)) {
      continue;
    } else if (!(name in pj)) {
      drift.push(
        `${pkg || "(root)"}: \`${name}\` missing — doc sets it to ${JSON.stringify(val)}`,
      );
    } else if (pj[name] !== val) {
      drift.push(
        `${pkg || "(root)"}: \`${name}\`\n    doc:  ${JSON.stringify(val)}\n    repo: ${JSON.stringify(pj[name])}`,
      );
    }
  }
}

if (pending.length) {
  console.log(
    `Not built yet (${pending.length}) — expected while the scaffold is in progress:`,
  );
  for (const p of pending) console.log(`  · ${p}`);
  console.log("");
}
if (usedIgnores.size) {
  console.log(
    `Baselined (${usedIgnores.size}) — see scripts/docs-check.ignore:`,
  );
  for (const k of usedIgnores) console.log(`  · ${k} — ${ignored.get(k)}`);
  console.log("");
}
// Drift prints before the stale-baseline report and neither returns early: a run that
// exits on a stale entry hides the real failure underneath it, which is the wrong way
// round — a stale line is bookkeeping, drift is the thing the tool is for.
if (drift.length) {
  console.error(`Drift between ${DOC} and the repo (${drift.length}):`);
  for (const d of drift) console.error(`  ✗ ${d}`);
  console.error(
    `\nFix whichever is wrong — the doc is the plan of record, but prettier owns formatting.`,
  );
}
const stale = [...ignored.keys()].filter((k) => !usedIgnores.has(k));
if (stale.length) {
  console.error(
    `\nStale entries in scripts/docs-check.ignore (${stale.length}) — these no longer`,
  );
  console.error(`mismatch, so the baseline is hiding nothing. Delete them:`);
  for (const s of stale) console.error(`  ✗ ${s}`);
}
if (drift.length || stale.length) process.exit(1);
const deltas = [...ops.values()].reduce(
  (n, l) => n + l.filter((o) => o.hunks).length,
  0,
);
console.log(
  `No drift: ${ops.size} files (${deltas} composed from deltas) and ${[...scripts.values()].reduce((n, m) => n + m.size, 0)} scripts match ${DOC}.`,
);
EOF
cat > scripts/docs-check.ignore <<'EOF'
# Known-expected mismatches, one per line, with the reason.
#
# Mid-build mismatches do NOT belong here. __DOCS__ holds a slice file only once that
# slice has been built, so the plan never describes a rewrite the repo has not reached —
# the one exception being the slice you are standing in, where a mismatch is your
# remaining work rather than something to baseline.
#
# The script fails on entries that no longer mismatch, so this file cannot quietly rot.
#
# Files: repo-relative path. Scripts: <package dir>:<script name>.
#
# An entry is added by the slice that makes it true, never in advance. The check fails on
# an entry nothing mismatches, and a path no installed slice even describes mismatches
# nothing — so a baseline written ahead of its slice fails from the moment it is written.
EOF
````

It runs inside `pnpm verify`, after `format:changed` so it compares formatted files. Three
checks, matching the three ways this doc configures a package: file contents against files,
`scripts.*` against `package.json`, and top-level fields including `pnpm pkg delete`. When it
reports drift, fix whichever side is wrong — this doc is the plan of record, but prettier owns
formatting, so the doc is usually the one to update.

A path's expected contents are **composed**: the last `cat >` heredoc is the base, and every
` ```diff ` block after it is applied on top, in slice order. That is what lets a later slice
add two catalog entries by writing two lines instead of recopying someone else's heredoc —
and recopying is the failure worth designing out, because only the last copy is ever compared,
so amending an upstream slice leaves every copy above it wrong and unread. A hunk anchors on
its context, never a line number, and a hunk that stops applying fails the run by name. That
failure _is_ the upstream amendment announcing itself.

Two deliberate limits. A file the doc has not created yet is reported as _not built_ rather
than drift, since the scaffold is built in order. And when a later slice changes a file an
earlier slice created, the repo sits at the earlier version until that slice lands — the check
cannot tell that from real drift, so those go in `docs-check.ignore` with a reason. Stale
entries fail the run, so the baseline cannot quietly rot into a blanket suppression.

The baseline file ends up listing itself, for that second reason: the block above writes it
whole, and every later slice that adds a baseline entry before this one is rebuilt adds it to
this file — so it drifts from this heredoc by construction. It is the one file whose contents
the doc owns only here.

## Keeping runs fast as the repo grows

Three layers, cheapest first — this is what keeps an AI coding agent's loop tight:

1. **Turbo cache (always on, free).** `pnpm typecheck` / `pnpm test` are only "full" the
   first time — packages whose inputs didn't change are near-instant cache hits. This is the
   safety net that makes running everything affordable.
2. **`pnpm verify` — THE inner-loop command, scoped to uncommitted work.** It formats the
   files touched since the last commit, then runs lint + typecheck + unit tests for the packages
   with uncommitted changes **plus their dependents** — `--filter="...[HEAD]"` means changing
   `packages/db` re-checks `apps/graphql` too, because the package graph knows the API depends
   on db.
   Unit tests only — no Docker needed, so it's always runnable. This is the one command to
   run while iterating and before committing.
3. **Full runs at slice gates and CI.** `pnpm lint && pnpm typecheck && pnpm test` (integration
   included, Docker up) at each slice's local gate and in CI — layer 1 makes this cheap, and it
   catches anything the changed-scope view missed.

Two sharper tools for later, when even this feels slow: vitest's `--changed` flag narrows to
test files related to changed source files (file-level, not package-level), and turbo's
`--affected` compares against `main` instead of `HEAD` — the right filter for CI on a PR
branch rather than the inner loop.

**Standard package setup — the contract.** Every workspace package with source code ships
the same five pieces, so root `pnpm test` etc. fans out to everything (`packages/config` is
exempt: it's config-only, which is also why its placeholder `test` script was deleted above —
it _provides_ the shared configs rather than consuming them):

1. **`vitest` as a devDep** — the one per-package install. prettier and eslint need no
   install: pnpm puts the workspace root's `node_modules/.bin` on the PATH for package
   scripts, so the single root copy of each serves every package.
2. **Six scripts**: `typecheck` (`tsc --noEmit`), `lint` (`eslint . --max-warnings 0`),
   `format` (`prettier --write .`), `test` (`vitest run`), and `test:unit` /
   `test:integration` (`vitest run --project …`).
3. **An `eslint.config.mjs`** re-exporting the shared base:
   `import base from "../../packages/config/eslint.base.mjs"; export default [...base];`
   (`apps/web` appends the Next.js configs to it — see Slice 1.)
4. **A `vitest.config.ts`** splitting tests into two projects. Naming convention: unit tests
   live next to code as `*.test.ts`; integration tests end in `*.int.test.ts`. `test` runs
   both projects; `test:unit` stays fast and dependency-free; `test:integration` requires
   Docker up. `passWithNoTests` keeps both green until real tests land — it belongs on the
   root `test` object, not inside a project: `ProjectConfig` rejects it at typecheck, and a
   project that ignores it exits 1 on an empty run.
5. **A `tsconfig.json`** extending the shared base, without which the `typecheck` script
   fails (`tsc --noEmit` needs a config). Two exceptions: `apps/web` keeps the one
   create-next-app generates, and `apps/graphql` uses a Workers-types variant.
6. **At least one test that actually runs**, before the package's slice is called done. Every
   slice below writes its tests as literal files for this reason — a test described in prose
   is a test that doesn't exist.

**`--max-warnings 0` is load-bearing, not strictness theatre.** ESLint exits 0 when a run
produces only warnings, and `eslint-config-next` sets several rules — including
`no-unused-vars` — to `warn` rather than `error`. Without the flag the _same_ unused variable
fails the gate in `apps/graphql` and passes it in `apps/web`, which is the kind of silent
per-package asymmetry that makes a green run mean nothing. The flag makes "lint passed" mean
zero problems, everywhere. A rule genuinely not worth failing on gets turned off in the shared
base, where the decision is visible.

**Read the test count, not the exit code.** `passWithNoTests` makes an empty run green, so a
package with zero tests and a package whose tests all pass are indistinguishable from the exit
code alone. That is a deliberate trade — it lets the harness exist from Slice 0 — but it means
a green `pnpm test` is not evidence that anything was verified. At every gate, confirm vitest
reported `Tests N passed` with the N you expect. This is the one failure mode the harness
cannot catch for you.

**Anything that acts on production is suffixed `:production`** — `deploy:production`,
`migrate:production`. A bare script name never touches production. The suffix also avoids a
builtin collision: `deploy` is a real pnpm command (`pnpm --filter <pkg> deploy <dir>`), so a
script literally named `deploy` loses to it under `--filter` and silently never runs. No
package has either script yet — Slice 1 writes the first `deploy:production` — but the name
is decided once, here, so every later slice inherits it instead of reinventing it.

`packages/mock` above is the first real exercise of it. The same commands appear again in
each of Slices 1–3, right where each real package is created, so they always run from the
package's own directory (from the repo root, the `pnpm add` would error with
`ERR_PNPM_ADDING_TO_ROOT` and the `pkg set` would clobber the turbo scripts above).

Start `CLAUDE.md` now, not at the end, with the rule that will govern every later addition to
it: it is read on every turn whether or not it's relevant, so it holds only facts (the package
map) and the one thing about a layer nobody can be allowed to miss — never a procedure, which
belongs in a skill and costs nothing until its description matches, and never the setup
discipline that builds this scaffold (`docs/setup/`, the two-gate build loop, `docs:check`) —
that belongs to the `setup-project` skill that reads this file, not to this file, because a
day-to-day session extending the product never runs `/setup-project`. At Slice 0 there is no
skill yet to point to, so it starts as just the package map:

```bash
cat > CLAUDE.md <<'EOF'
# __PROJECT__

pnpm workspace. What is in it:

- `packages/config` — shared tsconfig and ESLint base, extended by every package.
- `packages/mock` — throwaway harness smoke test, not part of the stack. Delete it
  once a real package or app exists.
EOF
```

**It lists what exists, not what is planned — and this file originally got that wrong.** The
first version of this block wrote the whole intended stack up front — `apps/web`,
`apps/graphql`, `packages/db` — and at Slice 0 not one of them existed. That is a forecast,
and it breaks the rule `setup-project` states for itself — no slice assumes a later one will ever be
built, because which slices get built is decided at dispatch, by the person running it, not
here. A `CLAUDE.md` naming `packages/db` in a repo that has no database does active harm:
it is loaded on _every_ turn, so every session extending the product starts out believing in
a package it cannot import, and the file that is supposed to be the one reliable map becomes
the least reliable thing in the repo.

Each slice adds its own line as it lands. That is why the entries are a list rather than a
sentence — a list takes a one-line delta, which is exactly what the composition in
`docs:check` is built to verify.

**Gate (local only)** — from the repo root:

| Check            | Expect                                                                    |
| ---------------- | ------------------------------------------------------------------------- |
| `pnpm install`   | clean, no `ERR_PNPM_IGNORED_BUILDS`                                       |
| `pnpm typecheck` | pass                                                                      |
| `pnpm lint`      | pass — `packages/mock` is the only package with a `lint` script           |
| `pnpm format`    | pass                                                                      |
| **Tests**        | **1 passed — `packages/mock`'s smoke test. Back to 0 once it's deleted.** |

Commit.

**Gate (local only)** — from the repo root:

| Check            | Expect                                                                    |
| ---------------- | ------------------------------------------------------------------------- |
| `pnpm install`   | clean, no `ERR_PNPM_IGNORED_BUILDS`                                       |
| `pnpm typecheck` | pass                                                                      |
| `pnpm lint`      | pass — `packages/mock` is the only package with a `lint` script           |
| `pnpm format`    | pass                                                                      |
| **Tests**        | **1 passed — `packages/mock`'s smoke test. Back to 0 once it's deleted.** |

Commit.

## Sources and findings

The documentation this slice's §3 research rests on, and what running it actually turned up —
kept here rather than in a shared bibliography so that reading the slice is reading its
evidence. **Every version and claim below is dated.** A pin is only as good as its date;
re-check rather than inherit, and add a dated entry when you do (SKILL.md §7).

### Sources

- [Vite env variables and modes](https://vite.dev/guide/env-and-mode) (what vitest inherits)

### 2026-08-30 — Slice 0

Registry (`npm view <pkg> version`, and `peerDependencies` where it decides a pin):

| Package           | Found   | Decision                                                             |
| ----------------- | ------- | -------------------------------------------------------------------- |
| typescript        | 7.0.2   | **Pin 6.0.3.** typescript-eslint 8.68.0 still peers `>=4.8.4 <6.1.0` |
| typescript-eslint | 8.68.0  | Still caps TS below 6.1 — the reason for the TS pin has not lapsed   |
| eslint            | 10.9.1  | **Bumped from ^9.39.5**, which npm reports deprecated                |
| @eslint/js        | 10.0.1  | Follows eslint's major; installed unpinned                           |
| @types/node       | 26.4.0  | **Pin 24.13.3** — track the Node major in `.nvmrc`, not `latest`     |
| turbo             | 2.10.12 | Unchanged                                                            |
| prettier          | 3.9.6   | Unchanged                                                            |
| vitest            | 4.1.11  | Unchanged                                                            |

Behaviour, reproduced rather than assumed:

- `pnpm init` on pnpm 11.15.1 still writes `devEngines.packageManager` with a caret
  (`"version": "^11.15.1", "onFail": "download"`). The deletion step is still required.
- `pnpm add -D typescript` installed 7.0.2; the `catalog:` pin pulled it back to 6.0.3 on
  the next `pnpm install`. The pin is load-bearing today, not defensive.
- eslint 10.9.1 + @eslint/js 10.0.1 + typescript-eslint 8.68.0 install with no peer warnings.
  `eslint-config-next` against eslint 10 is **not yet verified** — Slice 1's lint gate is
  the first thing that will exercise it.

### 2026-08-31 — Slice 0, first full execution

Every registry pin above re-checked and **unchanged**: typescript 7.0.2 latest with 6.0.3
the newest 6.x, typescript-eslint 8.68.0 still peering `>=4.8.4 <6.1.0`, eslint 10.9.1,
@types/node 26.4.0 latest with 24.13.3 the newest 24.x, turbo 2.10.12, prettier 3.9.6,
vitest 4.1.11. Docs re-read: `allowBuilds` is confirmed as the pnpm 11 replacement for
`onlyBuiltDependencies` (and four other build settings), and vitest 4 still takes inline
`{ test: { name, include } }` project objects with `passWithNoTests` only at the root.

First run of this slice end to end, on Node 24.18.0 / pnpm 11.15.1. It needed no
corrections — every block ran as written and the gate passed on the first attempt, with
`docs:check` reporting no drift across 9 files and 16 scripts. Two behaviours worth
recording exactly:

- The `devEngines` trap is not theoretical. With the block `pnpm init` writes still in
  place, **every** pnpm command fails with
  `Invalid package manager specification in package.json (pnpm@^11.15.1); expected a semver version` —
  which is why the deletion step uses node. Deleting it restored `pnpm -v` immediately.
- `pnpm add -D turbo typescript` resolved typescript to `^7.0.2`, and the `catalog:` pin
  moved it to 6.0.3 on the next install, logged as `- typescript 7.0.2 / + typescript 6.0.3`.

`eslint-config-next` against eslint 10 remains **unverified** — Slice 1 is still the first
thing that will exercise it.

## Leaves behind

Read by Slice 99 (the audit), which treats this as a **cross-check and never as the source of truth** —
the code is that. An entry here is a claim about the repo; where the two disagree, the code
wins and this table is the finding.

**Provisional** is something built to prove a mechanism, with the condition that retires it.
**Accepted** is a risk taken knowingly, with the reasoning written down so a later slice can
re-decide it rather than rediscover it.

### Provisional

| Artifact        | Why it exists                                                                 | Retired when                                                   |
| --------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `packages/mock` | Proves the turbo/lint/test harness fans out, when no real package exists yet. | The first slice that adds a real workspace package removes it. |

### Accepted

| Risk                                                | Reachable by                            | Why this is the right trade                                                                                                                                                                   |
| --------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowBuilds` runs postinstall for esbuild, workerd | Anyone who can land a dependency update | Postinstall is blocked by default; these two fetch the platform binaries the runtime and bundler _are_. Everything else stays blocked, and the list is short enough to re-read on every bump. |
