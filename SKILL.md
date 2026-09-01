---
name: setup-project
description: Scaffold a full-stack web app one infrastructure slice at a time — pnpm workspace, Next.js on Cloudflare Workers via OpenNext, a GraphQL Yoga Worker, Drizzle + Postgres (Docker locally, Neon via Hyperdrive), a theming system, optional email, authentication and Stripe payments, and a re-runnable audit of what the setup left exposed. Use when starting a new project, adding one of those layers to a project already built this way, or when the user asks to set up the workspace, the API, the database, auth, email or payments. Invoke as /setup-project [slice] — it researches what is currently true, writes that slice's execution plan into the project, proves it locally then in production — correcting both the plan and this skill after each — and ends by handing you the short list of checks only a person can make.
---

# Set up a project, slice by slice

One slice per invocation, through a fixed loop:

**reference → research → wire → plan → execute → local gate → reconcile → production gate
→ reconcile → hand the user the manual steps → commit**

The `slices/` files are a **reference, not a script.** They encode a stack that was verified
as a set, and — more valuably — the traps that cost real time: the `devEngines` block
`pnpm init` writes that corepack then rejects, the second pnpm workspace `create-next-app`
opens inside `apps/web`. That reasoning keeps. The version pins, CLI flags and API shapes
around it do not. A slice run straight from the reference will fail on something that moved.

So the plan you execute is never the reference itself. It is a fresh plan, written into the
project for this project, from the reference **plus** what research says is true now. And
because that plan is written before it is proven, the loop does not end at a green gate — it
ends when the plan has been corrected to match what actually worked, in both places it lives,
and the user has been handed the short list of checks only a person can make.

The stack is fixed: pnpm workspace · Next.js on Cloudflare Workers via OpenNext · GraphQL
Yoga Worker · Drizzle + Postgres, Docker locally and Neon through Hyperdrive in production ·
Tailwind + shadcn · optionally Resend, Better Auth and Stripe. If the user wants a different
stack, say so plainly — this skill does not have one.

## 0. Dispatch

`/setup-project [slice]` builds **one slice**. The argument is optional and names a slice by
number or name — `01`, `web shell`, `database`, `auth`. Resolve it against
`reference/slices.md`; if it matches nothing, say so and list the names rather than guessing.

```bash
ls docs/setup/ 2>/dev/null    # which slices this project has actually built
git status --short            # a dirty tree means the last slice may be unfinished
```

**`docs/setup/` is the record of what was built, not a forecast of what might be.** A slice
file is there because that slice was built and went green. So the highest-numbered file is
the answer to "where are we", and there is no separate marker to keep in sync.

**No slice named — always show the catalog before recommending.** List every slice from
`reference/slices.md` with its number, name, and whether `docs/setup/` shows it built, then
recommend one and get **confirmation** before running it. This applies on the very first run
too: settle the project name (§1) first, then show the catalog (everything unbuilt, slice 00
next) and confirm before building it. Never skip the catalog or the confirmation because the
next step seems obvious.

| State            | What to do                                                                  |
| ---------------- | --------------------------------------------------------------------------- |
| No `docs/setup/` | First run: settle the project name (§1), show the catalog, confirm slice 00 |
| Slice named      | Build it                                                                    |
| No slice named   | Show the catalog, recommend the highest built + 1, and confirm              |

**Slice 99 is outside that arithmetic.** It is the security audit: it builds nothing, needs
only slice 00, and is re-run against whatever exists rather than occupying a rung of the chain.
So `99-security-audit.md` sitting in `docs/setup/` does **not** mean the chain is finished, and
"highest built + 1" must ignore it — a repo holding `00`–`05` plus `99` is a repo whose next
build is `06`. It is also excluded from `--through` ranges, because a range is the build chain
and installing an audit of slices that do not exist audits nothing. Recommend it after any
slice that adds public surface, and name it explicitly: `/setup-project 99`.

Never build two slices in one invocation. Stop when the slice is committed.

