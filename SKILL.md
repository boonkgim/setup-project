---
name: setup-project
description: Scaffold a full-stack web app one infrastructure slice at a time — pnpm workspace, Next.js on Cloudflare Workers via OpenNext, a GraphQL Yoga Worker, Drizzle + Postgres (Docker locally, Neon via Hyperdrive), a theming system, optional email, authentication and Stripe payments, and a re-runnable audit of what the setup left exposed. Use when starting a new project, adding one of those layers to a project already built this way, or when the user asks to set up the workspace, the API, the database, auth, email or payments. Invoke as /setup-project [slice] — it researches what is currently true, writes that slice's execution plan into the project, proves it locally then in production — correcting both the plan and this skill after each — and ends by handing you the short list of checks only a person can make.
license: MIT
---

# Set up a project, slice by slice

One slice per invocation, through a fixed loop:

**reference → preflight → research → wire → plan → execute → local gate → reconcile →
production gate → reconcile → hand the user the manual steps → commit**

The `slices/` directories are a **reference, not a script.** They encode a stack that was verified
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

Read `slices/NN-*/REFERENCE.md` **in full** before anything else, and `reference/slices.md`
for what this slice's gate proves and which account it needs. The REFERENCE is the procedure
and is written to be read on its own; its sibling `changelog/` is history you do **not** need
up front — open a dated entry only when you hit something the REFERENCE does not explain, or
want to know whether a trap you just met has been seen before. The prose between the code blocks is the
part that keeps its value — read it for the reasoning, and treat every version number, flag
and file path in it as a claim to check rather than a fact.

A slice whose account or tooling is missing strands halfway through its production gate with
the local half already committed, so establish that **now** — by running §2b's probes, not by
asking. Report what you found; raise only what the probes could not settle.

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

## 2b. Preflight: settle what you can settle

**A fact a command on this machine can obtain is never a question.** §3 checks what is true in
the world — pins, flags, vendor docs. This step checks what is true *here*, and it exists
because the two failures look nothing alike: an unverified pin fails loudly at install, while
an unasked-for question just wastes the user's attention on something the terminal already
knew.

**The probes themselves live in the slice, not in this file.** Each slice's `REFERENCE.md`
opens with a `## Preflight` block naming the few it needs, and its `USER-SETUP.md` carries the
fix for each. A master table of every tool the stack has ever wanted would be the shared
bibliography §7 already threw out — mostly duplicated into the slice that needed it, the rest
stranded in a file no step tells you to open. Run **this slice's** probes; a project stopping
at 02 should never be told how to install the Stripe CLI.

Two rules govern the probes wherever they are written:

- **Probe for presence, never print content.** `stripe config --list` writes `pk_live_…` and
  account ids straight to the terminal, and a probe is not exempt from §6's "never echo a
  secret" just because it runs earlier. Pipe it to `grep -q` and read the exit code.
- **A probe that fails is information, not a blocker.** `wrangler whoami` exits non-zero when
  logged out; that is the answer, not an error to retry.

**What survives the probes is the question — and there is at most one, bundling the residue.**
Probes settle facts; they cannot settle decisions. *Which* of several Cloudflare accounts the
Worker belongs in is the operator's call. So is spending money, sending real mail, and creating
an account that does not exist. Ask about those, once, and never about anything a probe
answered — and when the answer is "create it", ask it as the offer below rather than as a
question that hands the whole errand back.

### When a probe comes back missing

Do not report the gap and stop — a missing tool has a known fix, so give it. Hand the user the
steps from **this slice's `USER-SETUP.md`**, for the probes that actually failed and nothing
else: one line per step, the exact command, no rationale. Interactive steps — a browser login,
a `sudo` — are the user's to run, so tell them to prefix the command with `!` and the output
lands in this conversation.

Say **which round each one unblocks**, because that decides whether the slice waits. A missing
runtime blocks everything; Docker blocks Round 1 for the slice that needs it; an account that
does not exist usually blocks only Round 2, and the local half can still be built, gated and
committed with Round 2 reported as deferred.

### Offer to drive the browser steps

Some of what `USER-SETUP.md` asks for is a browser errand rather than a decision: click through
a signup, name a project, leave a toggle off, open the connection panel. Handing that to the
user as a numbered list is the right fallback, but it is not the only thing on offer when the
Chrome tools are available — they drive the user's **own** logged-in Chrome, so an account made
through them is made in their session, with their cookies, exactly as if they had clicked it.

