# Slice 99 — Security audit: read the code, cross-check the ledger

Not a layer. Nothing is installed, nothing is deployed, and — unless you are told otherwise —
nothing is changed. This slice **reads what was actually built** and reports what the setup
left exposed.

It is also the only slice meant to be run more than once. Every other slice is built, gated
and recorded; this one is re-run after any of them, because what it audits is whatever exists
at the time.

## Scope, and the line this slice does not cross

**This is a setup-era audit, not a security review of your product.** It knows the shape this
skill builds — a Yoga Worker, a Next app, Hyperdrive to Postgres, and whichever of email, auth
and payments were installed — and it looks for the exposure that _setting that up_ creates:
scaffolding that outlived its purpose, defaults nobody chose, secrets in the wrong file,
surface that is public because it was never asked whether it should be.

It does not model your threat landscape, review your business logic, or replace a real
security engagement. A project-wide audit is a bigger job with a different owner. If a finding
here needs that, the finding says so and stops.

## Decisions

| Decision                                                          | Why                                                                                                                                                                        |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The code is the source of truth. The ledger is a cross-check.** | An audit that reads `docs/setup/` first can only rediscover what someone already thought to write down — and a doc is a claim about the past, not evidence about the repo. |
| Report only; fixes are proposed, never applied                    | Every finding is a judgement about risk the owner is entitled to make. Deleting a mutation because it looked like scaffolding is how you break a slice's gate.             |
| `REQUIRES` is `00`, not `07`                                      | It audits what has been built, not a finished stack. Pinning it to the end would make the one slice you most want to repeat the one you can run last.                      |
| Numbered 99, and excluded from `--through`                        | A range is the build chain. Installing an audit of slices that do not exist yet audits nothing.                                                                            |
| Writes no files                                                   | Nothing for `docs:check` to compose, so re-running it cannot drift. The findings go to the person who asked.                                                               |

## Why this slice exists

The skill already retires provisional artifacts: SKILL.md §2 says each slice folds the removal
of whatever it makes redundant into its own plan, and that works — `packages/mock` is created
by Slice 0 to prove the harness and named for removal by the first slice with a real package.

It works because `packages/mock` has a **successor**. The mechanism has no answer for an
artifact that has none. `sendTestEmail` is the worked example: Slice 5's own operating manual
calls it a scaffold and says not to widen it, Slice 6 adds real verification mail without
replacing it, and by Slice 7 it is being described as part of the schema's architecture
(`` `mail/` is sendTestEmail ``). Nothing is wrong in any slice. The removal simply has no
owner, so an unauthenticated mutation that sends real mail ships as a permanent feature.

That is the class of thing this slice catches: **not bugs, but decisions nobody made.**

## Round 1 — read the code

Every command below runs from the repo root and only reads. Run them all before forming any
view, and before opening `docs/setup/` at all — reading the plan first anchors you to its
vocabulary and you will stop seeing what it does not name.

### 1. What is actually reachable from the internet

```bash
# Worker entry points, and what each exports as its fetch handler.
rg -n "export default|fetch\s*[:(]" apps/*/src/index.ts apps/*/src/worker.ts 2>/dev/null

# Next routes that are not pages: anything under app/api is a public HTTP endpoint.
find apps/web/src/app -name "route.ts" -o -name "route.tsx" 2>/dev/null

# Public routes declared to the platform.
rg -n "routes|pattern|custom_domain" apps/*/wrangler.jsonc
```

For each, answer in the report: **who can call it, unauthenticated, from a browser they own?**

### 2. Every GraphQL root field, and what guards it

The generated SDL is the honest list — hand-written modules can lie by omission, and this file
is assembled from all of them:

```bash
rg -n "^\s+\w+\(|^\s+\w+:" apps/graphql/src/schema/schema.generated.graphqls
ls apps/graphql/src/schema/*/resolvers/*/
```

Then read each resolver and record what it checks before acting. A root field whose body
starts doing work without consulting a session, an allowlist, or a signature is an
unauthenticated operation regardless of what the schema calls it. **Mutations that send mail,
write rows, or spend money are the ones to enumerate first.**

### 3. Introspection and the schema explorer

```bash
rg -n "graphiql|introspection|maskedErrors|createYoga" apps/graphql/src/index.ts
```

`createYoga` serves GraphiQL on `GET /graphql` **by default** and does not disable it in
production. Confirm against the deployed Worker rather than the source, because this is
exactly the kind of default that is easier to assert than to check:

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
  -H "accept: text/html" https://<worker>.workers.dev/graphql
```

`200 text/html` means anyone with the URL can read your whole schema and run any field on it.
That may be fine. It should be a decision.

### 4. Secrets, and which side of the line each one is on

```bash
# Anything committed that looks like a live credential.
git grep -nIE "(sk|pk|re|rk)_[A-Za-z0-9_]{12,}|-----BEGIN|password\s*=\s*[\"'][^\"']" -- \
  ':!*.md' ':!pnpm-lock.yaml' ':!*worker-env.d.ts'

