# The slice catalog

What each slice builds, what it needs from you before it can pass, and what "done" looks
like. Read the entry for a slice before building it; the slice file itself is the reference
procedure, to be checked against current documentation and then written into the project as
a plan (see SKILL.md §3–4).

**Every version, flag and file path below is a claim that was true once.** They are here to
tell you what to verify, not to be trusted as-is.

The stack is fixed: pnpm workspace · Next.js on Cloudflare Workers via OpenNext · GraphQL
Yoga Worker · Drizzle + Postgres (Docker locally, Neon through Hyperdrive in production).
Slices choose **how far up that stack to build**, not which stack.

## Dependencies

Hard prerequisites, enforced by `scripts/install-plan.mjs`:

```
00 → 01 → 02 → 03 → 04 → 05 → 06 → 07     99 (audit — after any of them, repeatedly)
```

**99 is not a rung.** It builds nothing, requires only `00`, and reads whatever exists, so it
is excluded from `--through` ranges and from "highest built + 1" at dispatch. Run it after any
slice that adds public surface, and again whenever you want; a repo holding `00`–`05` plus `99`
still has `06` as its next build. The number is 99 and not 08 precisely so the filename says so.

A plain line, with no gaps and no branch. It took two corrections to get there. An "API shell"
slice once held a hello-world Worker, and the schema that gave it a reason to exist arrived two
slices later; merging those two removed the branch — the slice downstream needed both — and
closed a gap in the numbering. Then the database, which had been built first, moved after the
Worker: it was the one slice in the chain with nothing to integrate against, because
`apps/web` is forbidden to import it and no other consumer existed yet.

The rule both corrections came from: **every slice must prove its layer works standalone _and_
works joined to what is already built.** A slice with no seam to prove is doing half a job, and
a seam nobody can stand on either side of is not a slice boundary.

Slices are built one per invocation, in order — there is no up-front selection to make, and
nothing is written into the project for a slice until it is being built. The table below is
about where it is sensible to _stop_, not what to choose in advance.

The chain is not conservatism. 03's integration half rewrites a resolver 02 wrote, so it has
nothing to attach to without it; 04's components are what 06's sign-in panel is built from;
05, 06 and 07 each carry `diff` hunks that patch files the earlier slices wrote — `CLAUDE.md`, `apps/graphql/.env.example`,
`.claude/skills/*/SKILL.md` — and a hunk whose context is missing is a hard error in
`pnpm docs:check`, not a warning.

So the real choice is **where to stop**:

| Stopping at | You have                                                     |
| ----------- | ------------------------------------------------------------ |
| 04          | the scaffold: deployed web + API + database + theming system |
| 05          | \+ transactional email                                       |
| 06          | \+ accounts, magic-link sign-in, sessions                    |
| 07          | \+ Stripe embedded Checkout and a signed webhook             |
| 99          | (not a stopping point — an audit of wherever you stopped)    |

Stopping earlier than 04 is legitimate while building — install 00–02 today and add 03–04
next week — but it is a staging point, not a finished configuration. Slices 3–4 each end by
writing the operating manual for the layer they built.

Every slice in the chain is a legitimate place to stand, which is the test a slice boundary
has to pass: at each one, everything built so far is either in use or provable on its own
terms. That is why 03 survives alone (its migrations and integration test need no consumer)
and why the old 02 did not (a deployed Worker serving `health` and nothing else).

Two soft dependencies are worth naming out loud when someone asks for a subset:

- **06 without 05.** Not a soft dependency any more — it is a hard one. Slice 6 signs people
  in with a magic link, so `packages/email` is not a nicety attached to sign-up, it _is_ the
  login path: no mailer, no way in at all. Slice 6 also repurposes Slice 5's template
  (`renderVerifyEmail` becomes `renderSignInEmail`) and amends its log transport to print the
  link, so the hunks have nothing to anchor on without it. Build 05.
- **07 without 06.** Slice 7 renames `BETTER_AUTH_URL` to `WEB_ORIGIN` by patching
  `apps/graphql/src/auth.ts` and `src/auth.int.test.ts`. Without 06 those files do not
  exist, and `WEB_ORIGIN` has to be introduced from scratch instead.

## Per slice

### 00 — Workspace foundation

pnpm workspace, `catalog:` pins, turbo, prettier + ESLint + vitest harness, root scripts,
`.gitignore`, `packages/config`, the environment file convention every later package
follows, the first `CLAUDE.md`, and `scripts/docs-check.mjs` — which compares this plan's
heredocs against the repo and runs inside `pnpm verify`.

- **Needs:** Node 24+, pnpm via corepack. Nothing else.
- **Gate:** local only. `pnpm install` clean, `typecheck`/`lint`/`format` pass, 0 tests.
- **Watch:** `pnpm init` writes a `devEngines` block corepack rejects — the slice deletes it
  in its second command. Do not skip that.

### 01 — Web shell, deployed

`apps/web` from `create-next-app --src-dir`, the OpenNext Cloudflare adapter, `wrangler.jsonc`,
the standard package contract, and the repo's first real unit test. Also retires
`packages/mock`, which has nothing left to prove once a real package runs the same contract.

