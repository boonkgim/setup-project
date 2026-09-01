# Slice 3 — Database: Docker locally, Neon in production

`packages/db`, and then the seam between it and the Worker the GraphQL slice deployed: Docker → schema →
migrations → wire the Worker → local gate → Neon → Hyperdrive → production gate.

Both halves of what a horizontal slice owes, in that order. **Infrastructure:** migrations
apply and a row round-trips through a real Postgres, proven by this package's own integration
test with nothing downstream involved. **Integration:** the GraphQL slice's `health` resolver stops
answering out of thin air and starts answering out of a table, reached through a Hyperdrive
binding. The observable never changes — the page said `health` before and says `health` after
— which is precisely what makes the second half a proof about a seam rather than a feature.

## Local half

Root `docker-compose.yml`. Check where the previous slice left you before copying the `cd`
below — a slice that ended by writing its skill file ended at the repo root, and this file
belongs there:

**Pin the newest Postgres major Neon offers, and do not ask.** Neon's create-project form
already defaults to it (18, as of 2026-08), it supports the five newest majors, and a
greenfield project has no reason to want an older one. The only case that picks a different
number is an existing Neon project already running one — then match _it_, because the local
container exists to make "applies locally" mean "applies there".

```bash
cat > docker-compose.yml <<'EOF'
services:
  postgres:
    image: postgres:18
    ports:
      - "5434:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: __PROJECT__
    # /var/lib/postgresql, NOT /var/lib/postgresql/data. Postgres 18 changed where the
    # image puts its data: PGDATA moved to a major-versioned subdirectory
    # (/var/lib/postgresql/18/docker) so `pg_upgrade --link` can work across majors
    # without crossing a mount boundary. Mount the pre-18 path on 18 and the container
    # exits 1 on first start with a wall of text about pg_upgrade — NOT an
    # obviously-wrong-volume error, so it reads as a broken image rather than a wrong
    # line. See docker-library/postgres#1259.
    volumes:
      - pgdata:/var/lib/postgresql
    # So `docker compose up -d --wait` can block until Postgres actually accepts
    # connections. Without it `pnpm start` races: the container is "up" some seconds
    # before the socket answers, and the migrate step right after it fails.
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 2s
      timeout: 3s
      retries: 15
volumes:
  pgdata:
EOF
docker compose up -d --wait
```

**The daily loop from here on:** `docker compose up -d` once, then `pnpm turbo dev` runs both
`apps/web` and, later, the API Worker. Small commits at every green gate keep fast iteration
reversible.

`packages/db` (`@__PROJECT__/db`):

```bash
mkdir -p packages/db && cd packages/db && pnpm init
pnpm pkg set name="@__PROJECT__/db"
pnpm pkg set exports="./src/index.ts"
pnpm pkg delete main
pnpm add drizzle-orm pg
pnpm add -D drizzle-kit @types/pg
```

The `exports` line is load-bearing and easy to skip: `pnpm init` writes `"main": "index.js"`
pointing at a file this package never creates, so `import ... from "@__PROJECT__/db"` fails to
resolve in every consumer — wrangler's build error even suggests adding an `alias`, which
treats the symptom. Because the base tsconfig sets `moduleResolution: "Bundler"`, `exports`
can name the TypeScript source directly and no build step is needed; wrangler, vitest, and
`tsc` all follow it.

Cloudflare recommends **node-postgres (`pg`)** over `postgres.js` — best compatibility with
Hyperdrive's query caching — and its stated minimum has moved: **≥ 8.16.3** as of 2026-08, up
from 8.13. Re-read the floor rather than trusting this number; the page also moved, to
`.../connect-to-postgres/postgres-drivers-and-libraries/node-postgres/`.

Cloudflare's own sample now builds a bare `Client` per request rather than a `Pool`. Keep the
`Pool` below: `maxUses: 1` is the same contract (a connection used once, then discarded) while
leaving one type both callers can use — the Worker through Hyperdrive, and this package's
integration test straight against Docker. Drizzle re-exposes either as `$client`, which is what
lets that test close the handle.