# Plaintext in the deployed config: `vars` are visible to anyone who can read the repo
# or the Cloudflare dashboard. Secrets belong in `wrangler secret put`.
rg -n '"vars"' -A 20 apps/*/wrangler.jsonc

# Every env file that is NOT ignored is a committed file.
git ls-files | rg "\.env"
```

`.env.example` is expected. Anything else in that last list is a finding on its own.

`worker-env.d.ts` is excluded because it must be: `wrangler types` generates thousands of
lines of Workers AI model interfaces, dozens of which match this regex on `_`-heavy type
names. Left in, the real hits scroll off the top of the output — which is the failure mode
this command exists to prevent. Every other generated file stays in scope.

### 5. Fail-open configuration

The pattern to look for is a check that treats "unset" as "allow":

```bash
rg -n "\?\?\s*\"\"|\|\|\s*\[\]|process\.env\.\w+\s*\?\?|!== *\"production\"" \
  apps/*/src packages/*/src
```

Read each hit and decide which way it fails. `CORS_ORIGINS` and `MAIL_TEST_RECIPIENTS` in
this stack are written to fail **closed** — an empty list refuses everything. A new one that
fails open is the finding.

### 6. Scaffolding still standing

```bash
rg -n -i "mock|placeholder|scaffold|for now|temporary|TODO|FIXME|not a real|example\.com" \
  --glob '!*.md' --glob '!pnpm-lock.yaml' apps packages
rg -n -i "test|demo|debug" apps/graphql/src/schema/*/schema.graphql
```

Names lie in both directions — something called `sendTestEmail` is scaffolding, and something
called `health` is not — so this list is a prompt to go read, not a list of findings.

### 7. Dependency state

```bash
pnpm audit --prod 2>&1 | tail -30
# Deprecated packages do not show in `audit`. They show at install time — and only on an
# install that actually resolves something. Read what this prints, not just its grep.
pnpm install --frozen-lockfile 2>&1 | tail -5
```

The second command is the one that matters and the one people skip. A package folded into
another still installs, still exports the same names, and still compiles — Slice 5 found
`@react-email/components` that way, five months dead.

**But on a repo whose store is already warm it proves nothing, and looks exactly like a
pass.** `pnpm install --frozen-lockfile` on an up-to-date workspace prints `Already up to
date` and exits 0 without re-resolving anything, so a `| rg -i deprecated` over it is empty
for the same reason on a clean repo and on a rotten one. The pipe hides that; `tail -5` is
what shows you which of the two you got. When it says `Already up to date`, the install
check has not run — ask the registry directly instead:

```bash
# Every external direct dependency across the workspace, asked one at a time.
node -e 'const fs=require("fs"),g=["package.json",...fs.readdirSync("apps").map(d=>`apps/${d}/package.json`),...fs.readdirSync("packages").map(d=>`packages/${d}/package.json`)];const o=new Set();for(const f of g){if(!fs.existsSync(f))continue;const p=JSON.parse(fs.readFileSync(f,"utf8"));for(const k of ["dependencies","devDependencies"])for(const[n,v]of Object.entries(p[k]||{}))if(!String(v).startsWith("workspace:"))o.add(n)}console.log([...o].sort().join("\n"))' \
  | while read -r pkg; do d=$(npm view "$pkg" deprecated 2>/dev/null | head -1); \
      [ -n "$d" ] && echo "$pkg :: $d"; done