**A slice that skips ahead.** If the argument is more than one past what is built, name the
slices it jumps and what they build, then let the user decide. The chain is real: 04 needs
both 02 and 03, and 05–07 patch files earlier slices wrote, so a missing prerequisite is a
hard `docs:check` error rather than a warning. `reference/slices.md` §Dependencies has the
reasoning.

## 1. First run only: the project name

Lowercase letters, digits and hyphens — it becomes the npm scope (`@name/db`) and the Worker
prefix (`name-web`, `name-graphql`). Default to the repo directory name if it already fits.
Ask once; every later slice reads it back from `package.json`.

## 2. Read the reference slice

Read `slices/NN-*.md` **in full** before anything else, and `reference/slices.md` for what
this slice's gate proves and which account it needs. The prose between the code blocks is the
part that keeps its value — read it for the reasoning, and treat every version number, flag
and file path in it as a claim to check rather than a fact.

If the slice needs an account the user does not have (Cloudflare, Neon, Resend, Stripe), say
so **now**. A missing account does not block writing the plan, but it strands the slice
halfway through its production gate with the local half already committed.

**Look backward, not forward.** Read what the project already has — `docs/setup/`,
`CLAUDE.md`, the skill files earlier slices wrote — and follow the conventions they set so
this slice fits in rather than reinventing them. The reverse never happens: no slice assumes a
later one, named or not, will ever be built — whether it is is the user's call at dispatch
(§0), not something the reference gets to bank on. If an established convention now looks
wrong for what this slice needs, say so and let the user decide rather than silently
overriding it or silently complying with it.

**Retire the provisional artifacts this slice supersedes.** Some things are built only to
prove a mechanism before the real thing exists — `packages/mock` is the first and clearest
case: Slice 0 creates it to prove the harness when there is no real package to run through it.
A provisional artifact never names its successor, because which slice supersedes it is decided
at dispatch (§0), not by the reference. The obligation runs the other way: **each slice looks
at what is already there and folds the removal of whatever it now makes redundant into its own
plan**, along with any `CLAUDE.md` line that described it.

So if `packages/mock` still exists, this slice is the first real thing the workspace gets, and
retiring it is part of this slice's work. The same rule covers anything later slices leave
behind — a static resolver a real one replaces, a placeholder value that becomes a binding.

**That mechanism only works for artifacts with a successor, so declare the ones without.**
`packages/mock` is retired because a real package obviously replaces it. Nothing obviously
replaces `sendTestEmail`: Slice 6 adds real verification mail _alongside_ it, Slice 7 describes
it as part of the schema, and an unauthenticated mutation that sends real mail ships as a
permanent feature. No slice is wrong — the removal has no owner. Waiting for a later slice to
notice is not a mechanism; it is a hope.

So every slice ends with a **`Leaves behind`** block naming two lists, written when the
artifact is created rather than when someone spots it:

- **Provisional** — what it is, why it exists, and the condition that retires it. If no later
  slice would plausibly meet that condition, **say so in the row**. An honest "nothing retires
  this" is the entry that does the work.
- **Accepted** — a risk taken knowingly, who can reach it, and the reasoning. Written down so
  a later slice can re-decide it instead of rediscovering it, and so an inherited default
  (Yoga serving GraphiQL in production) is distinguishable from a chosen one.

Slice 99 reads these as a cross-check — never as its input, because a ledger can only contain
what someone already thought to write down. It reads the code first.

## 3. Research what is currently true

This is the step that makes the reference safe to use, so do it deliberately and cheaply.
For every tool this slice installs or configures, check reality rather than the reference:

```bash
npm view <pkg> version          # what the pins should actually be
npx <cli> --help                # flags, and which prompts are non-interactive
```

Then read the **official documentation** for anything the slice depends on structurally —
the framework's current adapter guidance, the runtime's compatibility flags, a library's
current API shape. Prefer the vendor's own docs over the reference's summary of them, and
note where they disagree.

**Read what the install prints, not just its exit code.** A package that was folded into
another, renamed, or abandoned still installs, still exports the same names, and still
compiles — `npm view <pkg> version` reports a healthy version for it, and the reference's code
blocks go green against it. The single line of `[WARN] deprecated …` in `pnpm add`'s output is
the only place that shows. Slice 5 is where this bit: `@react-email/components` had been
merged into `react-email` five months earlier and nothing else said so.