`src/schema.ts` — Drizzle tables; single source of truth. Start with one real table so the
gates prove something:

```bash
mkdir -p src
cat > src/schema.ts <<'EOF'
import { pgTable, serial, text } from "drizzle-orm/pg-core";

export const items = pgTable("items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
});
EOF
```

`src/client.ts` — a factory, not a singleton:

```bash
cat > src/client.ts <<'EOF'
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString, max: 5, maxUses: 1 });
  return drizzle(pool, { schema });
}
EOF
```

Per-request creation with `maxUses: 1` is the documented Workers pattern — isolates shouldn't
hold connections across requests; Hyperdrive does the real pooling in production, and locally
Docker Postgres doesn't need pooling at all.

`src/index.ts` — the barrel the `exports` field points at. Consumers import the factory and
the tables from the package root, never from its internals:

```bash
cat > src/index.ts <<'EOF'
export { createDb } from "./client";
export * from "./schema";
EOF
```

**The two migration targets.** This package is the only thing in the repo that talks to
Postgres directly rather than through the Hyperdrive binding, so it is the only place a
connection string has to be kept — once per environment. Both files use the **same key**,
`DATABASE_URL`; the _command_ selects the file, never the variable name:

| Target | Env file           | Command                   | Database              |
| ------ | ------------------ | ------------------------- | --------------------- |
| local  | `.env.development` | `pnpm migrate`            | Docker                |
| prod   | `.env.production`  | `pnpm migrate:production` | Neon, direct/unpooled |

Neither file is committed — `.gitignore`'s `.env*` covers both. drizzle-kit auto-loads `.env`
but **not** either of these, so load them explicitly (this is the one place in the repo that
needs `dotenv` — Next.js finds `.env.development` by mode, and wrangler is handed it by
`--env-file`):

```bash
pnpm add -D dotenv
cat > drizzle.shared.ts <<'EOF'
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Both migration targets are built from here so `out` and `schema` cannot drift
// apart. Two configs that disagreed about `out` would split the migration history
// between environments, which is the one bug in this package with no easy repair.
export function defineDrizzleConfig(envFile: string) {
  // override: true — the file named by the command wins over anything already in the
  // environment. dotenv's default is the opposite, so an exported DATABASE_URL left
  // in a shell would silently retarget the run. For the only command here that can
  // mutate production, the target must come from the command you typed.
  config({ path: envFile, override: true });

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      `packages/db/${envFile} is missing or defines no DATABASE_URL. ` +
        `Both env files are gitignored and use the same key — see __DOCS__, Slice 3.`,
    );
  }

  return defineConfig({
    dialect: "postgresql",
    schema: "./src/schema.ts",
    out: "./migrations",
    dbCredentials: { url },
  });
}
EOF
cat > drizzle.config.ts <<'EOF'
import { defineDrizzleConfig } from "./drizzle.shared";

// Local Docker. `pnpm migrate`.
export default defineDrizzleConfig(".env.development");
EOF
cat > drizzle.production.config.ts <<'EOF'
import { defineDrizzleConfig } from "./drizzle.shared";

// Neon, direct/unpooled endpoint. `pnpm migrate:production`.
// Migrations never run from a Worker — always from your machine, against this file.
export default defineDrizzleConfig(".env.production");
EOF
```

`override: true` costs you the inline escape hatch — `DATABASE_URL="…" pnpm migrate` no
longer retargets anything, and that is the point. Migration is the only command in this repo
that mutates production, and a stale export in a shell is exactly how it would hit the wrong
database without anyone typing anything wrong. If you need a third target, add a third config,
not a variable.

`packages/db/.env.development` — gitignored, your machine's values. The name is not
drizzle-kit's to care about, since the config names the file outright; it is
`.env.development` per the convention Slice 0 set, so this package's local file is named the
same as every other package's. `.env.production` is created later, at this slice's production
gate, once the Neon project exists:

```bash
echo "DATABASE_URL=postgres://postgres:postgres@localhost:5434/__PROJECT__" > .env.development
```