**Check, then offer, then wait for a yes.** Availability is a fact — the `mcp__claude-in-chrome__*`
tools are present, or they are not, and if they are deferred, loading them is one `ToolSearch`
call. Do not offer what you cannot do, and do not ask the user whether you have a tool. But do
not skip the offer either, because "creating an account is the user's job" is a claim about
_authority_, not about clicking, and only the authority part is true. So make it a single offer
alongside the written steps, naming what you would do and where you would stop, and act only on
an explicit yes. Signing up for a service is outward-facing and creates a real relationship in
the user's name; it is theirs to authorise, once, before you start.

**Drive up to the handover points and stop.** Four things are never yours to type, however
convenient it would be, and each one ends your turn rather than pausing it:

- the user's own credentials — an email address, a password, a passkey prompt;
- a code that proves they hold something — an emailed link, an OTP, a 2FA app;
- an OAuth or permissions consent screen, which is the moment the grant is actually made;
- anything that attaches a payment method or leaves a free tier.

At each, say what is on screen and precisely what you need typed, then hand the keyboard back.
Resume when they say it is done — do not poll the page in a loop waiting for a human.

**A value read off a page is still a secret.** §6's rule does not relax because the credential
arrived through a screenshot instead of a pipe: a connection string or an API key goes from the
browser into the gitignored env file the slice names, and never into a message, a heredoc you
echo, or a screenshot you keep. If you cannot move it without rendering it, that step is the
user's — say so and let them paste it.

**Declined, unavailable, or stuck is not a blocker.** Fall back to the written steps from
`USER-SETUP.md` exactly as above. The browser offer replaces nothing; it is a faster path
through the same list, and the same "stop and ask after 2–3 failed attempts" rule that governs
every other browser task governs this one.

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
node <skill dir>/scripts/install-plan.mjs \
  --repo <repo dir> --name <project> --slices NN
```

`<skill dir>` is wherever this skill is installed: `~/.claude/skills/setup-project`,
`~/.agents/skills/setup-project`, or a project's own `.claude/skills/setup-project`. The
script resolves its slices relative to itself, so it runs correctly from any of them.

That renders `slices/NN-*/REFERENCE.md` into `docs/setup/NN-*.md` with `__PROJECT__` and
`__DOCS__` resolved,
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
actually requires a human — and that is narrower than it looks. Completing an OAuth consent
screen is theirs, as is typing a credential or a 2FA code. *Creating* an account (Cloudflare,
Neon, Resend, Stripe) is theirs to **authorise**, but once authorised the clicking is yours:
§2b's browser offer is the mechanism, and its handover points are the same four listed there.

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

A green gate means the repo is right. It does not mean the plan is. There are **three**
records, and they answer three different questions — keeping them apart is what stops the
skill from silently becoming a diary of the last project it built:

1. **The project's `docs/setup/NN-*.md` — "what ran here."** Fix every block that had to
   change, and write down the failures worth remembering. This is the only one of the three
   that may name this repo, its accounts, its URLs, its test counts.
2. **This skill's `slices/NN-*/REFERENCE.md` — "what to do."** Correct it _in place_ and leave
   it clean: the procedure as it should now be read, with no trace of what it used to say. Only
   the general lesson belongs here — a moved flag, a changed API, a trap that will hit the next
   project too.
3. **This skill's `slices/NN-*/changelog/<today>.md` — "why it now says that."** A **new file**
   named for the date, never an edit to an existing one, so history can only accumulate and a
   bad reconcile cannot corrupt what is already recorded. Same day, second change: append to
   that day's file.

   **Mechanically append — never `cat >` a changelog path.** `ls` the slice's `changelog/`
   first, then write with `>>` or an editor. A truncating write on a path that already holds
   today's entry succeeds silently, prints nothing, and looks exactly like creating one. This
   happened on 2026-09-06 to slice 3's entry; the rule was already here as intent, and it is
   restated as a command because intent is not what fails.

   If it happens anyway, recover before reconstructing: this skill is **its own git repo**,
   nested inside a parent directory that is not one, so `git show HEAD:<path>` restores the
   file. Ask `git -C <the file's own directory> rev-parse --show-toplevel` rather than running
   `git` wherever you happen to be standing — a "not a git repository" answer from one
   directory too high reads exactly like no version control at all, and turns a recoverable
   mistake into an invented one.

**The test for 2 and 3 is the same: would this sentence still be true in a repo with a
different name, owner and account?** If not, it belongs in 1. Concretely — `eslint 10.9.1 →
10.10.0, nothing peers against it` is a changelog entry; `the gate went green first try` and
`no drift across 9 files and 16 scripts` are not, because the counts are that repo's.

**Writing the changelog entry is part of reconciling, not an optional extra.** Record the
versions you actually resolved, the docs you read, what you had to reproduce rather than
assume, and every correction you just made to the REFERENCE — naming what it said before, since
that is the one place that record is allowed to exist. Do not put a date heading inside the
file; the filename is the date and the directory is the slice.