```bash
npm view <pkg> deprecated    # non-empty means the reference is describing a dead package
```

Write down what you found and where. Contradictions between the reference and current docs
are the whole output of this step, and they go into the plan you are about to write.

## 3b. Wire into what is already built

A slice that lands unconnected is a slice nobody can tell is working. Before writing the plan,
look at what `docs/setup/` says exists and ask which of those layers this slice now has a seam
with — then **offer** to prove that seam in this slice rather than leaving it for a later one
that may never be built.

Four rules keep this from turning into scope creep:

- **Backward only.** Wire into slices already built. Never speculate about ones that may never
  exist — that is the same rule as `adapting.md`'s "a slice may cite any slice before it,
  never one after it".
- **A probe, not a feature.** The bar is _one thing that would fail if the seam were broken_.
  If it needs product decisions, it is a slice of its own, not a probe.
- **It is an offer.** Wiring widens the slice, so it goes into the §4 review with everything
  else and needs the user's agreement.
- **It gets a gate row,** or it proves nothing.

A probe is a provisional artifact, and §2's rule already covers its removal: it says nothing
about what will replace it, and whichever slice supersedes it retires it.

## 4. Write the execution plan into the project

```bash
node .claude/skills/setup-project/scripts/install-plan.mjs \
  --repo <repo dir> --name <project> --slices NN
```

That renders `slices/NN-*.md` into `docs/setup/` with `__PROJECT__` and `__DOCS__` resolved,
and writes nothing else — no index, no source list. `docs/setup/` holds slice files only, one
per slice built, and `ls` is the index. Nothing is installed, built or committed.

A slice file already there is left alone unless you pass `--force`, because by then it is this
project's execution record rather than a copy of the reference.

**Then edit what it wrote**, before running any of it — this is the plan, not a copy of the
reference. Fold in the research from §3: correct the pins, fix flags that moved, adjust steps
whose API changed, and drop or rewrite anything the current docs contradict. Say _why_ in the
prose, the way the rest of the file does.

Show the user what you changed relative to the reference and why, and get agreement before
executing. The plan is unproven at this point and worth a minute of their attention.

## 5. Execute

Run the plan's blocks **in order**. `cd` lines are written from wherever the previous block
left you, so do not reorder blocks or run one in isolation.

Expect failures. This plan has never been run. A failure here is the loop working, not the
loop breaking — it is exactly the information §7 exists to capture. Fix the cause, note what
it was, and keep going.

## 6. Gates — three rounds, in this order

A slice is proven in three passes, and they are not variations on one thing. Two are yours to
run and to act on; the third is a handoff. Each of the first two ends by correcting the plan
and this skill (§7) — **before** the next begins, while what broke is still in front of you.
Reconciling once at the end instead loses the local lessons behind the production ones.

### Round 1 — automated, local

Run the slice's Round 1 table exactly as written, from the `Where` column it names —
`typecheck` and the test scripts from the **repo root**, dev servers and `preview` from the
**package**. That split is not bookkeeping: the root fans scripts out through turbo, so it
answers "is the workspace green", which is the only question a gate asks. Run the same script
inside a package and you get that package's tally, which stays green while another package
burns. Every package sits two levels down, so `cd ../..` returns from any of them — and the
slice body usually leaves you in the wrong place, which is why each row names where it runs.

Run the rows _in the order given_: some rows generate what a later row needs. Read the test
count, not the exit code — `passWithNoTests` makes an empty run green, so `Tests N passed`
with the N the gate names is the only evidence. Read what commands **print**, not just what
they return: a deprecation notice is the whole finding in §3's worst case.

Fix what fails, then **reconcile now (§7)** — the project's slice doc and this skill's, both.