Add the checklist file too — the only committed env file in the package, holding a dummy
value rather than a real one. One entry covers both targets, since they use the same key:

```bash
cat > .env.example <<'EOF'
# .env.development (Docker) and .env.production (Neon direct/unpooled) both define this
# same key; the command you run picks the file. Neither is committed.
DATABASE_URL=postgres://user:password@localhost:5434/dbname
EOF
```

The integration test below carries the same Docker URL as an in-code default rather than in a
second env file — see the note under it.

Generate and apply the first migration:

```bash
pnpm generate && pnpm migrate
```

The full standard package setup — all five pieces this time, plus the three migration
scripts. Note the naming rule the rest of the repo follows: **a script that acts on
production ends in `:production`**, and that suffix is the only thing that selects the
production env file. A bare script name never touches production.

```bash
pnpm add -D vitest
pnpm pkg set \
  scripts.typecheck="tsc --noEmit" \
  scripts.lint="eslint . --max-warnings 0" \
  scripts.format="prettier --write . --ignore-path ../../.gitignore --ignore-path ../../.prettierignore" \
  scripts.test="vitest run" \
  'scripts["test:unit"]=vitest run --project unit' \
  'scripts["test:integration"]=vitest run --project integration' \
  scripts.generate="drizzle-kit generate" \
  scripts.migrate="drizzle-kit migrate" \
  'scripts["migrate:production"]=drizzle-kit migrate --config drizzle.production.config.ts'
```

`generate` gets no `:production` twin on purpose — it only diffs `src/schema.ts` against the
committed snapshot to write a migration file, and never opens a connection.

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

```bash
cat > eslint.config.mjs <<'EOF'
import base from "../../packages/config/eslint.base.mjs";

export default [...base];
EOF
cat > tsconfig.json <<'EOF'
{
  "extends": "../../packages/config/tsconfig.base.json",
  // drizzle-orm ships .d.ts for every dialect it supports — gel, mysql2, and others
  // whose driver packages we deliberately do not install, since we only use pg. Those
  // declarations fail to resolve their own imports, so checking them is checking
  // dependencies we will never load. The API Worker sets the same flag for its own reason.
  "compilerOptions": { "skipLibCheck": true },
  "include": ["src"]
}
EOF
```

And the **first real integration test** — this slice is why `test:integration` exists:

```bash
cat > src/client.int.test.ts <<'EOF'
import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { createDb } from "./client";
import { items } from "./schema";

// Docker Compose defaults, identical for everyone — the override is for a nonstandard port.
const DOCKER_URL = "postgres://postgres:postgres@localhost:5434/__PROJECT__";
const url = process.env.DATABASE_URL ?? DOCKER_URL;

test("round-trips a row through local Postgres", async () => {
  const db = createDb(url);
  const name = `round-trip-${process.pid}`;

  try {
    const [inserted] = await db.insert(items).values({ name }).returning();
    expect(inserted.name).toBe(name);

    const found = await db
      .select()
      .from(items)
      .where(eq(items.id, inserted.id));
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe(name);

    await db.delete(items).where(eq(items.id, inserted.id));
  } finally {
    // createDb hides the Pool; drizzle re-exposes it as $client. Without this,
    // the open handle keeps vitest from exiting.
    await db.$client.end();
  }
});
EOF
```

Three things this test is doing deliberately. It **asserts on the row it read back**, not just
that the query resolved — a `select` that returns nothing still "succeeds". It **cleans up**,
so re-running doesn't accumulate rows and change the next run's result. And it **closes the
pool** in a `finally`, because `createDb` returns the drizzle instance rather than the `Pool`,
and a leaked handle makes vitest hang after the assertions have already passed.

**Why a default in code instead of a committed `.env.test`:** every env file except
`.env.example` is gitignored, so a test that depended on one would pass for you and fail on a
fresh clone. The value isn't a secret — it's the docker-compose credentials three blocks up,
already in the repo — so the honest place for it is the test. `??` still leaves an escape
hatch, but an exported `DATABASE_URL` is the only one: vitest reads no `.env` file into
`process.env`, so putting a value in `.env.development` will not retarget a test the way it
retargets `pnpm migrate`. That is what CI does — it exports the variable for the tests and
writes the file for drizzle-kit, which is two mechanisms because they really are two.
Docker must be up — that's the contract of `test:integration`.