```

Transitive deprecations are out of this net, deliberately: they are not yours to fix and
`pnpm audit` already covers the ones with a CVE.

## Round 2 — now open the ledger, and compare

Only now read the `Leaves behind` block at the end of each `docs/setup/NN-*.md`. Every slice
that was built declares two lists: artifacts it left in place that are provisional, and risks
it accepted deliberately.

Sort what you found in Round 1 into four buckets. **The third is the reason this slice is
worth running.**

| Bucket                              | What it means                                                       | What to propose                                                          |
| ----------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Declared provisional, still present | Its retirement condition may now be met                             | Name the condition and whether it is met; propose removal only if it is  |
| Declared accepted, still present    | Someone decided this — but perhaps before the slice that changed it | Re-state the original reasoning and what has changed since               |
| **In the code, declared nowhere**   | **A decision nobody made**                                          | **The finding. Say what it exposes and offer the options**               |
| Declared, but absent from the code  | The doc is stale, or the artifact was removed and nothing said so   | Correct the doc — this is `docs:check`'s blind spot, since prose is free |

A ledger entry is a claim about the repo, and Round 1 already established what the repo says.
Where they disagree, **the code wins and the doc is the finding.**

## Round 3 — the report

Report only. Do not edit, delete, gate or redeploy anything on the strength of your own
findings, however obvious the fix looks.

For each finding, four lines and no more:

1. **What** — the artifact or default, with `file:line`.
2. **Reachable by whom** — unauthenticated internet, authenticated user, only the owner.
3. **Why it is here** — which slice created it and what for. A finding without this reads as
   an accusation and gets dismissed.
4. **Options** — at least two, with the trade-off named. "Remove it" is rarely the only one,
   and for something a gate depends on it is often the wrong one.

Order by reachability, not by how interesting the finding is. Then stop and let the owner
choose. If they pick fixes, those are ordinary work — with the ordinary requirement that the
gates of every slice already built still pass afterwards.

## Gate

There is nothing to deploy and nothing to assert, so the gate is the report itself:

| Where | Check                                              | Expect                                                                  |
| ----- | -------------------------------------------------- | ----------------------------------------------------------------------- |
| root  | every command in Round 1 was run                   | output read, not skimmed for the ones you expected                      |
| root  | every built slice's `Leaves behind` block was read | one bucket assigned per entry                                           |
| root  | `git status --short`                               | **clean** — this slice changes nothing                                  |
| root  | the report                                         | every finding has all four lines, ordered by reachability               |
| root  | `pnpm docs:check`                                  | no drift, unless a stale-doc finding is being corrected in the same run |

A run that finds nothing is a legitimate result and is reported as one. A run that finds
nothing **because the ledger said so** is not — that is the failure mode this slice was
written to avoid, and it looks exactly like success.

## Probing production without changing it

Round 1 reads files; several of its claims are only settled by the deployed thing. The line
that keeps that safe is not "do not touch production" — it is **probe the deny path, never
the allow path.** A request that is supposed to be refused costs nothing when it is refused,
and is the only way to confirm a fail-closed claim actually fails closed:

```bash
# Confirms the allowlist, sends nothing.
-d '{"query":"mutation{sendTestEmail(to:\"nobody@example.invalid\")}"}'
# Confirms signature verification, writes no row.
curl -X POST -d '{}' "$API/stripe/webhook"          # expect 400
# Confirms CORS names one origin rather than reflecting the caller.
curl -H 'origin: https://evil.example' ...          # expect the allowlisted origin back
```

The allow path is off limits for a different reason than secrecy: creating a Checkout
Session, or posting a real address to a magic-link endpoint, writes state at Stripe or in the
production database and mails a stranger. A test-mode key makes it free, not invisible. Where
the deny path cannot settle a question, report the question as unverified and name the probe
the owner can run — do not run the allow path to close a row.

Two orderings worth knowing, both established this way:

- Better Auth validates the **body before the origin**: a request from an untrusted origin
  with a malformed body comes back `400 VALIDATION_ERROR`, not `403`. So a 400 here proves
  nothing about `trustedOrigins`, and "trustedOrigins is the control" is a claim to check
  rather than inherit.
- A Yoga Worker that answers `200 text/html` to `GET /graphql` is serving GraphiQL. Assert
  it from the deployed URL and not from `createYoga`'s options — the finding is precisely
  that the option is absent.

## Sources and findings

The audit installs nothing, so it has no pins to verify. What it depends on is the behaviour
of the tools it reads with, and the defaults of the stack it reads.

- pnpm CLI — `install --frozen-lockfile` on an up-to-date workspace, and what `audit --prod`
  covers: <https://pnpm.io/cli/install>, <https://pnpm.io/cli/audit>
- GraphQL Yoga — `graphiql` and `maskedErrors` defaults: <https://the-guild.dev/graphql/yoga-server/docs>
- Better Auth — `trustedOrigins`, magic-link `rateLimit` storage: <https://www.better-auth.com/docs>

### 2026-09-01 — first execution (nanoapp, slices 00–07 built)

- **`pnpm install --frozen-lockfile | rg deprecated` is vacuous on a warm store.** It printed
  nothing, and `tail -5` showed why: `Already up to date`, 199ms, nothing re-resolved. The
  registry loop above replaced it and found no deprecated direct dependency. This is the
  single most likely way this slice reports a clean bill it did not earn.
- **A dependency literally named `auth` is not a typosquat here.** `apps/graphql` devDepends
  on `auth@catalog:` and it reads as one. `npm view auth repository.url` resolves to
  `github.com/better-auth/better-auth`, directory `packages/cli` — it is Better Auth's own
  CLI, published under the bare name, with `better-auth` and `auth` as its two bins. Check
  the repository URL before writing the finding; a generic name is a prompt to verify, not
  evidence.
- **The credential regex drowns in `worker-env.d.ts`.** 20+ consecutive hits on generated
  Workers AI interface names, above the real ones. Excluded in the command now.
- **Both fail-open greps came back clean and the four `??` hits all fail closed** — two test
  files defaulting `DATABASE_URL` to the Docker URL, plus `cors.ts` and `mail.ts`, which
  return `false` and `[]`-refuses-everything respectively. The pattern the grep hunts is
  absent, which is a result worth stating rather than skipping.
- **`pnpm audit --prod` reported one moderate**, transitive and dev-only: esbuild ≤0.24.2
  under `better-auth > drizzle-kit > @esbuild-kit/*`. Not in the deployed bundle. Worth one
  line in the report and no more.
- **The ledger's own header was the first stale-doc finding.** Every slice's `Leaves behind`
  block opened "Read by Slice 8", a slice that does not exist — the audit is 99. Corrected in
  every slice file here; a project that installed the old text carries it in `docs/setup/`
  and needs the same edit.