**Slices whose gate is still one combined table.** Only some slices have been through this
three-round shape; the rest carry a single table mixing both kinds of row. Do not guess at a
split for a slice you have not run — read it as written and sort by what a row needs: a row
whose `Check` is a command you can run and whose `Expect` is text you can read is Round 1;
a row needing a rendered page, an inbox, a real card, or a `browser` pass is Round 2 or 3.
Splitting that slice's table into rounds is part of reconciling it (§7) the next time it is
actually built — which is the only time you will know which rows really needed a person.

### Round 2 — automated, production

Deploy and verify against the real thing. API before web, always — the web Worker's service
binding is resolved at upload time, so the API Worker must already exist. Every deploy is one
the user has agreed to; some cost money or send real email, so say which before running them.

**`browser` rows.** Drive them yourself with the Chrome browser tool when it is available —
navigate, click, read the rendered page, console and network — rather than describing what
should happen or asking the user to check it manually. Reserve asking the user for what
actually requires a human: completing an OAuth consent screen, or creating or configuring an
account (Cloudflare, Neon, Resend, Stripe) with credentials only the user holds.

**Credentials: the line is live-versus-test, not agent-versus-human.** A `sk_test_` key cannot
charge anyone, and by this point in the slice it is already sitting in plaintext in
`.env.development` — refusing to pipe that same value into `wrangler secret put`, which stores
it _encrypted_ at Cloudflare, protects nothing and just stalls the gate. So:

- **Test-mode credentials the user already holds on this machine may be moved by you**, on two
  conditions: the value goes down a **pipe** and is never rendered to the terminal, and the
  pipeline **asserts the mode itself** rather than trusting whoever wrote it. A one-line guard
  that exits non-zero on anything without `_test_` turns "I will not touch a live key" from a
  promise into a property of the command.
- **Live-mode credentials are never yours to handle**, whatever the instruction. The blast
  radius is real money, and no amount of authorisation shrinks it.
- **Never echo a secret**, even a test one — not into a log, a heredoc, or a message. `head -c 8`
  on a prefix is the most that should ever reach a screen.