## Wiring it to the Worker

That is the infrastructure half proven: migrations apply and a row round-trips, without
anything downstream needing to exist. The rest of this slice is the other half a horizontal
slice owes — that the new layer works _integrated_ with what is already built. Slice 3's
Worker currently answers `health` out of thin air; by the end of this section it answers out
of Postgres, and that rewrite is the whole proof.

```bash
cd ../../apps/graphql   # from packages/db
pnpm add @__PROJECT__/db@workspace:*
```

Add the Hyperdrive binding by rewriting `apps/graphql/wrangler.jsonc`'s binding block by hand
— Slice 3 stopped owning that file whole, and `scripts/docs-check.ignore` already says so.
Locally `wrangler dev` ignores `id` entirely and dials `localConnectionString`, which points at
the Docker Postgres above. `id` is still a **required** key even for purely local development,
which is why a placeholder goes in now rather than the key being left out until production:

```jsonc
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "placeholder-until-production-half",
      "localConnectionString": "postgres://postgres:postgres@localhost:5434/__PROJECT__",
    },
  ],
```

**Hyperdrive is a binding on a Worker, which is why it is configured here and not in Slice 3.**
It is a connection pooler that fronts _this_ database for _that_ Worker, so it could not exist
before both did. It is this slice's integration step in the most literal sense: the object that
joins the two layers.

**Whether `src/context.ts` needs an edit depends on how the API slice wrote it — read it
before touching it.** Every resolver signature is generated from that type, so `ctx.HYPERDRIVE`
has to exist on it either way, but there are two shapes and only one needs a hand:

- `export type Env = WorkerEnv` — an alias onto the interface `wrangler types` generates from
  `wrangler.jsonc`. **Edit nothing.** `cf-typegen` adds `HYPERDRIVE: Hyperdrive` itself, and
  writing it again would create the second description of the bindings the alias exists to
  prevent. This is the shape the current API slice produces, so this is the usual answer.
- A hand-written `export interface Env { … }` listing bindings literally. Then add the line:

  ```diff
  --- apps/graphql/src/context.ts
   export interface Env {
  +  HYPERDRIVE: Hyperdrive;
     /** Comma-separated browser origin allowlist — see cors.ts. Optional because it is a
  ```

`Hyperdrive` is part of the generated runtime types rather than something the binding creates,
so it resolves as soon as `cf-typegen` has run once. `wrangler.jsonc` changed, so run both
generators and commit what they write:

```bash
pnpm cf-typegen
pnpm codegen
```

Now the rewrite that is the point of this slice. `health` stops answering for itself:

```bash
cat > src/schema/system/resolvers/Query/health.ts <<'EOF'
import { createDb, items } from "@__PROJECT__/db";
import type { QueryResolvers } from "./../../../types.generated";

// Reads the migrated table rather than just constructing a client. Building a Pool
// opens no socket, so a health check that skipped this query would pass against a
// database that does not exist. Integration-only by construction.
export const health: NonNullable<QueryResolvers["health"]> = async (
  _parent,
  _arg,
  ctx,
) => {
  const db = createDb(ctx.HYPERDRIVE.connectionString);
  await db.select({ id: items.id }).from(items).limit(1);
  return "ok:db";
};
EOF
```

`version` is deliberately left alone: it touches no database, which is what keeps the unit
suite runnable with neither Docker nor a stub connection string. Splitting the two fields by
what they can honestly reach is what keeps both suites truthful.

And the Worker's own integration test, which Slice 3 had no way to write:

```bash
cat > src/index.int.test.ts <<'EOF'
import { expect, test } from "vitest";
import worker, { type Env } from "./index";

const DOCKER_URL = "postgres://postgres:postgres@localhost:5434/__PROJECT__";
const env = {
  HYPERDRIVE: { connectionString: process.env.DATABASE_URL ?? DOCKER_URL },
} as unknown as Env;

test("health round-trips through Postgres", async () => {
  const res = await worker.fetch(
    new Request("http://localhost/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{ health }" }),
    }),
    env,
  );
  expect(await res.json()).toEqual({ data: { health: "ok:db" } });
});
EOF
```

