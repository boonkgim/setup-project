# Slice 2 — GraphQL: the Worker and its contract

The API app, end to end in one slice: a GraphQL Yoga Worker on workerd, the schema split into
modules beside the resolvers implementing them, the server half generated from those modules,
the typed client in `apps/web`, that contract rendered in the browser over a service binding,
and a plain config value proven to differ between local and production — observable in both the
browser and the Worker — using the file convention Slice 0 set.

**Why the Worker and the contract are one slice and not two.** They were two, and the split
did not survive its own criterion: a Worker whose whole schema is `health: String!` serves
nobody, and a contract needs a server to answer it, so neither half is a place anyone would
sensibly stop. The skill builds one slice per invocation and stops when it is committed, which
made "stop after the Worker" a completely ordinary thing to do and left a deployed, public
endpoint that did nothing. Two things pointless apart are one slice.

The shape of that slice is the one decision worth stating up front, because the obvious
alternative is a `packages/graphql` holding the SDL and its generated types, imported by both
apps. That splits a schema from the resolvers that satisfy it, which is exactly the pair that
must change together — and buys nothing, because the only thing `apps/web` needs is the
printed contract, which is a committed file it can read by path. So the SDL lives here, next to
its implementation, and the web app reads the artifact.

The previous slice left you in `apps/web`; the first line below returns to the repo root. It is
a line of its own on purpose — folded into the `mkdir` line as `cd ../.. && mkdir …`, the
`docs:check` parser reads only the first `cd` and loses track of the package every later heredoc
belongs to.

## The Worker package

```bash
cd ../..   # from wherever the previous slice ended
mkdir -p apps/graphql && cd apps/graphql && pnpm init
pnpm pkg set name="@__PROJECT__/graphql"
pnpm pkg delete main   # `pnpm init` points it at an index.js that never exists
pnpm add graphql-yoga graphql@^17   # pin the major deliberately — see below
pnpm add -D wrangler
pnpm add -D typescript@catalog:   # not bare `typescript` — that resolves npm's latest and breaks the alignment
```

**Pin `graphql`'s major rather than taking npm's `latest`.** graphql is on 17.x and is now
`latest`, so a bare `pnpm add graphql` crosses a major without saying so, and this package's
version is the one every later slice inherits. Check the peer ranges before choosing — as of
2026-08-31 every tool in the chain accepts 17:

| Package                                    | Version | `graphql` peer                      |
| ------------------------------------------ | ------- | ----------------------------------- |
| `graphql`                                  | 17.0.2  | —                                   |
| `graphql-yoga`                             | 5.22.0  | `^15.2.0 \|\| ^16.0.0 \|\| ^17.0.0` |
| `@graphql-codegen/cli`                     | 7.3.1   | `… \|\| ^16.0.0 \|\| ^17.0.0`       |
| `@graphql-codegen/client-preset`           | 6.1.3   | `… \|\| ^16.0.0 \|\| ^17.0.0`       |
| `@eddeee888/gcg-typescript-resolver-files` | 0.18.4  | `^15.0.0 \|\| ^16.0.0 \|\| ^17.0.0` |
| `@graphql-tools/schema`                    | 10.1.0  | `^14.0.0 \|\| … \|\| ^17.0.0`       |
| `@graphql-tools/utils`                     | 12.0.0  | `^14.0.0 \|\| … \|\| ^17.0.0`       |

Two peers in that set are declared **optional** and so print nothing on install:
`@parcel/watcher` on the CLI (only `--watch` needs it) and `graphql-sock` on the client preset.
Neither is installed. Verify rather than assume, and fall back to the last 16.x if some tool in
the chain has not caught up.

`wrangler` is worth pinning to whatever `apps/web` already resolved, so one workerd serves the
whole workspace and `compatibility_date` has a single cap to read.

The directory is `apps/graphql`, not `apps/api`, because this app is where the schema lives
as well as the server that answers it — "api" would name the transport and hide
the contract. The _deployed_ Worker is a separate question, answered in `wrangler.jsonc` below.

`tsconfig.json` — the standard one plus `skipLibCheck`. No `"types"` entry: the Workers
runtime types are generated into `src/` a few blocks below, and `include` already covers
them.

```bash
cat > tsconfig.json <<'EOF'
{
  "extends": "../../packages/config/tsconfig.base.json",
  // skipLibCheck is load-bearing here, not hygiene: the Workers runtime types
  // redeclare ~100 globals (Response, WebSocket, crypto, ...) that also exist in
  // lib.dom.d.ts, which a Yoga dependency (@whatwg-node/server) force-loads via
  // `/// <reference lib="dom" />` — so narrowing `lib` cannot avoid the collision.
  // apps/web never hit this because Next.js's own tsconfig sets skipLibCheck.
  //
  // Those runtime types are no longer a package. `wrangler types` emits them into
  // src/worker-env.d.ts alongside WorkerEnv, which `include` already covers, so
  // there is nothing to list in "types" — that is what replaced the
  // @cloudflare/workers-types entry, and why the generated file is committed.
  "compilerOptions": {
    "skipLibCheck": true
  },
  "include": ["src"]
}
EOF
```

Without `skipLibCheck`, `pnpm typecheck` fails with a wall of `TS6200: Definitions of the
following identifiers conflict with those in another file` and `TS2403` before any of your
own code is checked.

`wrangler.jsonc`:

```bash
cat > wrangler.jsonc <<'EOF'
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  // Renamed from "__PROJECT__-api". A Worker's name is its identity, not a label: this
  // deploy created a new Worker rather than renaming the old one, so the migration was
  // deploy this, repoint apps/web's `API` binding, deploy web, then delete the old
  // Worker. The public URL moved to __PROJECT__-graphql.<account>.workers.dev with it.
  "name": "__PROJECT__-graphql",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-07",
  "compatibility_flags": ["nodejs_compat"],
}
EOF
```

The comment is worth reading once and then trusting: a Worker's name is its identity on
Cloudflare, so `name` is not a label you get to keep in sync with the directory for free.
`apps/web`'s service binding, added later in this slice, names this Worker, the workers.dev URL is derived from
it, and there is no rename operation — only "deploy the new one, repoint what binds to it,
deploy that, delete the old one". This repo has already paid that cost once: the Worker was
`__PROJECT__-api` until the directory became `apps/graphql` and the two names were made to agree,
which is why the comment reads like history. Directory names are free to change; this one costs
a deploy sequence.

**`compatibility_date` is capped by the workerd bundled with the installed wrangler, not by
today's date** — the same rule Slice 1 states. Read it off
`npm view wrangler@<version> dependencies` and set both Workers to it, so the workspace has
one runtime rather than a per-app skew. The date above is stale by construction; check it.

**The trailing comma after `compatibility_flags` is prettier's, not a typo.** Prettier parses
`.jsonc` as JSON5 and adds it on first contact, so a heredoc written without it disagrees with
the plan the moment `pnpm format` runs — `docs:check` then reports drift on a file nobody
edited. Write these blocks post-format.

The standard package setup, minus its `tsconfig.json` — the Workers variant above replaces
it:

```bash
pnpm add -D vitest
pnpm pkg set \
  scripts.typecheck="tsc --noEmit" \
  scripts.lint="eslint . --max-warnings 0" \
  scripts.format="prettier --write . --ignore-path ../../.gitignore --ignore-path ../../.prettierignore" \
  scripts.test="vitest run" \
  'scripts["test:unit"]=vitest run --project unit' \
  'scripts["test:integration"]=vitest run --project integration'
```

(Two `--ignore-path`s, not one. `--ignore-path` _replaces_ prettier's default ignore
list rather than adding to it, and that default is `.gitignore` — so the single-flag
form switches gitignore-based exclusion off and `pnpm format` reformats build output.
Slice 0 states the rule and Slice 1 is where it was discovered; this line is one of the
sibling commands that kept the pre-correction form until 2026-08-31.)

```bash
cat > eslint.config.mjs <<'EOF'
import base from "../../packages/config/eslint.base.mjs";

export default [...base];
EOF
```

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

Then the app-specific scripts, including the one that writes the types:

```bash
pnpm pkg set scripts.dev="wrangler dev" \
  'scripts["deploy:production"]=wrangler deploy' \   # + --env-file .env.production if Slice 1 needed one
  'scripts["cf-typegen"]=wrangler types --env-interface WorkerEnv src/worker-env.d.ts --strict-vars false'