**`## Sources` stays in the REFERENCE.** It is the list of docs the slice's §3 research rests
on — current state, not history. If §3 read a page no source list names, add it there.

There is no shared bibliography, deliberately. One file held all of it until it turned out to
be the worst of both worlds: most findings were duplicated into the slice that needed them and
could rot in two places, while some lived only there, in a file no step told you to open. A
slice's evidence belongs in the slice, which also means a project that built two slices
receives the research for two, not for seven it has not built.

**Correct the reasoning, not just the command.** A block that now works but whose prose
explains it wrongly is worse than one that fails, because it will be trusted. If you asserted
something the round then disproved — a directory that gets created, a package that is
current — rewrite the claim to what you actually observed, and say how you observed it.

A fourth record exists for the rarer case: a change to the **method** rather than to a slice —
the loop, the rules, what a slice directory holds — goes in the top-level `changelog/<today>.md`,
because no single slice owns it and copying it into eight would rot in eight places. The test for
reaching for it is whether the sentence would still be true of a slice that does not exist yet.

**Never sync a doc from disk automatically.** `docs:check` compares the plan against the repo
to catch them disagreeing; a plan regenerated from the repo agrees by definition and detects
nothing. Amend by judgement, block by block, because the repo is right about _this_ — not by
copying whatever is there. When `docs:check` reports drift, decide which side is wrong. It is
often the doc, and prettier owns formatting either way.

## 8. Commit

One commit per green slice, carrying the code, its plan, and any skill correction together —
the record and the thing it records should never land apart.

## Files

- `reference/slices.md` — the catalog: per-slice detail, dependency reasoning, and the accounts
  table with the probe for each need. Read it before building any slice.
- `changelog/<YYYY-MM-DD>.md` — why the **skill's method** now says what it says: changes to the
  loop, to what a slice directory holds, to the rules every slice obeys. Append-only, same shape
  as a slice's changelog and same project-agnostic test. A change to one slice's procedure goes
  in that slice's changelog instead; this is only for what applies to all of them.
- `reference/adapting.md` — how these files were made project-agnostic, and what to change
  when a pin goes stale or a slice needs a variant.
- `scripts/install-plan.mjs` — renders each slice's `REFERENCE.md` into
  `<repo>/docs/setup/`. `--list` prints the catalog; `--force` overwrites a slice file already
  there.
- `slices/` — one **directory per slice**: the eight build slices `00`–`07`, plus the `99`
  audit. Each holds:
  - `REFERENCE.md` — the clean procedure, plus its `## Preflight`, `## Sources` and
    `## Leaves behind`. **Only what an agent can execute**: the moment a step needs a human, it
    becomes a one-line pointer into `USER-SETUP.md`. This is what gets rendered into a project.
    The project name is the literal token `__PROJECT__`, and the plan's own directory is
    `__DOCS__`.
  - `USER-SETUP.md` — the accounts, browser logins and OS-level installs this slice needs from
    a person, each tagged with the round it unblocks. Written **for the user**, not the agent,
    and handed over a section at a time when §2b's probes come back missing.
    **A step here has to be followable by someone who has never seen the vendor's UI**: name the
    page by URL, the button by its label, and — above all — anything the vendor shows **once**,
    because a value you cannot go back for turns a re-readable step into a destroyed one. "From
    the dashboard, create a key" is not a step; it assumes the reader already knows the thing
    the file exists to tell them. Never rendered
    into a project. **Only slices that need something from a person have one** — its absence is
    the statement that this slice needs nothing, which is why there are no placeholder files.
  - `changelog/<YYYY-MM-DD>.md` — why the REFERENCE now says what it says: pins that moved,
    claims corrected, traps found. Append-only, never rendered into a project, and
    **project-agnostic** — see §7 for the test an entry has to pass.
- `slices/99-security-audit/` — the audit: reads the code for setup-era exposure and reports.
  Re-runnable, builds nothing, and the only slice that is not a rung of the chain — numbered
  99 rather than 08 so that "not the next rung" is visible in the name.
- Sources live **in each slice's REFERENCE**, not in a shared bibliography — see §7.
- `assets/project-ui-SKILL.md` — the UI-writing skill slice 06 installs.

## What this skill does not do

- It does not design a schema or a product. It builds the plumbing those sit on.
- It does not choose the stack. The slices are one verified stack, not a menu of them.
- It does not deploy on its own initiative.
- It does not trust its own pins. That is what §3 is for.
- **It does not do security beyond its own footprint.** Slice 99 audits what this skill built —
  the scaffolding, defaults and surface that setting up this stack creates. It does not model
  your threat landscape or review your product's logic, and it fixes nothing on its own
  judgement. A project-wide security practice is a bigger job with a different owner.