**Prove the test can fail before trusting it.** node-postgres opens no socket until a query
runs, so a `health` that stopped at `createDb(...)` would return `ok:db` against a database
that does not exist — and this test would pass with Docker down, reporting a round-trip that
never happened. Point it at nothing and watch it go red:

```bash
DATABASE_URL="postgres://nobody:nobody@localhost:9999/nope" pnpm test:integration
```

```bash
cd ../..   # back to the repo root
```

**Local gate** — `docker compose up -d` first (from root, where `docker-compose.yml` lives):

| Where          | Check                       | Expect                                                           |
| -------------- | --------------------------- | ---------------------------------------------------------------- |
| browser        | `localhost:3000`            | `health` now reads `ok:db` — the same page, a different source   |
| `apps/graphql` | `pnpm dev`                  | `{ health }` round-trips through Postgres                        |
| root           | `pnpm typecheck`            | pass                                                             |
| root           | **`pnpm lint`**             | **`5 successful`** — 3 lint (web, graphql, db) + 2 `codegen`     |
| root           | **`pnpm test:unit`**        | **`Tests 19 passed`** — unchanged; nothing here is unit-testable |
| root           | **`pnpm test:integration`** | **`Tests 2 passed`** — db round-trip + health-through-Postgres   |

The browser row is the one that matters, and it is why this slice reads as integration rather
than infrastructure: **the page does not change.** It rendered `health` before and it renders
`health` now — only the source moved, from the Worker's own return statement to a table in
Postgres. A slice that changes where an unchanged observable comes from is exactly a slice
that proves a seam.

`test:integration` going from 0 to 2 is the signal this slice is real. If it still reports 0,
Docker is down or the `*.int.test.ts` names are wrong — and `passWithNoTests` will report that
as success.

## Production half

Create the Neon project (if not yet) and copy the **direct/unpooled** connection string.

**Leave the create form's "Enable Neon Auth" toggle off.** It provisions Neon's own auth tables
into this database. The authentication slice uses Better Auth and generates its own, so turning
this on lands a second, competing auth system in the same database — and it defaults to off, so
this costs nothing but noticing.

Write it to `packages/db/.env.production` — gitignored, same `DATABASE_URL` key as
`.env.development`, and the only copy you keep. This is the one string in the whole repo you would
otherwise have to remember and re-paste on every migration:

```bash
cd packages/db
echo "DATABASE_URL=postgres://...neon direct url..." > .env.production
```

Then apply migrations to Neon from your machine (migrations never run from Workers):

```bash
pnpm migrate:production
```

Expect a `SECURITY WARNING` from `pg` about `sslmode=require` becoming a libpq-semantics alias
in pg v9 / pg-connection-string v3. It is a deprecation notice and the migration applies; do
not go changing the connection string over it.

Two files, one key, and the target named in the command. If you would rather not keep a
production credential on disk, the alternative is a password-manager CLI in the script
(`dotenv -e <(op read …)` or equivalent) — but do not go back to pasting it inline, which is
how it ends up in your shell history and, via a stale export, in the wrong migration.

Then the Hyperdrive config that fronts Neon for the Worker. Run it from `apps/graphql`, where
wrangler is installed (`pnpm wrangler` cannot resolve it from `packages/db`), then copy the
`id` it prints into the placeholder left in `wrangler.jsonc` above:

```bash
cd ../../apps/graphql   # from packages/db
pnpm wrangler hyperdrive create __PROJECT__-hyperdrive --env-file .env.production --connection-string="postgres://...neon direct url..."
pnpm cf-typegen
```

**`--env-file .env.production` is required whenever the `wrangler login` carries more than one
account** — the same condition the web slice already flags for `deploy`, and it applies to every
command that _creates_ a Cloudflare resource, not just to uploads. Without it wrangler refuses
to guess and the create fails. `.env.production` is where `CLOUDFLARE_ACCOUNT_ID` already lives,
and it must be the account the Worker deploys into: a Hyperdrive config in another account
cannot be bound to it.