- Stripe's **test card numbers are documented public constants**, not payment details. `4242
4242 4242 4242` belongs to nobody and moves no money; it is the `example.com` of cards. Type
  it where the tooling lets you.

**What the tooling will not let you do, as of 2026-09-01:** drive Stripe's embedded Checkout
form. Its fields live in a cross-origin `js.stripe.com` iframe, so they never appear in the
accessibility tree — and in the Chrome extension only `ref`-based clicks reliably focus an
input; coordinate clicks do not, in either screenshot or CSS space. Verify that claim on a
same-origin input of your own before blaming a page, because the symptom is identical. The
consequence for this slice: **the card rows are handed to the user** — not on policy grounds,
but because the agent physically cannot fill that form. Everything else about the payment
pipeline is provable without a card; see slice 07's production gate.

Some evidence is not reachable from here at all: whether mail actually landed, what a card
statement says. State plainly that the row is unverified and name who can verify it, rather
than reporting the call's success as the row's success.

Fix what fails, then **reconcile again (§7)**.

### Round 3 — manual, handed to the user

The rounds above prove the machinery. They cannot prove what only a person can see: a
rendered template, a real inbox, a page that looks right. Close the slice by giving the user
**concise numbered steps** — local first, then production — and nothing else in that message:
no rationale, no restated architecture. One line per step, each naming what to expect.

**Every step should be a click, not a transcription.** A manual step that makes the reader
hand-write a query, a URL or an address is one that gets skipped or mistyped — and mistyping
the input is how a manual check passes while testing nothing. Give a literal link with the
values already substituted wherever the tool allows it:

- GraphQL — Yoga serves GraphiQL on `GET /graphql` and reads `?query=` into its editor, so an
  `encodeURIComponent`'d query arrives pre-filled and **unrun**. (A browser's `Accept` header
  is what selects GraphiQL over the JSON endpoint; the same URL under `curl` returns `405`.)
- Web pages — link the exact route, not the origin.
- Anything needing a running server — say which command starts it and on which port, once, at
  the top.

Mark the steps that cost money or send real mail. Mark which environment each belongs to.

**Do not build UI whose only purpose is to make a manual step clickable.** A pre-filled link
into a tool that already ships costs nothing and disappears when the slice does; a test button
in the web app is production surface, usually unauthenticated at this stage, and becomes a
provisional artifact a later slice has to retire.

### Throughout

Do not start the next slice while a gate is red. If a gate cannot pass because an account is
missing, or any other step turns out to be something you cannot do yourself, stop and say
so — never continue past a red gate, and never guess past a blocker, to "come back to it". A
round you could not finish is reported as unfinished, with the reason.

**Anything acting on production is suffixed `:production`.** A bare script name never touches
production.

## 7. Reconcile — the step that makes this work

Run this at the end of Round 1 and again at the end of Round 2, not once at the finish.

A green gate means the repo is right. It does not mean the plan is. Correct both:

1. **The project's `docs/setup/NN-*.md`** — what actually ran here. Fix every block that had
   to change, and write down the failures worth remembering.
2. **This skill's `slices/NN-*.md`** — what should carry forward. Only the general lesson: a
   moved flag, a changed API, a trap that will hit the next project too. Project-specific
   choices stay in the project. The test is whether the sentence would still be true in a
   repo with a different name, owner and account.

**Update the slice's `Sources and findings` section — this is part of reconciling, not an
optional extra.** Every slice ends with one: the docs its §3 research rests on, then one dated
entry per execution. Add an entry for this run, naming the versions you actually resolved, the
docs you read, and what you had to reproduce rather than assume. If §3 read a page no source
list names, add it.

There is no shared bibliography, deliberately. One file held all of it until it turned out to
be the worst of both worlds: most findings were duplicated into the slice that needed them and
could rot in two places, while some lived only there, in a file no step told you to open. A
slice's evidence belongs in the slice, which also means a project that built two slices
receives the research for two, not for seven it has not built.

**Correct the reasoning, not just the command.** A block that now works but whose prose
explains it wrongly is worse than one that fails, because it will be trusted. If you asserted
something the round then disproved — a directory that gets created, a package that is
current — rewrite the claim to what you actually observed, and say how you observed it.

**Never sync a doc from disk automatically.** `docs:check` compares the plan against the repo
to catch them disagreeing; a plan regenerated from the repo agrees by definition and detects
nothing. Amend by judgement, block by block, because the repo is right about _this_ — not by
copying whatever is there. When `docs:check` reports drift, decide which side is wrong. It is
often the doc, and prettier owns formatting either way.

## 8. Commit

One commit per green slice, carrying the code, its plan, and any skill correction together —
the record and the thing it records should never land apart.

## Files

- `reference/slices.md` — the catalog: per-slice detail, dependency reasoning, the accounts
  table. Read it before building any slice.
- `reference/adapting.md` — how these files were made project-agnostic, and what to change
  when a pin goes stale or a slice needs a variant.
- `scripts/install-plan.mjs` — renders slices into `<repo>/docs/setup/`. `--list` prints the
  catalog; `--force` overwrites a slice file already there.
- `slices/99-security-audit.md` — the audit: reads the code for setup-era exposure and reports.
  Re-runnable, builds nothing, and the only slice that is not a rung of the chain — numbered
  99 rather than 08 so that "not the next rung" is visible in the filename.
- Sources and findings live **in each slice**, not in a shared file — see §7.
- `slices/` — the eight build slices `00`–`07`, plus the `99` audit. The project name is the
  literal token `__PROJECT__`, and the plan's own directory is `__DOCS__`.
- `assets/code-ui-SKILL.md` — the UI-writing skill slice 06 installs.

## What this skill does not do

- It does not design a schema or a product. It builds the plumbing those sit on.
- It does not choose the stack. The slices are one verified stack, not a menu of them.
- It does not deploy on its own initiative.
- It does not trust its own pins. That is what §3 is for.
- **It does not do security beyond its own footprint.** Slice 99 audits what this skill built —
  the scaffolding, defaults and surface that setting up this stack creates. It does not model
  your threat landscape or review your product's logic, and it fixes nothing on its own
  judgement. A project-wide security practice is a bigger job with a different owner.