- **Needs:** a Cloudflare account; `wrangler login` done. **If that login carries more than
  one account, the account id too** — wrangler refuses to guess in non-interactive mode, and
  which account the Worker lives in is the operator's call, not the plan's. It goes in a
  gitignored `.env.production`, per Slice 0's environment convention, read only by
  `deploy:production` via `--env-file`. Deliberately not `.env.development`: dev and
  production may be different accounts, and wrangler does not read that filename anyway.
- **Gate:** `pnpm dev` and `pnpm preview` both render; root shows `Tests 3 passed`, with
  `typecheck` and `lint` each `2 successful` — the second task is the `codegen` turbo pulls
  in. Production: `pnpm deploy:production` → the `<project>-web.<account>.workers.dev` URL
  renders.
- **Watch:** `create-next-app` scaffolds a standalone repo — its `pnpm-workspace.yaml`,
  `pnpm-lock.yaml` and `packageManager` field must be deleted or `apps/web` becomes the root
  of its own workspace and nothing links.
- **Watch:** this is the first slice to install `eslint-config-next`, and so the first to
  discover whether its transitive plugins tolerate the catalog's ESLint major. As of
  2026-08-31 they do not, and the slice carries a targeted workaround rather than a
  downgrade — see the `eslint.config.mjs` block and slice 01's `Sources and findings`.
- **Watch:** `compatibility_date` is capped by the workerd bundled with the installed
  wrangler, not by today's date. Read it off `npm view wrangler@<version> dependencies`.

### 02 — GraphQL: the Worker and its contract

`apps/graphql` end to end: the Yoga Worker on workerd, generated Workers types, its own
tsconfig variant, the schema split into modules, graphql-codegen's server preset scaffolding
resolver files, the typed client in `apps/web`, the service binding from web to api, the CORS
allowlist, and the environment file convention (Slice 0) applied for the first time: a plain
config value (`APP_ENV`), proven observable and different between local and production, in both
the browser and the Worker.

- **Needs:** nothing new — the Cloudflare account from 01 is enough. No Docker, no Neon.
- **Gate:** the deployed page renders `version` and `health` through the service binding, and
  `production` for the env value — a different value than local, from a mechanism never edited
  between the two runs. Locally `Tests 17` (graphql 10 + web 7), and the same table again in a
  fresh clone.
- **Why it is one slice and not two.** It was two — a hello-world "API shell" and a separate
  "One SDL" — and the split failed its own criterion. A Worker whose entire schema is
  `health: String!` serves nobody, and a contract needs a server to answer it, so neither half
  was a place anyone would sensibly stop. Since the skill builds one slice per invocation and
  stops when it is committed, "stop after the Worker" was an ordinary thing to do, and it left
  a deployed public endpoint that did nothing. Two things pointless apart are one slice.
- **Watch:** `health` returns `"ok"` from the Worker itself. That is provisional by design —
  03 rewrites it to query Postgres, and that rewrite is 03's integration proof. It does not
  weaken this gate: the seam being proven here is web ↔ api, and a value that travelled that
  path proves it whatever produced it.
- **Watch:** codegen runs **once, after all SDL edits** — not after each one. The resolver
  files it seeds are source, not build output, which is why `turbo.json` does not cache them.
  `wrangler.jsonc` stops being doc-owned here, once `vars` land as by-hand fragments — see
  `scripts/docs-check.ignore`.
- **Watch:** `skipLibCheck` in this package's tsconfig is load-bearing, not hygiene.
- **Watch:** `--env-file` belongs on `wrangler dev` and nowhere else. On `cf-typegen` it makes
  a gitignored file mandatory, and since turbo hangs `typecheck` and `lint` off `codegen`, no
  fresh clone can run either. `--strict-vars false` is what that flag was actually buying.
- **Watch:** the fresh-clone run is not optional here. Both failures this slice has hit there
  were invisible to every local check — something green only because the machine had a file the
  repo never promised.

### 03 — Database: Docker locally, Neon in production

`packages/db` (Drizzle schema, migrations, client factory), `docker-compose.yml`, `migrate`
and `migrate:production`, the Hyperdrive binding on 02's Worker, and the repo's first
integration tests.

- **Needs:** Docker running. A Neon project, and its **direct (unpooled)** connection string
  — Hyperdrive is the pooler; stacking it on Neon's pooled endpoint is discouraged.
- **Gate:** migrations run against Docker and against Neon; `Tests 2 passed` on integration;
  and the page from 02 shows `health` as `ok:db` — same page, same field, real data behind it.
- **Watch:** this slice carries both halves a horizontal slice owes, and they are worth telling
  apart. The infrastructure half (`packages/db` and its round-trip test) needs nothing
  downstream. The integration half rewrites 02's `health` resolver to query, which is the only
  place the seam between the two layers can be proven.
- **Watch:** Hyperdrive belongs here rather than in 02 because it is the object that _joins_
  the two — a pooler fronting this database for that Worker. It could not exist before both did.
- **Watch:** the production half needs a Neon project. If the user has none yet, this is the
  slice to pause on.