Two things `create` will offer that you should decline. `--update-config` writes the binding
into `wrangler.jsonc` for you, and reformats the file — dropping every comment explaining it;
and even without that flag the command ends by asking whether to edit the config anyway. A
non-interactive shell answers that one itself (`Using fallback value in non-interactive
context: no`); an interactive one needs you to say no. Copy the `id` over the placeholder by
hand.

Neon's string can go to Hyperdrive with its `?sslmode=require&channel_binding=require` query
intact — no need to strip the parameters.

**Getting the string out of the Neon console without pasting it anywhere.** Turn
**Connection pooling off** in the Connect dialog — the pooled host contains `-pooler` and the
direct one does not, which is the quickest confirmation you have the right one. **Copy snippet**
puts the real string on the clipboard (not the masked form shown on screen), so on Linux
`xclip -selection clipboard -o` moves it console → file without going through a shell history.

Use Neon's **direct (unpooled)** string — the same one just written to
`packages/db/.env.production`. Hyperdrive is itself the pooler; stacking it on Neon's pooled
endpoint is discouraged. `nodejs_compat` with a compatibility date ≥ 2024-09-23 is required for
the `pg` driver, already satisfied by Slice 3's config, and Hyperdrive's caching does not take
effect locally — expected, not a misconfiguration.

Redeploy the Worker so production picks up the binding. API before web is the standing rule,
but only the API changed here:

```bash
pnpm deploy:production
```

`apps/web` really does not need a redeploy — the service binding resolves to the _Worker_, not
to a version of it, so the deployed page serves the new value on its next request. Verify that
rather than redeploying web out of caution.

**Production gate:** `pnpm migrate:production` applies cleanly to Neon and re-running it is a
no-op — drizzle-kit's journal is the proof it landed and is not re-applied — and the production
page from Slice 3 now shows `health` as `ok:db`, served through Hyperdrive from Neon. Same
page, same field, real data behind it. Commit.

## The operating manual for this layer

The slice that builds a layer is where that layer's rules are discovered, so it is where they
get written down. `.claude/skills/code-db/SKILL.md` — **or whatever the skills already in the project are called;
match them rather than this path.** A project whose API slice installed `.claude/skills/graphql/`
wants `.claude/skills/db/`, not `code-db`. It is what an agent — or a person — reads before
touching the schema from here on: the generate/migrate rhythm, and the judgment calls no tool
can catch, starting with the one that costs data.

It is deliberately thin on general database advice. A skill exists to carry what a model does
_not_ already know: the local port, which command touches production, and the fact that a
rename generates as `DROP` + `ADD`. Anything an agent would get right unprompted is noise.

````bash
cd ../..   # to the repo root
cat > .claude/skills/code-db/SKILL.md <<'EOF'
---
name: code-db
description: Change the __PROJECT__ database schema in packages/db — tables, columns, indexes, migrations. Use when a feature needs new or changed data. Covers Drizzle schema edits, drizzle-kit generate/migrate, reviewing generated SQL before applying it, and the local Docker Postgres.
---

# db layer — `packages/db`

## Owns / never touches

- **Owns:** `src/schema.ts` is the source of truth for every table. Nothing else defines
  one. Also owns `migrations/` and the client factory in `src/client.ts`.
- **Never:** `apps/web` must not import `@__PROJECT__/db` — only the API Worker does. The
  dependency graph is the architecture; web reaches data through the API or not at all.
- **Never:** migrations do not run from a Worker. They run from your machine via
  drizzle-kit, against a direct connection — never through Hyperdrive.

## Drizzle mechanics

```bash
docker compose up -d                        # local Postgres — port 5434, not 5432
pnpm --filter @__PROJECT__/db generate        # writes migrations/NNNN_name.sql + snapshot
#   ↳ READ THE GENERATED SQL NOW
pnpm --filter @__PROJECT__/db migrate         # applies to local Docker via .env.development
```