mkdir -p src   # wrangler types writes into src/ but will not create it
pnpm cf-typegen
```

**`mkdir -p src` is not tidiness — without it `pnpm cf-typegen` fails.** `wrangler types`
generates the runtime types, prints `Runtime types generated.`, and _then_ dies writing them:
`✘ [ERROR] A file or directory could not be found. Missing file or directory:
src/worker-env.d.ts`. It creates the file but not the directory holding it, and the error names
the file rather than the missing directory, which reads like a path typo. This is the first
command in the package that writes anything into `src/`, so it is the one that discovers it.

**`--strict-vars false` is load-bearing too, and the reason arrives a few blocks below** — where
`vars` land in `wrangler.jsonc`. It is set here rather than there so the script is written once.

**If Slice 1's Cloudflare login carried more than one account, this Worker needs the same
`--env-file` treatment.** A bare `wrangler deploy` fails with
`More than one account available but unable to select one in non-interactive mode`, exactly as
it did for `apps/web`. The fix is not new — follow the convention Slice 1 already set: a
gitignored `.env.production` holding `CLOUDFLARE_ACCOUNT_ID`, a committed `.env.example`
documenting it, and `wrangler deploy --env-file .env.production` (a current, documented flag)
so only the deploy script can read it and the id stays out of the committed `wrangler.jsonc`.
Skip all of it if the login resolves to a single account.

**Wrangler prints a second `Action required` on `nodejs_compat`: install `@types/node`.** It
is advisory, and the answer here is no. This Worker imports no `node:` module and `typecheck`
passes clean without it; because this tsconfig has no `"types"` entry to narrow what gets
picked up, adding it would pull every Node global into a package whose whole point is the
workerd surface. Install it — as `@types/node@catalog:`, never bare — when something actually
imports from `node:`.

**The Workers types are generated, not installed.** `wrangler types` emits the runtime
globals — `Request`, `Response`, `crypto`, and the rest — into `src/worker-env.d.ts`, built
from the workerd version your `compatibility_date` and flags actually select. That is the
supersession of `@cloudflare/workers-types`: a package pinned by semver could disagree with
the runtime you deploy to, and this cannot. Wrangler prints an `Action required` notice if it
finds that package still installed.

The file is emitted under `src/` so the existing `include` covers it with no `"types"` entry
to maintain, and it is **committed** — a fresh clone fails `typecheck` without it. Re-run
`pnpm cf-typegen` and commit whenever `wrangler.jsonc` changes; the same command grows a
`WorkerEnv` interface as bindings and vars arrive — this slice adds its first `vars` further
down, and the slice that adds a database adds the `HYPERDRIVE` binding to the same file.

`src/index.ts` is deliberately not written yet. The schema it serves does not exist as a
hand-written file at all — it is assembled from the modules below, and the entry point is
written once, after codegen, further down. A hello-world `typeDefs` here would only be
something to delete.

## The SDL, split into modules

One directory per bounded slice of the schema, each holding its own `schema.graphql` and the
resolvers for the fields it declares. Today there is exactly one — `system`, the version and
health fields this slice serves, both answered by the Worker itself — and the point of starting
with one is that adding the second is a `mkdir`, not a refactor:

```bash
mkdir -p src/schema/system
cat > src/schema/system/schema.graphql <<'EOF'
type Query {
  version: String!
  health: String!
}
EOF
```

Every module extends the same `type Query`; codegen merges them into one schema. That is what
makes the layout scale — a new feature adds `src/schema/<feature>/schema.graphql` with its own
`extend`-free `type Query` block and never touches a central file that everyone edits at once.

`codegen.ts` — the Server Preset, pointed at the module glob:

```bash
pnpm add -D @graphql-codegen/cli
pnpm add -D --save-exact @eddeee888/gcg-typescript-resolver-files@0.18.4
pnpm add -D @types/node@catalog:
cat > codegen.ts <<'EOF'
import type { CodegenConfig } from "@graphql-codegen/cli";

// The Server Preset, not the bare typescript-resolvers plugin. The difference is what
// closes the drift gap: typescript-resolvers only emits a `Resolvers` *type*, whose
// fields are all optional, so adding a field to the SDL and forgetting to write its
// resolver still compiles. The preset instead generates a resolver *file* per root
// field and wires every one of them into `resolvers.generated.ts`, so a field can
// never be silently unresolved. It also re-attaches each file's type annotation on
// every run via ts-morph, which is what stops a hand-edited resolver from drifting
// away from the signature the SDL implies.
//
// `resolverGeneration: "minimal"` limits that to root fields. Object fields like
// `Item.title` are left to GraphQL's default resolvers, which is correct — generating
// a file per field of every type would be noise, not safety.
const config: CodegenConfig = {
  schema: "src/schema/**/*.graphql",
  generates: {
    "src/schema": {
      preset: "@eddeee888/gcg-typescript-resolver-files",
      presetConfig: {
        resolverGeneration: "minimal",
        // Resolvers receive the Worker's bindings as context. Without this every
        // generated signature types its third parameter as `any`. Note the nesting:
        // options for the underlying typescript-resolvers plugin go here, not in the
        // output's own `config` — put them there and they are silently ignored.
        typesPluginsConfig: { contextType: "../context#Env" },
      },
    },
  },
};

export default config;
EOF
```

The preset is pinned to an **exact** `0.18.4` — `--save-exact`, not the caret range `pnpm add`
would otherwise write. The reason is the drift test further down, which recognises an
unimplemented resolver by the literal stub comment the preset emits. A wording change in a
patch release would make that scan find nothing and pass falsely, so the bump has to be a
deliberate step where someone re-checks the assumption. `@types/node` joins for the same test,
which globs the resolver files off disk.

**Take that step rather than inheriting the number above.** Two things have to be re-read out
of the published tarball before changing it: that
`dist/generateResolverFiles/handleGraphQLRootObjectTypeField.js` still emits
`/* Implement ${name} resolver logic here */`, and that
`dist/validatePresetConfig/validatePresetConfig.d.ts` still accepts `resolverGeneration` and
`typesPluginsConfig` in the shapes `codegen.ts` uses. Both survived 0.17 → 0.18. Skip the check
and the stub test becomes a green no-op, which is the one failure mode nothing else here would
catch.

`src/context.ts` — what a resolver's third parameter is, declared once:

```bash
cat > src/context.ts <<'EOF'
/** The Worker's bindings. Yoga passes this straight through as the resolver context,
 *  so codegen points `contextType` here and every generated signature picks it up —
 *  there is no second place to declare what a resolver receives. */
export interface Env {
  /** Comma-separated browser origin allowlist — see cors.ts. Optional because it is a
   *  var rather than a binding: a missing binding should stop the build, but a missing
   *  var must stay expressible, since that is the case cors.ts fails closed on. */
  CORS_ORIGINS?: string;
}
EOF
```

This is the Worker's `interface Env` in a file codegen can name, rather than inline in
`src/index.ts` where it would be unreachable from the generated types. `typesPluginsConfig.contextType` is a module path plus an export, resolved relative to
the generated file — so `../context#Env` from `src/schema/types.generated.ts` lands here.

Wire the `codegen` script (the turbo `codegen` task from Slice 0 fans out to it), then run it.
This app now has two generators — the `cf-typegen` added above and the resolver one added
here — so
`codegen` becomes the umbrella over both and each keeps its own name underneath, the same
shape `apps/web` uses:

```bash
pnpm pkg set \
  'scripts["codegen"]=pnpm run cf-typegen && pnpm run codegen:graphql' \
  'scripts["codegen:graphql"]=graphql-codegen && prettier --write --ignore-unknown "src/schema/**/*"'
pnpm codegen
```

Folding `cf-typegen` in is what stops the committed `src/worker-env.d.ts` drifting: one
command regenerates everything this app generates, and the turbo task that already runs
before `typecheck` and `lint` now covers the binding types too.

**The chained prettier is load-bearing, not tidiness.** Codegen writes its type annotations
with single quotes; prettier rewrites them to double; the next codegen run rewrites them back.
Left unchained, `pnpm format` and `pnpm codegen` undo each other forever and every run shows a
diff. Chaining them in this order makes the pair converge: codegen writes, prettier normalises,
and a second `pnpm codegen` is a no-op. That is also why these outputs are absent from
`.prettierignore` — prettier is part of the generator here, not a fight with it.

Six paths now exist under `src/schema/`, and the split between them is the whole design:

| Path                        | Who owns it | Committed |
| --------------------------- | ----------- | --------- |
| `system/schema.graphql`     | you         | yes       |
| `system/resolvers/Query/*`  | you, seeded | yes       |
| `schema.generated.graphqls` | codegen     | yes       |
| `resolvers.generated.ts`    | codegen     | yes       |
| `types.generated.ts`        | codegen     | yes       |
| `typeDefs.generated.ts`     | codegen     | yes       |

`schema.generated.graphqls` is the merged SDL — every module printed into one document. It is
the **published contract**: `apps/web` reads that file and nothing else from this app, so the
module layout stays an internal detail. `typeDefs.generated.ts` is the same schema as a
pre-parsed `DocumentNode`, which is how it reaches the Worker at all — there is no filesystem
in workerd to read `.graphql` from, and shipping the AST also skips a parse on every cold
start. That constant is the one piece of this you would otherwise hand-write — a template
literal holding a copy of the SDL, which is a second source of truth that rots the first time
someone edits one and not the other. Generating it means the string cannot disagree with the
files it came from, and generating it as an AST means the Worker does not re-parse it either.

The resolver files are the second row and the interesting one: codegen **seeds** them, once,
and then they are yours. `pnpm codegen` never overwrites a body — it only re-attaches the type
annotation. That is why `turbo.json` lists `src/schema/**/*.generated.*` in the `codegen`
outputs and not `src/schema/**/resolvers/**`: a restored turbo cache is allowed to replace
generated files, and must never replace an implementation.

Fill in the two it just seeded — one file per root field, which is the whole point of the
Server Preset:

```bash
cat > src/schema/system/resolvers/Query/version.ts <<'EOF'
import type { QueryResolvers } from "./../../../types.generated";

// The resolver the unit project drives. Stays free of any I/O even after a database
// arrives, so that suite never needs Docker or a stub connection string.
export const version: NonNullable<QueryResolvers["version"]> = () => "1";
EOF
cat > src/schema/system/resolvers/Query/health.ts <<'EOF'
import type { QueryResolvers } from "./../../../types.generated";

// Provisional: answers from the Worker itself, because there is nothing behind it yet.
// What it proves is still real — that a request reached this Worker, through the
// service binding, and came back typed. The slice that adds a database rewrites this
// body to query one, and that rewrite is the whole of its integration proof.
export const health: NonNullable<QueryResolvers["health"]> = () => "ok";
EOF
```

`NonNullable<QueryResolvers["version"]>` is the annotation the preset re-attaches on every run.
Note what it does: `QueryResolvers` fields are optional — that is the gap this whole preset
exists to close — so unwrapping with `NonNullable` is what turns "you may implement this" into
"this, exactly, is what implementing it means". Change the field's type in the SDL, re-run
codegen, and the resolver stops compiling. Change the annotation by hand and codegen puts it
back.

`tsconfig.json` gains Node types. Written whole rather than as an additive fragment — unlike
`wrangler.jsonc` further down, this file holds nothing the doc does not know, so the version
below is checkable against the repo and the fragment would not be:

```bash
cat > tsconfig.json <<'EOF'
{
  "extends": "../../packages/config/tsconfig.base.json",
  // skipLibCheck is load-bearing here, not hygiene: the Workers runtime types
  // redeclare ~100 globals (Response, WebSocket, crypto, ...) that also exist in
  // lib.dom.d.ts, which a Yoga dependency (@whatwg-node/server) force-loads via
  // `/// <reference lib="dom" />` — so narrowing `lib` cannot avoid the collision.
  // apps/web never hit this because Next.js's own tsconfig sets skipLibCheck.
  //
  // Those runtime types are no longer a package. `wrangler types` emits them into
  // src/worker-env.d.ts alongside WorkerEnv, which `include` already covers, so
  // there is nothing to list in "types" — that is what replaced the
  // @cloudflare/workers-types entry, and why the generated file is committed.
  //
  // "node" is here for schema.test.ts, which globs the resolver files off disk to
  // check none is still an unimplemented stub. Without it that import typechecks
  // only by TypeScript walking up to an ancestor node_modules/@types — which works
  // in this workspace today and would break on a clean or hoisting-free install.
  "compilerOptions": {
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src"]
}
EOF
```

Naming `"node"` narrows automatic `@types` inclusion to exactly it. The Workers runtime types
are unaffected: they come from `src/worker-env.d.ts` via `include`, not from
`node_modules/@types`, which is the second reason that file lives in `src`.

Now the app's schema test — the merged SDL parses, and no seeded resolver is still a stub:

```bash
cat > src/schema.test.ts <<'EOF'
import { globSync, readFileSync } from "node:fs";
import { buildSchema } from "graphql";
import { expect, test } from "vitest";

const merged = () =>
  readFileSync("src/schema/schema.generated.graphqls", "utf8");

test("the merged SDL parses and exposes both system fields", () => {
  const query = buildSchema(merged()).getQueryType()?.getFields();
  expect(query?.health).toBeDefined();
  expect(query?.version).toBeDefined();
});

// The gap this closes: codegen scaffolds a resolver file for every root field, and an
// unimplemented stub returns `Promise<void>`. For a non-nullable field that is a type
// error, so `tsc` already catches it — but for a *nullable* field `void` is assignable
// to `T | null | undefined`, so the stub typechecks clean and the field silently
// returns null forever. Nothing in the type system sees it.
//
// The stub body is a fixed template in the preset — `/* Implement X resolver logic
// here */`, emitted from handleGraphQLRootObjectTypeField.js — so scanning for it
// catches every unimplemented resolver regardless of nullability. That template is why
// the preset is pinned to an exact version in package.json rather than a caret range:
// if it ever changed wording this scan would find nothing and pass falsely, so the
// bump has to be a deliberate step that re-checks this assumption.
test("no generated resolver stub has been left unimplemented", () => {
  const unimplemented = globSync("src/schema/**/resolvers/**/*.ts").filter(
    (f) => readFileSync(f, "utf8").includes("resolver logic here"),
  );
  expect(unimplemented).toEqual([]);
});
EOF
```

The second test is the one that earns its keep, and the hole it plugs was verified rather than
assumed. The preset guarantees every root field _has_ a resolver file; it cannot guarantee
anyone filled it in. An untouched stub returns `Promise<void>`, and whether that is caught
depends entirely on nullability: for `version: String!` it is a `tsc` error, so the compiler
already has you covered — but make the field `String` and `void` becomes assignable to
`string | null | undefined`, the stub typechecks green, and the field returns null in
production forever. Every field in this schema is non-nullable today, which is exactly the
condition under which nobody notices the guard is missing until the day it matters.

Nothing in the type system can express "and someone actually wrote a body", so the check is
textual: scan the resolver files for the preset's fixed stub marker. That marker is a literal
in the generator's source, which is the whole reason the version above is pinned exactly — a
silent reword turns this test into a green no-op.

`src/index.ts` — both halves now come from generated files, so there is nothing left to keep in
sync by hand:

```bash
cat > src/index.ts <<'EOF'
import { createSchema, createYoga } from "graphql-yoga";
import { resolvers } from "./schema/resolvers.generated";
import { typeDefs } from "./schema/typeDefs.generated";
import type { Env } from "./context";

export type { Env };

// Both halves are generated from the SDL modules under src/schema, so neither can
// disagree with it. `typeDefs` arrives as a pre-parsed DocumentNode rather than a
// string — a Worker has no filesystem to read schema.graphql from, and shipping the
// AST skips a parse on every cold start.
const yoga = createYoga<Env>({ schema: createSchema({ typeDefs, resolvers }) });

export default { fetch: yoga.fetch };
EOF
```

The `export type { Env }` lets the tests below import the binding type from `./index`
unchanged, even though the declaration now lives in `context.ts`.

Worth being precise about what this buys, because "typed resolvers" is a claim two different
setups make and only one of them is total. A bare `typescript-resolvers` run gives you a
`Resolvers` type whose every field is optional — deliberately, since GraphQL's default
resolvers legitimately cover most object fields — so a resolver for an undeclared field is a
type error, and a resolver returning the wrong type is a type error, but **adding a field to
the SDL and never writing its resolver compiles clean**. The SDL→resolver direction is simply
not covered. The Server Preset covers it by construction: the field gets a file, the file gets
imported into `resolvers.generated.ts`, and the only thing left to human error is the body —
which is what the stub scan above watches. Between `tsc` and those two tests there is no longer
a way to add a field and quietly return nothing.

In `apps/web`, add the service binding by rewriting `wrangler.jsonc` whole — and **read what is
in that file before overwriting it.** A whole-file heredoc for a file an earlier slice owns is
the single most reliable way to delete a key nobody was thinking about: the block below is
written against a minimal web shell, and a real one may carry bindings this slice has no opinion
about (an `images` binding for Next's optimizer, say) that must survive verbatim. The same
applies to `.env.example` further down, which an earlier slice makes the whole-package
checklist. Rewriting it with only this slice's keys silently deletes the rest.

```bash
cd ../web   # from apps/graphql
cat > wrangler.jsonc <<'EOF'
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "__PROJECT__-web",
  "main": ".open-next/worker.js",
  "compatibility_date": "2026-08-07",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
  "services": [
    { "binding": "WORKER_SELF_REFERENCE", "service": "__PROJECT__-web" },
    { "binding": "API", "service": "__PROJECT__-graphql" },
  ],
}
EOF
```

## The client half of the contract

`apps/graphql` generates the **server** half: the SDL modules become a resolver map, and every
resolver is typed against it. Nothing yet types the **client** half — the operations this app
sends — so without a second codegen pass `page.tsx` has to assert its own result shape, and an
assertion is exactly the thing that keeps compiling after the schema moves under it.

`@graphql-codegen/client-preset` closes it: it scans this app's source for `graphql()` calls
and emits, per operation, a document carrying its result and variable types. With
`documentMode: "string"` that document is a `String` subclass rather than a parsed
`DocumentNode`, so `graphqlFetch` keeps posting the query text verbatim — no `print()`, and no
`graphql` runtime dragged into the Worker bundle just to send a request.

```bash
pnpm add -D @graphql-codegen/cli @graphql-codegen/client-preset \
  @graphql-typed-document-node/core graphql