### 04 — Theming system

Tailwind, the shadcn registry checkout, and `theme.css` — every token value in one file, with
a test that asserts the theme contract. Dark mode included.

- **Needs:** nothing new.
- **Gate:** the default shadcn look, re-themeable from one file; `Tests 22 passed`.
- **Watch:** no component ever names a colour. That rule is what makes the re-theme a
  one-file change, and it is enforced in the `web` skill this slice writes.

### 05 — Email: Resend and React Email

`packages/email` (templates, render helpers, a `log` transport and a `resend` one), the
send mutation in `apps/graphql`, and a recipient allowlist.

- **Needs:** a Resend account and an API key. `MAIL_FROM` starts as Resend's shared
  `onboarding@resend.dev`, which delivers **only to your own Resend account address** — fine
  for proving the pipeline, a dead end for real users.
- **Gate:** local renders without sending; production actually delivers a real email.
- **Watch:** the production gate sends real mail on every pass. `MAIL_TEST_RECIPIENTS` is
  what keeps that from reaching anyone it should not. Check `npm view react-email deprecated`
  and its changelog before installing — v6 merged the component and renderer packages into
  `react-email` and deprecated the rest without changing a single API, so a stale reference
  here fails silently rather than loudly.

### 06 — Authentication with Better Auth, by magic link

Better Auth in `apps/graphql` mounted before Yoga, generated auth tables in `packages/db`,
the same-origin `/api/auth/[...all]` proxy in `apps/web`, the sign-in panel, and a `viewer`
field. Also installs the `code-ui` skill from the plan's `assets/`.

**Magic link is the default and the only method shipped** — no password field, no password
column, no separate confirm-your-address step. The mailed link is the credential and the
proof of address at once. Email + password is a documented variant at the end of the slice,
to be taken deliberately when something concrete requires it.

- **Needs:** 05 working (it is the login path, not a side channel), a `BETTER_AUTH_SECRET`,
  and `BETTER_AUTH_URL` set to the origin the **browser** sees — the web Worker, never the
  API Worker.
- **Gate:** a link requested, read off the log transport, followed, and the resulting session
  visible to both the browser and a server component. Then the same against production, with
  a real inbox.
- **Watch:** three things. `packages/db/src/auth-schema.ts` is generated by `auth generate`
  and never hand-edited — read the SQL before applying it, four tables and their foreign
  keys. `authOptions` is a factory taking the mail sender, so the schema generator and the
  running server carry the same plugin list; a plugin added to `src/auth.ts` alone typechecks
  and queries columns that do not exist. And the client's plugin list must mirror the
  server's — a missing `magicLinkClient()` is a browser TypeError, not a build error.
- **Left open, knowingly:** the sign-in endpoint is unauthenticated and sends mail, and
  Better Auth's rate limiter is per-isolate on Workers. See the slice's `Leaves behind`.

### 07 — Payments: Stripe Checkout and a signed webhook

Embedded Checkout from `apps/graphql`, the form mounted in `apps/web`, the signed webhook at
`/stripe/webhook` (direct to the API Worker, never through the proxy), and a `stripe_event`
table keyed on Stripe's event id for idempotency.

- **Needs:** a Stripe account in test mode, the Stripe CLI (`stripe listen`) for the local
  gate, and a webhook endpoint + secret for the production one.
- **Gate:** a test payment taken, and its event recorded exactly once.
- **Watch:** three separate traps — the SDK needs `Stripe.createFetchHttpClient()` on
  workerd, signature verification must use `constructEventAsync`, and the raw body must be
  read once as text before anything parses it. All three are in the slice's decision table.
  This slice renames `BETTER_AUTH_URL` to `WEB_ORIGIN` across auth and its tests.

### 99 — Security audit

Reads the built repo for the exposure that _setting it up_ creates: scaffolding that outlived
its purpose, defaults nobody chose, secrets on the wrong side of the line, surface that is
public because it was never asked whether it should be. Reports; changes nothing.

- **Needs:** nothing new, and no account. Only slice 00.
- **Gate:** a report whose every finding names what, reachable by whom, why it is there, and
  at least two options — plus `git status` clean, because this slice edits nothing.
- **Watch:** it must read the **code** first and the `Leaves behind` ledgers second. An audit
  that starts from the docs can only rediscover what someone already wrote down, and "found
  nothing" then looks identical to success. Where ledger and code disagree, the code wins.
- **Not a substitute** for a real security review. It knows this stack's setup-era traps and
  nothing about your product or threat model.

## Accounts and tooling, by slice

| Need                                 | First required at |
| ------------------------------------ | ----------------- |
| Node 24+, pnpm, corepack             | 00                |
| Cloudflare account, `wrangler login` | 01                |
| Docker                               | 03                |
| Neon project (direct/unpooled URL)   | 03 (production)   |
| Hyperdrive config (same account)     | 03 (production)   |
| Resend account + API key             | 05 (production)   |
| Stripe test account + Stripe CLI     | 07                |

Ask about these **before** installing the plan. A slice whose account does not exist yet is
a slice that stalls halfway through its production gate, with the local half already
committed.