`migrate:production` is a separate deliberate command run at deploy time, not here — the
`:production` suffix selects `.env.production` (the Neon **direct/unpooled** URL, under the
same `DATABASE_URL` key) and is what makes a destructive command impossible to type by
accident.

## Judgment calls

- **Read the generated SQL before migrating.** This is the step that gets skipped, and it
  is the only place a data-loss migration is visible before it runs.
- **A column rename generates as `DROP` + `ADD`** — the data goes with it. Prefer additive
  changes. If you genuinely need a rename that preserves data, hand-edit the generated SQL
  to `ALTER TABLE … RENAME COLUMN` _before_ running `migrate`.
- **Never edit a migration that has already been applied anywhere** — local or production.
  Write a new one. The applied set is tracked in the database, so an edited file silently
  diverges from what's actually deployed.
- `migrations/meta/` is drizzle's own state (snapshots + `_journal.json`). Never hand-edit
  it; it is what `generate` diffs against to decide what changed.
- Adding an env key means updating `.env.example` in the same change — it is the only
  committed env file and holds dummy values.

## Enforced elsewhere

- Integration tests hit a real database: `*.int.test.ts` (`src/client.int.test.ts`), run by
  `pnpm test:integration`. They need `docker compose up -d` first and are not cached.
- A health check must query an actual table rather than just construct a client: node-postgres
  opens no socket until a query runs, so a check that stopped at `createDb(...)` would report
  healthy against a database that does not exist.

EOF
````

## Sources and findings

The documentation this slice's §3 research rests on, and what running it actually turned up —
kept here rather than in a shared bibliography so that reading the slice is reading its
evidence. **Every version and claim below is dated.** A pin is only as good as its date;
re-check rather than inherit, and add a dated entry when you do (SKILL.md §7).

### Sources