```

`@graphql-typed-document-node/core` is a transitive of the preset, but the generated file
imports it directly, and pnpm's strict `node_modules` does not expose transitives — without it
declared, `tsc` fails with `TS2307: Cannot find module`.

`codegen` already means `wrangler types` here. Both are codegen, and turbo's `codegen` task
already lists `src/generated/**` alongside `cloudflare-env.d.ts` in its `outputs`, so make the
existing script the umbrella and give each generator its own name under it — `cf-typegen`
keeps the name the OpenNext docs use:

```bash
pnpm pkg set \
  'scripts["codegen"]=pnpm run cf-typegen && pnpm run codegen:graphql' \
  'scripts["cf-typegen"]=wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts' \
  'scripts["codegen:graphql"]=graphql-codegen'
```

```bash
cat > codegen.ts <<'EOF'
import type { CodegenConfig } from "@graphql-codegen/cli";

// The client half of the types, mirroring apps/graphql's server half. That config turns
// the SDL modules into a resolver map; this one scans the operations *this* app writes
// and types their results.
//
// The pointer is apps/graphql's *published artifact*, not its module sources: the SDL is
// split across src/schema/<module>/schema.graphql, and globbing into those would couple
// this config to another app's internal layout. schema.generated.graphqls is the merged
// contract, at a path that stays put however the modules are reorganised. It is
// committed, so reading it needs no build ordering between the two apps.
const config: CodegenConfig = {
  schema: "../graphql/src/schema/schema.generated.graphqls",
  documents: ["src/**/*.{ts,tsx}", "!src/generated/**"],
  generates: {
    "src/generated/": {
      preset: "client",
      // documentMode 'string' emits each operation as a String subclass carrying its
      // result type as a phantom, instead of a parsed DocumentNode. That is what lets
      // lib/api.ts keep posting the query verbatim -- no print(), and no graphql
      // runtime pulled into the Worker bundle just to send a request.
      config: { documentMode: "string" },
      // Fragment masking hides fragment fields from the parent unless unmasked at the
      // use site. Useful in a large component tree; here it is ceremony over one query.
      presetConfig: { fragmentMasking: false },
    },
  },
};

export default config;
EOF
```

Write one fetch helper so both environments work out of the box — service binding in
production (never leaves Cloudflare's network), plain HTTP to the local Worker in dev — now
generic over the document it is handed, so the caller's result type comes from the schema:

```bash
mkdir -p src/lib
cat > src/lib/api.ts <<'EOF'
import { connection } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { TypedDocumentString } from "@/generated/graphql";

export type GraphQLResult<T> = { data?: T; errors?: { message: string }[] };

export async function graphqlFetch<TResult, TVariables>(
  query: TypedDocumentString<TResult, TVariables>,
  // Spread rather than `variables?:` so the argument is required exactly when the
  // operation declares variables. An optional parameter would let a query with
  // required variables be called with none and still compile.
  ...[variables]: TVariables extends Record<string, never> ? [] : [TVariables]
): Promise<GraphQLResult<TResult>> {
  // Stops prerendering here. Reading the Worker's bindings needs a real request, and
  // `getCloudflareContext()` throws if it runs while a route is being prerendered at
  // build time -- which is what silently broke `next build` before this line existed.
  // Next 16 removed `export const dynamic`; connection() replaces it, and it belongs
  // in this helper rather than in a page: every caller needs request-time context, so
  // putting it at the boundary that actually requires it means a new page cannot
  // forget to opt out.
  await connection();
  // The document is a String subclass, not a primitive -- toString() is what puts the
  // query text in the payload rather than leaning on how JSON.stringify happens to
  // treat boxed strings.
  const body = JSON.stringify({ query: query.toString(), variables });
  const init = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  };
  const { env } = getCloudflareContext();
  const res = env.API
    ? await env.API.fetch("https://api/graphql", init)
    : await fetch("http://localhost:8787/graphql", init);
  // The wire is untyped by definition; TResult is a claim about what the schema
  // promises, which the server is separately typed to honour.
  return res.json() as Promise<GraphQLResult<TResult>>;
}
EOF
```

Render it in a server component — this runs in the Worker, so the query goes over the service
binding in production and to the local Worker in dev, and nothing about the API reaches the
browser:

```bash
cat > src/app/page.tsx <<'EOF'
import { graphqlFetch } from "@/lib/api";
import { graphql } from "@/generated";

// Codegen scans for these calls and types the document by its result shape, so the
// destructuring below is checked against the SDL. Rename a field there and this stops
// compiling -- where the old hand-written result type would have kept compiling and
// rendered `undefined`.
const HomeQuery = graphql(`
  query Home {
    version
    health
  }
`);

// Server component: this runs in the Worker, so the query goes over the service
// binding in production and to the local Worker in dev. Nothing reaches the browser.
export default async function Home() {
  const res = await graphqlFetch(HomeQuery);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 font-sans dark:bg-black">
      <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
        __PROJECT__
      </h1>
      {res.errors ? (
        <p className="font-mono text-sm text-red-600">
          {res.errors.map((e) => e.message).join(", ")}
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm text-zinc-600 dark:text-zinc-400">
          <dt>api version</dt>
          <dd className="text-black dark:text-zinc-50">{res.data?.version}</dd>
          <dt>api health</dt>
          <dd className="text-black dark:text-zinc-50">{res.data?.health}</dd>
        </dl>
      )}
    </main>
  );
}
EOF
```

Generate, so `src/generated/` exists before anything imports it:

```bash
pnpm codegen
```

Those outputs are committed, like `apps/graphql`'s — and here `.prettierignore` covers
`**/src/generated/`, so prettier leaves them alone. (The other app takes the opposite route,
running prettier _as part of_ its codegen script; the difference is that the client preset's
output is already prettier-shaped and the server preset's is not.)

Two failure modes are now caught, and they are caught at different moments. A field that is not
in the SDL fails `pnpm codegen` (`Cannot query field "versionn" on type "Query"`), because
codegen validates every operation against the schema before it writes anything. A field the
_query_ did not select fails `tsc` (`Property 'nope' does not exist on type 'HomeQuery'`). The
first is the SDL→client direction the resolver types could never cover.

`vitest.config.ts` needs the `@/*` alias now. Vitest resolves imports itself and never reads
tsconfig paths — nothing caught it before because the only `@/` imports were type-only and
erased before they reached the runtime, and `api.ts` now imports a value through one.

**Use `import.meta.dirname`, not `__dirname`.** `apps/web` is ESM, so under Vite's
`configLoader: 'native'` — planned to become the default — the CommonJS global does not exist.
Vitest says so and keeps going:

```
(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`:
  - `__dirname` (vitest.config.ts:9:30). Use `import.meta.dirname` instead
```

Green with a warning today, broken on a Vite major later, and copied into every package that
takes this config as its template.

```bash
cat > vitest.config.ts <<'EOF'
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// tsconfig's `@/*` alias, restated: Vitest resolves imports itself and does not read
// tsconfig paths. Nothing caught this before because the only `@/` imports were
// type-only and erased before they reached the runtime. Declared per project rather
// than once at the root -- inline project entries are separate Vite configs and do not
// inherit the root's `resolve`.
//
// `import.meta.dirname`, not `__dirname`: this package is ESM, and Vite's
// `configLoader: 'native'` -- planned to become its default -- cannot supply the
// CommonJS global. It warns today and breaks later.
const alias = { "@": resolve(import.meta.dirname, "src") };

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["**/*.int.test.ts"],
        },
      },
      {
        resolve: { alias },
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

`graphqlFetch` has a branch that behaves differently in each environment, and the production
side of it is the one you cannot exercise locally — so test both with a mocked fetch:

```bash
cat > src/lib/api.test.ts <<'EOF'
import { expect, test, vi } from "vitest";
import { graphqlFetch } from "./api";
import { TypedDocumentString } from "@/generated/graphql";

// vi.mock's factory is hoisted above the imports, so the env it hands back has to
// be reachable from up there too -- that is what vi.hoisted is for.
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: mocks.env }),
}));

// connection() is Next's prerender boundary and throws outside a render, so it is
// stubbed rather than exercised. What it guards is a build-time concern that only
// `next build` can prove -- see the production gate, not this file.
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

// Declaring the parameters is what makes `mock.calls[0]` a typed tuple. With a
// zero-arg impl vitest infers `[]`, and reading the recorded args needs a cast.
const ok = (_url: string, _init: RequestInit) =>
  Response.json({ data: { health: "ok" } });

// Standing in for a codegen output. The type arguments are what codegen bakes into
// the real documents; spelling them here keeps the test on the same call signature
// production uses -- including that `noVars` takes no second argument and `withVars`
// requires one.
type Health = { health: string };
const noVars = new TypedDocumentString<Health, Record<string, never>>(
  "{ health }",
);
const withVars = new TypedDocumentString<Health, { a: number }>("{ health }");

test("dev path: plain HTTP to the local Worker when no binding is present", async () => {
  const fetchMock = vi.fn(ok);
  vi.stubGlobal("fetch", fetchMock);
  mocks.env = {};

  await expect(graphqlFetch(noVars)).resolves.toEqual({
    data: { health: "ok" },
  });

  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("http://localhost:8787/graphql");
  expect(JSON.parse(init.body as string)).toEqual({ query: "{ health }" });
});

test("production path: the service binding is used and global fetch is not", async () => {
  const fetchMock = vi.fn(ok);
  vi.stubGlobal("fetch", fetchMock);
  const bindingFetch = vi.fn(ok);
  mocks.env = { API: { fetch: bindingFetch } };

  await expect(graphqlFetch(withVars, { a: 1 })).resolves.toEqual({
    data: { health: "ok" },
  });

  expect(fetchMock).not.toHaveBeenCalled();
  const [url, init] = bindingFetch.mock.calls[0];
  expect(url).toBe("https://api/graphql");
  expect(JSON.parse(init.body as string)).toEqual({
    query: "{ health }",
    variables: { a: 1 },
  });
});

// The document is a String object. If the payload ever carried the boxed form -- or
// the class's own `value`/`__meta__` fields -- the API would receive an unparseable
// query, and every assertion above would still pass on a deep-equal of the parsed body.
test("the query is serialised as a plain string, not a boxed String", async () => {
  const fetchMock = vi.fn(ok);
  vi.stubGlobal("fetch", fetchMock);
  mocks.env = {};

  await graphqlFetch(noVars);

  const [, init] = fetchMock.mock.calls[0];
  expect(typeof JSON.parse(init.body as string).query).toBe("string");
});
EOF
```

`expect(fetchMock).not.toHaveBeenCalled()` is the assertion that matters. Without it the
production test would still pass if the helper silently fell through to plain HTTP — which is
the exact bug that would send traffic out of Cloudflare's network instead of over the service
binding, and it would never show up locally.

Finally, a drift guard of the same family `apps/graphql` keeps over its schema outputs — here
the stronger, regenerate-and-compare form, which this side can afford because the whole output
is machine-owned. The generated files are committed, so nothing else would notice a query
edited without a re-run:

```bash
cat > src/lib/codegen.test.ts <<'EOF'
import { readFileSync } from "node:fs";
import { generate } from "@graphql-codegen/cli";
import { expect, test } from "vitest";
import config from "../../codegen";

// The same guard apps/graphql keeps over its schema outputs, for the same reason: the
// generated files are committed, so nothing else would notice a query edited without a
// re-run. Reuses the real codegen.ts rather than restating it, and `generate(config,
// false)` returns the output in memory so the test never writes to the tree.
test("every committed codegen output is up to date", async () => {
  const outputs = await generate({ ...config, silent: true }, false);
  expect(outputs.length).toBeGreaterThan(0);
  for (const out of outputs) {
    expect(readFileSync(out.filename, "utf8"), out.filename).toBe(out.content);
  }
});
EOF
```

That test is worth one more paragraph, because **the drift it catches is usually invisible to
the compiler**. Edit a query and skip the re-run and nothing contradicts anything: the stale
documents are internally consistent, just consistent with yesterday's schema, so `tsc` stays
green while the contract has moved. When a type error _does_ eventually fire it lands somewhere
else entirely, blaming code that is correct. A type system compares code against types; it
cannot compare a type against the file it was generated from. That freshness property has no
type-level expression — it is the same category as "is `pnpm-lock.yaml` in sync with
`package.json`", which is why that one is checked with `--frozen-lockfile` rather than by a
compiler.

Regenerating and comparing is what makes the check total. The obvious cheaper version — assert
each field name appears somewhere in the generated text — catches an _added_ field but silently
passes when a field's **type** changes, since `health` is still present in the file after
`String!` becomes `Int!`. Comparing full output catches additions, removals, renames and type
changes alike, for the same runtime.

## Naming the origins allowed to call the API from a browser

`apps/web` now talks to `apps/graphql`, which makes "who else may" a question with a default
answer — and Yoga's default is the wrong one. It ships CORS **on** and permissive: with no
`cors` option it reflects whatever `Origin` the request carries back as
`Access-Control-Allow-Origin` and, because a reflected value is not `*`, pairs it with
`Access-Control-Allow-Credentials: true`. Any page on any origin could query this Worker from
a visitor's browser. Yoga cannot know our origins; this is where we name them.

```bash
cd ../graphql   # from apps/web
cat > src/cors.ts <<'EOF'
import type { CORSOptions } from "graphql-yoga";
import type { Env } from "./context";

/** Who may call this API from a browser.
 *
 *  Yoga ships with CORS *on* and permissive: with no `cors` option it reflects whatever
 *  Origin the request carries back as `Access-Control-Allow-Origin`, and — because the
 *  reflected value is not `*` — pairs it with `Access-Control-Allow-Credentials: true`.
 *  Any page on any origin could query this Worker from a visitor's browser. That is the
 *  default because Yoga cannot know our origins. This module is where we name them.
 *
 *  Server-to-server traffic is untouched. apps/web reaches us over the `API` service
 *  binding, and `env.API.fetch()` sends no Origin header; the plugin emits no CORS
 *  headers at all when Origin is absent. Tightening this cannot break SSR — CORS is a
 *  rule browsers enforce on themselves, and nothing else consults it.
 */
export function corsFor(env: Env): CORSOptions {
  const origins = (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  // Fail closed on a missing or empty var. Returning `{ origin: [] }` would do the
  // opposite: the plugin treats an empty list identically to `*` and goes back to
  // reflecting the caller, so a deploy that forgot the var would be *wider* open than
  // the default we are replacing. `false` disables the plugin outright — no headers,
  // so browsers block the response — while leaving the binding path working.
  if (origins.length === 0) return false;

  return {
    origin: origins,
    // The client posts JSON; nothing else is in use. A future GET-based caller fails
    // its preflight loudly rather than quietly inheriting an allowance no one asked
    // for. Yoga answers OPTIONS itself, so it needs no entry here.
    methods: ["POST"],
    allowedHeaders: ["content-type"],
    // No cross-origin cookies. This has to be said out loud: left undefined, the plugin
    // sets `Allow-Credentials: true` for any origin that isn't `*` — which is exactly
    // how the permissive default came to be credentialed. When browser-side auth
    // arrives, turning this on is a deliberate edit, not an inherited default.
    credentials: false,
    // Cache preflights for a day (browsers clamp this to their own ceiling). A page
    // that queries on interaction otherwise pays an extra round trip before each one.
    maxAge: 86400,
  };
}
EOF
```

The allowlist is a **var**, not a constant in the source, because it is the one piece of this
Worker that names something outside it: when `apps/web` moves to a custom domain its origin
changes and this Worker's code should not. So `context.ts` gains the key, and — since a var
can be absent in a way a binding cannot — it is optional:

```bash
cat > src/context.ts <<'EOF'
/** The Worker's bindings. Yoga passes this straight through as the resolver context,
 *  so codegen points `contextType` here and every generated signature picks it up —
 *  there is no second place to declare what a resolver receives. */
export interface Env {
  /** Comma-separated browser origin allowlist — see cors.ts. Optional because it is a
   *  var rather than a binding: a missing binding should stop the build, but a missing
   *  var must stay expressible, since that is the case cors.ts fails closed on. */
  CORS_ORIGINS?: string;
}
EOF
```

Wire it into the server. The `cors` option takes a **factory**, not a literal, because vars
only exist per-request, on `env`:

```bash
cat > src/index.ts <<'EOF'
import { createSchema, createYoga } from "graphql-yoga";
import { resolvers } from "./schema/resolvers.generated";
import { typeDefs } from "./schema/typeDefs.generated";
import { corsFor } from "./cors";
import type { Env } from "./context";

export type { Env };

// Both halves are generated from the SDL modules under src/schema, so neither can
// disagree with it. `typeDefs` arrives as a pre-parsed DocumentNode rather than a
// string — a Worker has no filesystem to read schema.graphql from, and shipping the
// AST skips a parse on every cold start.
const yoga = createYoga<Env>({
  schema: createSchema({ typeDefs, resolvers }),
  // A factory rather than a literal, because the allowlist lives in a Worker var and
  // vars only exist per-request, on `env`. Yoga hands the server context to this
  // callback as its second argument; for a Worker that context is `env` merged with
  // `ctx`, which is where CORS_ORIGINS shows up.
  //
  // The cast is not decoration: Yoga types this option as `Parameters<typeof useCORS>[0]`
  // without instantiating the generic, so the context arrives as `unknown` however
  // precisely `createYoga<Env>` was parameterised. Deleting it does not compile.
  cors: (_request, env) => corsFor(env as Env),
});

export default { fetch: yoga.fetch };
EOF
```

The deployed origin goes in `wrangler.jsonc` as a by-hand fragment rather than a rewritten
file — the first of several, and the reason the whole file stops being doc-owned here (later
slice adding a database would put an account-specific pooler id in it, which no heredoc can
reproduce).
`APP_ENV` rides in beside it: a second, plainer var, proving the same mechanism carries any
non-secret config value, not just an allowlist:

```jsonc
{
  ...,
  "vars": {
    // The browser origins allowed to call this API cross-origin (see src/cors.ts).
    // Deployed value only: `wrangler dev` overlays .env.development on top of this
    // block, and that file swaps in localhost — so the production allowlist never
    // carries a development origin, which is the whole reason the two are split.
    //
    // A var and not a hardcoded constant because this is the one piece of the Worker
    // that names something outside it. When apps/web moves to a custom domain, its
    // origin changes and this Worker's code does not.
    "CORS_ORIGINS": "https://__PROJECT__-web.<account>.workers.dev",
    // Plain config, split the same way: a deployed default here, a local override
    // below. What it proves is below, once the client half exists to read it back.
    "APP_ENV": "production"
  }
}
```

Applied by hand is exactly what `docs:check` cannot verify, and this is the first var this
file gets — the tempting middle grounds do not survive contact: `jq` cannot read the file
(comments and trailing commas are not JSON, and it exits at line 3 with
`Invalid numeric literal`), and a `sed` insert cannot see structure (anchoring one after
`compatibility_flags` appends a second `"vars"` key beside the existing one — the file still
parses, a `--dry-run` deploy still reports success, and one of the two blocks is simply dead).
An additive fragment applied by hand has neither failure mode, at the cost of being unverifiable —
so baseline that now, before `docs:check` has a chance to flag it as drift against this
slice's own whole-file heredoc:

```diff
--- scripts/docs-check.ignore
# An entry is added by the slice that makes it true, never in advance. The check fails on
# an entry nothing mismatches, and a path no installed slice even describes mismatches
# nothing — so a baseline written ahead of its slice fails from the moment it is written.
+
+# Permanent, not a to-do: the heredoc earlier in this slice is the last time this file is
+# written whole, and every key after it — CORS_ORIGINS and APP_ENV here, and any later
+# binding carrying an account-specific id — lands as a by-hand fragment instead,
+# because the doc cannot reproduce values Cloudflare hands out. So the repo is always
+# that heredoc plus keys the doc never claimed.
+# Nothing to delete when a later var lands; drop it only if the doc ever starts writing
+# the whole file again (it should not).
+apps/graphql/wrangler.jsonc  # permanent: vars are added by hand, never whole-file
```

The local origin is a different one — `next dev` serves `apps/web` on `:3000` while this
Worker runs on `:8787`, and different ports are different origins — so it belongs in the
gitignored `.env.development`, which wrangler overlays on top of `vars`. This is the app's
first env file pair, and the convention behind them is the one Slice 0 already set:

```bash
cat > .env.development <<'EOF'
# Local overlay for wrangler.jsonc vars. Gitignored; .env.example is the checklist.
#
# next dev serves apps/web on :3000 while this Worker runs on :8787 - different ports
# are different origins, so browser-side queries in development are cross-origin.
CORS_ORIGINS="http://localhost:3000"
APP_ENV=local
EOF
cat > .env.example <<'EOF'
# Checklist of the keys .env.development may set for `wrangler dev`. Committed with a
# dummy value; .env.development itself is not.
#
# Each key here overrides the same-named entry in wrangler.jsonc's `vars` block, which
# holds deployed values. Overriding is the only reason a key appears in both places.
#
# The filename is not wrangler's default — `dev` and `cf-typegen` both pass
# `--env-file .env.development`, which matches every other package's local file. That
# flag is also what makes the file the single source: with it, wrangler loads the named
# file and nothing else, so a stray .env.local or .dev.vars is inert rather than
# competing. Without it wrangler would merge .env.local, and treat .dev.vars as a
# *replacement* for the whole .env layer — one file setting one key silently disabling
# every key in the other. The flag ends that class of problem; do not drop it.
CORS_ORIGINS=http://localhost:3000
APP_ENV=local
EOF
```

`.env.development` and not wrangler's own `.env.local`, which it would find with no flag at
all: three packages each keep a gitignored local env file, and one name across all three is
one less thing to know. The flag is what buys that, so both commands that read the file carry
it:

```bash
pnpm pkg set scripts.dev="wrangler dev --env-file .env.development"
pnpm codegen   # wrangler.jsonc changed: WorkerEnv picks up the new var
```

**`--env-file` goes on `dev` and on nothing else. Putting it on `cf-typegen` — which earlier
versions of this slice did — breaks every fresh clone,** and the clone run at the end of this
slice is what catches it. The chain is short and total:

- `--env-file` names a file wrangler then _requires_. Absent, the command dies with
  `node: .env.development: not found` and exit 9.
- `cf-typegen` runs under `codegen`, and `turbo.json` makes both `typecheck` and `lint` depend
  on `codegen`.
- So a clone — or CI, or any new contributor before their first `pnpm dev` — cannot typecheck
  or lint the workspace at all, and the error names a file that is gitignored _on purpose_.

The argument for the flag was that `wrangler types` merges `vars` with the env file, so a key
living only in the local file would otherwise be missing from `WorkerEnv`. That case does not
exist here: `.env.development` is an **overlay** of `vars`, so every key in it is already in
`wrangler.jsonc` by construction. What the flag actually changed was the _value_ side, and that
is the real defect it was papering over. `wrangler types` defaults to `--strict-vars true`,
which emits each var as a **literal type** read off `wrangler.jsonc`:

```ts
CORS_ORIGINS: "https://__PROJECT__-web.<account>.workers.dev";
APP_ENV: "production";
```

Those are the deployed values typed as the only values possible — a lie about a var whose whole
purpose is to differ between environments, and one that makes `cors.ts`'s local-origin path
unrepresentable. Passing the env file happened to fix it by accident: two different values for
one key widen the literal back to `string`. `--strict-vars false`, set on the script further up,
says that directly, and its output is **byte-identical** to the env-file version below the
generated-by comment — same content hash — without depending on a file no clone has.

When a later slice does add a key that lives only in the local file (a secret, say), it is not
`wrangler types` that should learn about it: a secret does not belong in `vars`, and typing the
Worker off a gitignored file is what got us here. Declare it where the code can see it and keep
the generator reading committed configuration only.

Two consequences worth knowing before they surprise you. A missing `.env.development` is now
a hard error from `wrangler dev` rather than a quiet start — which is the right way round _for
`dev`_, because the quiet start was a local Worker running on the _production_ allowlist, and
the wrong way round for anything a clone must run, which is the whole of the note above. And the
flag makes the named file the only one read, so a `.env.local` or `.dev.vars` left in this
directory does nothing at all — worth knowing when a value you set stubbornly fails to
arrive.

The tests drive `worker.fetch` rather than calling `corsFor` directly, which is the whole
point: the unit under test is the headers a browser actually receives, and testing the function
alone would keep passing if the `cors` wiring in `index.ts` were deleted.

```bash
cat > src/cors.test.ts <<'EOF'
import { expect, test } from "vitest";
import worker, { type Env } from "./index";

// Driven through `worker.fetch` rather than against `corsFor` directly. The unit under
// test is not the allowlist — it is the headers a browser actually receives, and those
// come from Yoga's plugin reading our options. Testing the function alone would keep
// passing if the `cors` wiring in index.ts were dropped entirely.
// Any absolute origin does: every case below feeds this same string in as the allowlist
// and asserts against it, so the test pins the *shape* of the answer and never the
// deployment. Deliberately not the real origin — that lives in wrangler.jsonc alone.
const WEB = "https://__PROJECT__-web.example.workers.dev";
const EVIL = "https://evil.example";

const envWith = (origins?: string) =>
  ({ CORS_ORIGINS: origins }) as unknown as Env;

const query = (origin?: string) =>
  new Request("http://localhost/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify({ query: "{ version }" }),
  });

const preflight = (origin: string) =>
  new Request("http://localhost/graphql", {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });

test("an allowed origin is echoed back, uncredentialed", async () => {
  const res = await worker.fetch(query(WEB), envWith(WEB));

  expect(res.headers.get("access-control-allow-origin")).toBe(WEB);
  // The header Yoga would have set on its own. Its absence is the point of the fix.
  expect(res.headers.get("access-control-allow-credentials")).toBeNull();
});

test("an origin outside the allowlist is refused", async () => {
  const res = await worker.fetch(
    query(EVIL),
    envWith(`${WEB},http://localhost:3000`),
  );

  // Not a missing header but a literal "null" origin, which no browser can match.
  expect(res.headers.get("access-control-allow-origin")).toBe("null");
});

test("a one-entry allowlist answers with that entry whatever the caller sends", async () => {
  const res = await worker.fetch(query(EVIL), envWith(WEB));

  // Yoga short-circuits a single allowed origin to a fixed header instead of comparing
  // against the request — so the refusal here reads differently from the case above.
  // Still closed: the browser blocks any response whose allowed origin is not its own.
  // Worth pinning, because production runs exactly this one-entry shape.
  expect(res.headers.get("access-control-allow-origin")).toBe(WEB);
  expect(res.headers.get("access-control-allow-origin")).not.toBe(EVIL);
});

test("an unset allowlist fails closed rather than open", async () => {
  const res = await worker.fetch(query(WEB), envWith(undefined));

  // The trap this guards: an empty origin list means "reflect everything" to the
  // plugin, so a forgotten var must disable CORS rather than configure it emptily.
  expect(res.headers.get("access-control-allow-origin")).toBeNull();
});

test("a request with no Origin is untouched — the service binding still works", async () => {
  const res = await worker.fetch(query(), envWith(WEB));

  expect(res.headers.get("access-control-allow-origin")).toBeNull();
  expect(await res.json()).toEqual({ data: { version: "1" } });
});

test("preflight advertises only POST and content-type", async () => {
  const res = await worker.fetch(preflight(WEB), envWith(WEB));

  expect(res.status).toBe(204);
  expect(res.headers.get("access-control-allow-origin")).toBe(WEB);
  expect(res.headers.get("access-control-allow-methods")).toBe("POST");
  expect(res.headers.get("access-control-allow-headers")).toBe("content-type");
  expect(res.headers.get("access-control-max-age")).toBe("86400");
});
EOF
```

Two of those deserve a note. A refused origin comes back as the literal string `"null"`, not
as a missing header — no browser can match it, so it is a refusal, but it does not read like
one. And a **one-entry** allowlist behaves differently again: Yoga short-circuits it to a fixed
header instead of comparing against the request, so the caller is told `WEB` regardless of who
asked. Still closed, since a browser blocks any response whose allowed origin is not its own —
and worth pinning with a test, because one entry is exactly the shape production runs.

`wrangler.jsonc` now carries two vars instead of one, which is the point past which
hand-maintaining `context.ts`'s `Env` interface stops paying for itself — regenerate and alias
it to the generated type instead:

```bash
pnpm cf-typegen
cat > src/context.ts <<'EOF'
/** The Worker's bindings, generated by `pnpm cf-typegen` from wrangler.jsonc plus the
 *  local env file. Aliased rather than re-declared: this name is what codegen's
 *  `contextType` resolves to, and there must be one description of the bindings. */
export type Env = WorkerEnv;
EOF
```

`WorkerEnv` is declared globally by the generated `.d.ts`, now covering `CORS_ORIGINS` and
`APP_ENV` — and because every resolver signature is generated from
`contextType`, one `pnpm cf-typegen` retypes all of them.

One thing the generated type says that the hand-written one did not: every var is
**required**. `wrangler types` reads `vars` and cannot know a deploy might omit one, so
`CORS_ORIGINS?: string` becomes `CORS_ORIGINS: string`. `cors.ts` keeps its `?? ""` and keeps
failing closed anyway — the type describes the config as written, not the Worker as deployed,
and the test that proves the fail-closed path casts an env without the key precisely because
the type now forbids writing one.

A required-value guard, so a missing var fails at the boundary with a legible message rather
than as `undefined` three layers down:

```bash
cat > src/env.ts <<'EOF'
/** Read a var off the Worker's bindings, or fail here with the key's name.
 *
 *  The parameter is `object` and not `Record<string, unknown>` because the only caller
 *  passes `WorkerEnv`, and TypeScript gives an *interface* no implicit index signature
 *  — a generated interface is not assignable to a Record, however plain its fields.
 *  Widening to `object` keeps the call sites cast-free and still accepts the plain
 *  literals the test uses; the read below is the one narrowing, in one place. */
export function requireEnv(env: object, key: string): string {
  const value = (env as Record<string, unknown>)[key];
  if (typeof value !== "string" || value === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}
EOF
cat > src/env.test.ts <<'EOF'
import { expect, test } from "vitest";
import { requireEnv } from "./env";

test("returns a present value", () => {
  expect(requireEnv({ APP_ENV: "local" }, "APP_ENV")).toBe("local");
});

test("throws, naming the key, when missing or empty", () => {
  expect(() => requireEnv({}, "APP_ENV")).toThrow("APP_ENV");
  expect(() => requireEnv({ APP_ENV: "" }, "APP_ENV")).toThrow("APP_ENV");
});
EOF
```

That test is hermetic — it passes a plain object, reads no env file, and so behaves the same
on every machine and in CI.

Expose `APP_ENV` through the API. The loop the whole module layout was built for runs once
more — edit the SDL, run codegen once, fill in the seeded stub:

```bash
cat > src/schema/system/schema.graphql <<'EOF'
type Query {
  version: String!
  health: String!
  appEnv: String!
}
EOF
pnpm codegen
cat > src/schema/system/resolvers/Query/appEnv.ts <<'EOF'
import type { QueryResolvers } from "./../../../types.generated";
import { requireEnv } from "../../../../env";

export const appEnv: NonNullable<QueryResolvers["appEnv"]> = (
  _parent,
  _arg,
  ctx,
) => requireEnv(ctx, "APP_ENV");
EOF
```

Leave the stub untouched and `pnpm test:unit` says so by name — the field is non-nullable
here, so `tsc` would catch it too, but the stub scan is what still catches it the day someone
writes `appEnv: String`.

**Secrets are out of scope for this slice.** `vars` and secrets reach a resolver through the
same `ctx`, so nothing above changes shape when one arrives; the delivery mechanism
(`wrangler secret put`, a value Cloudflare stores and the repo never sees) is unproven until a
feature actually needs one. The rule to keep when that day comes: expose whether the secret
arrived, never the secret itself — a `Boolean!` field, not a `String!`.

Render both halves on the web page: `process.env.NEXT_PUBLIC_APP_ENV` directly (proves the
build-time browser path) and `appEnv` via `graphqlFetch` (proves the runtime Worker path,
through the service binding in production):

```bash
cd ../web   # from apps/graphql
cat > .env.development <<'EOF'
NEXTJS_ENV=development
NEXT_PUBLIC_APP_ENV=local
EOF
cat > .env.example <<'EOF'
NEXTJS_ENV=development
NEXT_PUBLIC_APP_ENV=local
EOF
```

`.env.development` replaces the file Slice 1 created and picks up the `NEXT_PUBLIC_APP_ENV`
key. It is read only by `next dev`; a production build — which `pnpm preview` and
`pnpm deploy:production` both are — reads `.env.production` instead, and no such file exists
here. The production value goes on the `deploy:production` script, not into a file —
`process.env` outranks every env file, so this is the one place a production value can live
that no env file can override:

```bash
pnpm pkg set 'scripts["preview"]=NEXT_PUBLIC_APP_ENV=preview opennextjs-cloudflare build && opennextjs-cloudflare preview' \
  'scripts["deploy:production"]=NEXT_PUBLIC_APP_ENV=production opennextjs-cloudflare build && opennextjs-cloudflare deploy'
```

**`preview` needs a value of its own, and the gate is what finds that.** Without one,
`pnpm preview` renders `web env` as _blank_: `preview` runs `opennextjs-cloudflare build`, which
is a production build, so Next reads `.env.production` and not `.env.development` — and
`.env.production` deliberately has no `NEXT_PUBLIC_APP_ENV`, because the production value rides
on the deploy script. Preview falls between the two files this slice sets up and picks up
neither.

Blank is the worst of the three possible answers. `local` would be a lie about a production
build; `production` would be a lie about a machine; an empty string looks like a bug and
teaches nothing. **`preview` is the honest third answer**, and giving it one turns the preview
row from a weaker copy of the browser row into a distinct claim: the two halves of the page are
sourced independently, so they are allowed to differ — `web env` reads `preview` (baked into
this build) while `api env` reads `local` (served live by the `wrangler dev` the service binding
connected to). Two mechanisms, visibly not one.

**If the deploy script needed extra arguments in an earlier slice — a `--env-file` threaded
behind a `--`, say — keep them.** Adding the prefix means rewriting the whole script string,
which is exactly how such a tail gets dropped.

The prefix applies only to the `build` half, which is the half that inlines it. This is the
script every production build runs, so it is also the honest place to read what production's
public config _is_. (Inline `VAR=value cmd` is POSIX shell syntax; add `cross-env` if anyone
ever builds this on Windows.)

**`NEXT_PUBLIC_` is a publication decision, not a convenience prefix.** Any variable with it
is compiled into the JavaScript served to every visitor — never give a secret that prefix. Two
consequences worth knowing before you rely on it: the value is frozen at `next build` time, so
changing it later requires a rebuild, and only literal `process.env.NEXT_PUBLIC_X` references
are inlined — `process.env[name]` and destructured lookups silently are not.

**If you ever move deploys to Workers Builds** (Cloudflare's CI/CD) instead of running
`pnpm deploy:production` from your machine: Next.js needs `NEXT_PUBLIC_*` **and** private vars
at _build_ time for SSG, so they must be set in the dashboard's **build configuration**
section — Worker secrets and `vars` are runtime-only and are not visible to the build. A var
that works locally will silently produce a wrong or failed prerender in CI otherwise.

```bash
cat > src/app/page.tsx <<'EOF'
import { graphqlFetch } from "@/lib/api";
import { graphql } from "@/generated";

// Codegen scans for these calls and types the document by its result shape, so the
// destructuring below is checked against the SDL. Rename a field there and this stops
// compiling -- where the old hand-written result type would have kept compiling and
// rendered `undefined`.
const HomeQuery = graphql(`
  query Home {
    version
    health
    appEnv
  }
`);

// Server component: this runs in the Worker, so the query goes over the service
// binding in production and to the local Worker in dev. Nothing reaches the browser.
export default async function Home() {
  const res = await graphqlFetch(HomeQuery);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 font-sans dark:bg-black">
      <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
        __PROJECT__
      </h1>
      {res.errors ? (
        <p className="font-mono text-sm text-red-600">
          {res.errors.map((e) => e.message).join(", ")}
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm text-zinc-600 dark:text-zinc-400">
          <dt>api version</dt>
          <dd className="text-black dark:text-zinc-50">{res.data?.version}</dd>
          <dt>api health</dt>
          <dd className="text-black dark:text-zinc-50">{res.data?.health}</dd>
          <dt>api env</dt>
          <dd className="text-black dark:text-zinc-50">{res.data?.appEnv}</dd>
          {/* The build-time half of the same value: written as a literal member
              expression because that is the only form next build inlines --
              process.env[name] and destructuring are left untouched and arrive
              undefined in the browser. */}
          <dt>web env</dt>
          <dd className="text-black dark:text-zinc-50">
            {process.env.NEXT_PUBLIC_APP_ENV}
          </dd>
        </dl>
      )}
    </main>
  );
}
EOF
pnpm codegen   # the schema changed: HomeQuery needs appEnv typed
```

**Local gate** — both dev servers running (`pnpm dev` in `apps/graphql` and in `apps/web`,
one terminal each; or `pnpm turbo dev` from root to run both). No Docker: nothing in this
slice reaches a database.

| Where      | Check                   | Expect                                                       |
| ---------- | ----------------------- | ------------------------------------------------------------ |
| browser    | `localhost:3000`        | `local` for both env values, and `version`/`health` from the |
|            |                         | Worker — rendered through the typed client, not hardcoded    |
| `apps/web` | `pnpm preview`          | `api env` `local`, `web env` **`preview`** — see below       |
| root       | **`pnpm typecheck`**    | 2 typecheck + the 2 `codegen` they need                      |
| root       | **`pnpm lint`**         | 2 lint + the 2 `codegen` it depends on                       |
| root       | **`pnpm test:unit`**    | **`Tests 17 passed`** — web 7 + graphql 10                   |
| root       | `pnpm test:integration` | 0 — nothing here has a real dependency to integrate against  |
| root       | `pnpm docs:check`       | no drift — this plan still describes the repo                |

`apps/graphql`'s ten are 2 schema + 6 CORS + 2 `requireEnv`; `apps/web`'s seven are three
`formatPrice`, three `graphqlFetch`, and its codegen drift guard. The task counts are two per
package that has the script, so they depend on how many packages exist by this slice — read
them off the run rather than trusting the arithmetic here.

**Earlier versions of this table said `Tests 19`, counting two Worker tests.** Those belonged to
the hello-world "API shell" slice that was merged into this one; the merge kept the count and
not the file, and there is no `src/index.test.ts` here. Ten is what the three test files above
actually contain. Read the counts, not the exit codes — `passWithNoTests` makes a suite that
stopped being collected look exactly like one that passed.

**The preview row asserts different values from the browser row, and that is the row doing its
job.** `wrangler dev` must be running in `apps/graphql` for it: wrangler resolves a local
service binding through its dev registry, and the preview output says which way it went —
`env.API (__PROJECT__-graphql) Worker local [connected]`. A `[not connected]` there is the row
failing, and it fails as a GraphQL error on the page rather than as a crash.

**`health` returning `"ok"` from the Worker is not a weaker gate than `"ok:db"` would be.**
What this slice is proving is the seam between `apps/web` and `apps/graphql`: a service
binding that resolves at upload time, a typed client generated from the same SDL the server
implements, and a CORS allowlist that fails closed. A value that travelled that whole path
proves it whether or not a database produced it. The database is a different seam, proven by
the slice that adds one.

Then run the same table again **in a fresh clone with no `.env.development` anywhere**. That
clone is the real test of this slice: it is what CI and every new contributor get, and if
anything green depends on a gitignored file, this is where it goes red. You do not need a
remote — `git ls-files | tar -cf - -T -` piped into an empty directory reproduces exactly what
a clone gets, with no `.git` and no gitignored file. Watch the counts, not just the exit codes.

**Expect it to go red, and not on the thing you are watching for.** The two failures this slice
has actually hit there were both "green only because this machine had a file the repo never
promised", one layer apart: `LayoutProps` from a gitignored `.next/types/` (fixed by folding
`next typegen` into `codegen`, which the web-shell slice now does), and `--env-file
.env.development` on `cf-typegen` (fixed above). The second is the sharper lesson, because the
file it wanted is gitignored _deliberately_ — no amount of running things locally would ever
surface it. Both dev servers passing, seventeen tests green and two browser rows rendering, and
the workspace still could not be typechecked by anyone who had just cloned it. That is the whole
argument for this row.

On the `LayoutProps` half specifically: `apps/web/src/app/layout.tsx` references a global Next
writes into gitignored `.next/types/`, so a clone fails `pnpm typecheck` with `TS2304: Cannot
find name 'LayoutProps'` unless something generates it. The fix is `next typegen` running under
`codegen`, which the web-shell slice now sets up — check it is still in that script before
debugging anything else, because `turbo.json` makes `typecheck` and `lint` depend on `codegen`
and lists `.next/types/**` among its outputs (Slice 0), so a turbo cache hit restores those
types rather than requiring a full build.

Deploy — from root, api first, then web. **The order is not a preference.** `apps/web`'s
`wrangler.jsonc` declares a service binding to `__PROJECT__-graphql`, and wrangler resolves that
binding when it uploads the Worker, not when a request arrives — so deploying web against a
Worker that does not exist yet fails the deploy outright rather than degrading at runtime.

Deploy, API first:

```bash
pnpm --filter @__PROJECT__/graphql deploy:production
pnpm --filter @__PROJECT__/web deploy:production
```

**Production gate:** the production page renders `version` and `health` from the deployed
Worker, and shows `production` for both env values — a different value than local, from a mechanism you never edited between the two
runs. Commit.

This is also the gate that justifies having a production gate at all. `graphqlFetch` reads
the Worker's bindings, which only exist once a request is in flight — but `next build`
prerenders `/` by default, calls the helper with no request, and dies. Nothing local catches
it: `next dev` never prerenders, so the browser row above passes on a build that cannot
deploy. The `await connection()` in `src/lib/api.ts` is what marks the route as request-time.
Note that Next 16 removed the `export const dynamic` route-segment config that used to do
this job — `connection()` is the replacement, and reaching for the old constant fails
silently rather than erroring, because an unrecognised export is just an export.

## The operating manual for this layer

The SDL and the generated resolver tree are the two things about this repo an agent is most
likely to get wrong by default — it will hand-write a resolver file that codegen is about to
scaffold, and it will run codegen after every SDL edit instead of once at the end. Both are
written down here rather than left to be rediscovered.

````bash
cd ../..   # to the repo root
cat > .claude/skills/graphql/SKILL.md <<'EOF'
---
name: graphql
description: Change the __PROJECT__ GraphQL API in apps/graphql — SDL schema modules, resolvers, codegen. Use when a feature needs a new field, query, or mutation, or when a resolver must change. Covers the schema module layout, the graphql-codegen server preset that scaffolds resolver files, orphan cleanup, and the Worker context.
---

# graphql layer — `apps/graphql`

## Owns / never touches

- **Owns:** SDL modules at `src/schema/<module>/schema.graphql`, with resolvers colocated
  at `src/schema/<module>/resolvers/Query/<field>.ts`. Also the merged
  `src/schema/schema.generated.graphqls` — the published artifact `apps/web` types itself
  against.
- **A new feature gets a new module directory, not a line in someone else's.**
  `system/` is health/version/appEnv only.
- **Never hand-write a file under `src/schema/*/resolvers/`.** The codegen preset owns that
  tree and re-annotates every file in it via ts-morph on each run. **If the resolver file
  isn't there, you haven't run codegen yet** — that is the whole failure mode this rule
  exists to prevent.
- **Never edit `*.generated.*` or `schema.generated.graphqls`** — regenerate instead. They
  are committed (so `apps/web` needs no build ordering to read them) but machine-owned, and
  the eslint base ignores `**/*.generated.ts` entirely.

## Codegen mechanics

```bash
# 1. edit src/schema/<module>/schema.graphql
# 2. then, ONCE — after ALL SDL edits are complete, not after each one:
pnpm turbo codegen --filter @__PROJECT__/graphql
# 3. implement the resolver files it scaffolded
```

One run scaffolds a resolver file per **root** field, wires every one into
`resolvers.generated.ts`, regenerates `types.generated.ts`, and rewrites the merged
`schema.generated.graphqls`.

`resolverGeneration: "minimal"` means **only root fields get files**. Object fields like
`Item.name` are served by GraphQL's default resolvers — don't write files for them.

Resolvers take `(_parent, _args, ctx)`. The underscore prefix is the repo's
deliberately-unused marker and the eslint base is configured for it. `ctx` is the Worker
env (`contextType: "../context#Env"`), so every binding and var a resolver needs is reached
through it:

```ts
const origins = ctx.CORS_ORIGINS;
```

New binding in `wrangler.jsonc` → `pnpm cf-typegen` to retype `WorkerEnv`.

## Judgment calls

- **Removing a field leaves an orphan resolver file.** Codegen unwires it from
  `resolvers.generated.ts` but does **not** delete it from disk. Verified behaviour — it is
  not silent: `pnpm typecheck` then fails with
  `Property 'X' does not exist on type 'QueryResolvers'`, naming the exact file. **Delete
  that file.** Don't try to make it compile.
- Sequential SDL edits followed by one codegen run is the correct rhythm. Running codegen
  against half-finished SDL scaffolds resolvers for fields you're about to rename, and each
  one becomes an orphan to clean up.
- `wrangler.jsonc` carries production-only `vars` — today `CORS_ORIGINS` and `APP_ENV`.
  `wrangler dev` overlays `.env.development` on top, which is what keeps a localhost origin
  out of the deployed allowlist. Don't merge the two. Any binding whose id Cloudflare hands
  out is added to this file by hand, which is why `scripts/docs-check.ignore` baselines it.

## Enforced elsewhere

- The server preset generates a file per root field and wires it in, so **a field can never
  be silently unresolved** — unlike a bare `Resolvers` type, whose fields are all optional.
  `pnpm typecheck` catches the gap.
- `pnpm test:unit` catches a scaffolded resolver left as a stub.
- `src/cors.test.ts` drives the real `worker.fetch`, so the CORS allowlist is proven as
  headers a browser would receive rather than as a function returning an object.
- This package's `integration` vitest project (`src/**/*.int.test.ts`) is wired and empty.
  Nothing here has a real dependency to integrate against yet; the slice that gives it one
  writes the first file into it.

EOF
````

## Sources and findings

The documentation this slice's §3 research rests on, and what running it actually turned up —
kept here rather than in a shared bibliography so that reading the slice is reading its
evidence. **Every version and claim below is dated.** A pin is only as good as its date;
re-check rather than inherit, and add a dated entry when you do (SKILL.md §7).

### Sources

- [GraphQL Yoga on Workers](https://the-guild.dev/graphql/yoga-server/docs/integrations/integration-with-cloudflare-workers)
- [GraphQL Codegen Server Preset](https://www.npmjs.com/package/@eddeee888/gcg-typescript-resolver-files)
- [Workers environment variables & secrets](https://developers.cloudflare.com/workers/configuration/environment-variables/)

### Slice 2 (built as the retired Slice 3, 2026-08-31)

Everything below was found while building the API Worker back when it was its own slice. That
slice was merged into 04; the findings are unchanged and now belong to it.

Docs read: [GraphQL Yoga on Workers](https://the-guild.dev/graphql/yoga-server/docs/integrations/integration-with-cloudflare-workers).
It still shows the modules approach the slice uses, `export default { fetch: yoga.fetch }`
verbatim, so nothing structural moved. Its only `compatibility_date` claim is an ancient
`2022-11-30` floor for Server-Sent Events, far below the workerd cap that actually governs.

Behaviour, reproduced rather than assumed:

- **graphql 17 is now npm's `latest`** (17.0.0 on 2026-06-15, 17.0.2 on 2026-07-03), so the
  reference's bare `pnpm add graphql` silently crosses a major. Checked the chain before
  taking it and everything declares 17: graphql-yoga 5.22.0 — published 2026-08-19, _after_
  17 landed — peers `^15.2.0 || ^16.0.0 || ^17.0.0`; `@graphql-tools/schema` 10.1.0 and
  `@graphql-tools/utils` 12.0.0 peer `^17.0.0`; `@graphql-codegen/cli` 7.3.1 (Slice 2) peers
  it too. Installed clean, `pnpm peers check` reported nothing new, and the Worker answered.
  Last 16.x is 16.14.2 if a future tool lags.
- **`wrangler types` flags are unchanged**: `--env-interface` still exists and the target path
  is still a positional (default `worker-configuration.d.ts`). Also present now:
  `--include-runtime`, `--include-env`, `--strict-vars`, `--check`.
- **`wrangler deploy --env-file` is confirmed on 4.127.1**, documented as an array flag —
  repeatable, later files overriding earlier. Same flag Slice 1 needed via
  `opennextjs-cloudflare deploy --`; here it goes on `wrangler deploy` directly.
- **`wrangler types` prints a second `Action required` under `nodejs_compat`, asking for
  `@types/node`.** Advisory, and declined: a Worker importing no `node:` module typechecks
  clean without it, and this tsconfig has no `"types"` entry to stop it pulling every Node
  global into a workerd-surface package.
- **`initOpenNextCloudflareForDev()` in `apps/web/next.config.ts` holds port 8787.** So with
  the web dev server up, `apps/graphql`'s `wrangler dev` steps to 8788 — easy to misread as
  two `wrangler dev` runs colliding when it is really `next dev` spawning workerd for local
  bindings. Wrangler names the port it chose; read it rather than pinning one.
- **Prettier adds a trailing comma to `.jsonc`** (it parses them as JSON5), so a
  `wrangler.jsonc` heredoc written without one drifts from disk on the first `pnpm format`
  and `docs:check` fails on a file nobody touched. Both wrangler configs now carry it.

### Slice 2, second pass — the GraphQL slice as merged (2026-08-31)

Re-checked when the Worker and the contract were built as one slice. Everything above still
held; these are the additions and the two corrections.

- **`@eddeee888/gcg-typescript-resolver-files` is 0.18.4**, up from the 0.17.0 the slice
  pinned. The exact pin exists to force a re-check, so both assumptions were re-read out of
  the published tarball rather than assumed: the stub marker is still
  `/* Implement ${name} resolver logic here */` in
  `dist/generateResolverFiles/handleGraphQLRootObjectTypeField.js`, and
  `dist/validatePresetConfig/validatePresetConfig.d.ts` still accepts `resolverGeneration`
  and `typesPluginsConfig`. Both survived; the pin moved.
- **`@graphql-codegen/client-preset` is 6.1.3** and now declares a `graphql-sock` peer. It is
  **optional** (`peerDependenciesMeta`), like `@parcel/watcher` on the CLI, so neither shows
  up as a warning and neither is installed.
- **`wrangler types --env-file` is a hard requirement, not a hint, and that breaks clones.**
  Absent, the command exits 9 with `node: .env.development: not found`. Because `cf-typegen`
  runs under `codegen` and turbo makes `typecheck` and `lint` depend on `codegen`, a fresh
  clone and CI cannot lint or typecheck at all. **Use `--strict-vars false` instead**, which
  is what the flag was silently buying: with `--strict-vars` at its default `true`,
  `wrangler types` emits each var as a _literal_ type off `wrangler.jsonc`
  (`APP_ENV: "production"`), and passing a second env file with different values happened to
  widen it back to `string`. Verified byte-identical output — same content hash — between
  `--env-file .env.development` and `--strict-vars false`. `--env-file` stays on `dev` alone,
  where a missing file _should_ stop you.
- **`wrangler types` will not create the directory it writes into.** `mkdir -p src` first, or
  it prints `Runtime types generated.` and then dies with `A file or directory could not be
found. Missing file or directory: src/worker-env.d.ts` — an error that names the file and
  reads like a path typo.
- **Vitest 4 warns on `__dirname` in an ESM package's config**: "unsupported by
  `configLoader: 'native'`, which is planned to become the default". `import.meta.dirname` is
  the replacement. Same family as the `"type": "module"` warning Slice 1 fixed — a warning
  now, a broken config load later.
- **Yoga's CORS default: the docs and the behaviour disagree, and the behaviour is what this
  slice defends against.** [The CORS page](https://the-guild.dev/graphql/yoga-server/docs/features/cors)
  summarises the no-option default as `Access-Control-Allow-Origin: *`. Driving
  `worker.fetch` directly at graphql-yoga 5.22.0 shows the reflected-origin behaviour the
  slice describes instead. Every assertion in `src/cors.test.ts` was confirmed against the
  running Worker, including the two counter-intuitive ones: a refused origin comes back as
  the literal string `"null"`, and a **one-entry** allowlist is short-circuited to a fixed
  header regardless of who asked. The second was then re-confirmed against the _deployed_
  Worker, since one entry is the shape production runs.
- **The first request after `wrangler deploy` can return Cloudflare's `error code: 1104`.**
  Propagation, not a failed deploy — the identical request succeeded seconds later. Re-run
  before debugging.
- **`pnpm init` no longer writes a `devEngines` block** on pnpm 11.15.1, so the trap Slice 0
  documents did not fire. Left in place: it is version-specific and cheap to keep.

## Leaves behind

Read by Slice 99 (the audit), which treats this as a **cross-check and never as the source of truth** —
the code is that. An entry here is a claim about the repo; where the two disagree, the code
wins and this table is the finding.

**Provisional** is something built to prove a mechanism, with the condition that retires it.
**Accepted** is a risk taken knowingly, with the reasoning written down so a later slice can
re-decide it rather than rediscover it.

### Provisional

Nothing. `health`, `version` and `appEnv` are permanent operational fields, not scaffolding —
they are how the deploy is checked.

### Accepted

| Risk                                                           | Reachable by        | Why this is the right trade                                                                                                                                                                                                                                       |
| -------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GraphiQL and introspection are served in production**        | The entire internet | `createYoga` is called without a `graphiql` option, so this is Yoga's **default, not a choice made here**. It makes the manual gate rows one click. Every later slice adding a root field widens it — Slice 5's `sendTestEmail` is the first that does something. |
| `appEnv`, `version` disclose deployment detail unauthenticated | The entire internet | Operationally useful and individually harmless; listed because "harmless each" is how disclosure accumulates.                                                                                                                                                     |
| The API Worker is public and has no rate limit                 | The entire internet | Nothing here is expensive yet. Re-decide at the first field that writes, spends or sends.                                                                                                                                                                         |