- [Hyperdrive get-started](https://developers.cloudflare.com/hyperdrive/get-started/)
- [Hyperdrive local development](https://developers.cloudflare.com/hyperdrive/configuration/local-development/)
- [Hyperdrive + Neon](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/neon/)
- [Connect to PostgreSQL · Hyperdrive](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/)
- [OpenNext DB how-to](https://opennext.js.org/cloudflare/howtos/db)

### Slice 3 — Database (checked 2026-08-31)

- **Versions as installed:** drizzle-orm 0.45.2, drizzle-kit 0.31.10, pg 8.23.0,
  @types/pg 8.23.1, dotenv 17.4.2, vitest 4.1.11. drizzle-kit's config surface is unchanged —
  `defineConfig` is still exported from `drizzle-kit`, `dbCredentials.url` is still the
  postgresql key, and `--config` still selects an alternate file. Nothing in this slice's
  drizzle code needed adapting.
- **`postgres:18` moved its data directory, and the failure does not look like a volume
  problem.** `PGDATA` is now `/var/lib/postgresql/18/docker` — a major-versioned subdirectory,
  so `pg_upgrade --link` can work across majors without crossing a mount boundary. Mount the
  pre-18 path (`/var/lib/postgresql/data`) on an 18 image and the container **exits 1 on first
  start** with a long `pg_upgrade` advisory, which reads as a broken image rather than a wrong
  line in the compose file. Mount `/var/lib/postgresql` instead.
  See [docker-library/postgres#1259](https://github.com/docker-library/postgres/pull/1259).
- **Neon supports Postgres 14–18 and its create-project form defaults to 18** (18 GA on Neon
  since 2026-05-01). So the local pin is not a judgement call on a greenfield project: take the
  newest, and only match an older major when an existing Neon project already runs one.
- **Cloudflare's node-postgres minimum is now 8.16.3**, up from 8.13, and the page moved to
  `hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/`. The
  sample there now builds a bare `Client` per request rather than a `Pool`; `Pool` with
  `maxUses: 1` is the same contract and keeps one type usable by both the Worker and the
  package's own integration test.
- **`localConnectionString` survives, and `id` is still required even for local-only
  development** — so the placeholder-then-replace step is not avoidable by omitting the key.
  `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_<BINDING>` also exists as an env-var
  alternative; unused here, since the value is the docker-compose credentials already in the
  repo.
- **`wrangler hyperdrive create` needs `--env-file .env.production` on a multi-account login.**
  Same condition the web slice flags for `deploy`, but it applies to resource _creation_ too,
  and the reference procedure omitted it. `wrangler whoami` is how you find out; three accounts
  on this login made it mandatory.
- **`wrangler hyperdrive create` now has `--binding` and `--update-config`**, which will write
  the binding into `wrangler.jsonc` for you. Declined deliberately — it reformats the file and
  drops the comments. Even without the flag the command ends by offering the same thing; a
  non-interactive shell answers `Using fallback value in non-interactive context: no`, which is
  the wanted answer, but an interactive one has to be told.
- **Hyperdrive accepted Neon's string with `?sslmode=require&channel_binding=require` intact.**
  No need to strip query parameters before handing it over.
- **`pg` now prints a `SECURITY WARNING` on `sslmode=require`**, announcing that `prefer`,
  `require` and `verify-ca` stop being aliases for `verify-full` in pg v9 /
  pg-connection-string v3. Deprecation notice only; `migrate:production` applies. Revisit at pg 9.
- **No web redeploy was needed for the API's new binding.** The service binding resolves to the
  Worker rather than to a version of it, so the deployed page served the new `health` value on
  its next request. Verified rather than assumed.
- **Neon's create-project form offers "Enable Neon Auth".** Leave it off — the auth slice uses
  Better Auth and generates its own tables; enabling this lands a competing auth system in the
  same database.
- **Getting the connection string out of the console without pasting it.** Turning
  **Connection pooling** off is visible in the host (`-pooler` present or absent), and **Copy
  snippet** copies the real password rather than the masked form shown on screen — so
  `xclip -selection clipboard -o` moves it console → file without a shell history.
- **The `format` script's two-flag correction was applied to the prose but not to three of the
  commands.** Slice 0 states the rule and carries a paragraph explaining that it originally
  said one flag and was wrong; Slice 1 is where the bug was found and its command was fixed.
  The sibling `pnpm pkg set` lines in slices 2, 3 and 5 kept the pre-correction one-path form
  — so the reference stated the rule and then handed you three commands breaking it. All three
  are now corrected, each with a short note pointing back at slice 0/1 so the next partial fix
  is visible.
  Measured rather than reasoned: in a built `apps/web`, `prettier --list-different .` reports
  **0** files with both flags and **356** with only `--ignore-path ../../.prettierignore` —
  `.next` build output that `pnpm format` would rewrite in place. The two entries left alone in
  slice 0 are correct: `packages/mock` runs a bare `prettier --write .`, which keeps prettier's
  default of _both_ ignore files (and is exactly why mock could not have caught this), and the
  root script is a `turbo run format` passthrough.

## Leaves behind

Read by Slice 99 (the audit), which treats this as a **cross-check and never as the source of truth** —
the code is that. An entry here is a claim about the repo; where the two disagree, the code
wins and this table is the finding.

**Provisional** is something built to prove a mechanism, with the condition that retires it.
**Accepted** is a risk taken knowingly, with the reasoning written down so a later slice can
re-decide it rather than rediscover it.

### Provisional

| Artifact                        | Why it exists                                                                               | Retired when                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| The placeholder Hyperdrive `id` | `id` is a required key even for purely local `wrangler dev`, before the real config exists. | The production half of this same slice replaces it with the real id. |

### Accepted

| Risk                                                   | Reachable by                     | Why this is the right trade                                                                                                                                  |
| ------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Docker Postgres runs as `postgres:postgres` on `:5434` | Anything on the developer's host | Local only, never deployed, and the port is bound by compose rather than exposed. A real credential here would have to be committed or invented per machine. |
| `DATABASE_URL` lives in gitignored `.env.*` files      | Whoever holds the machine        | The alternative is a committed file. `.gitignore`'s `.env*` plus `!.env.example` is what enforces it — check that rule still holds.                          |
