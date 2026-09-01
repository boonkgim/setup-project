# setup-project

**Every setup guide is stale by the time you run it. This one checks itself against reality
first, then rewrites itself with what actually worked.**

An [agent skill](https://agentskills.io) for Claude Code, Codex, and any other AI coding
agent that reads `SKILL.md`. It scaffolds a full-stack web app on **Next.js + GraphQL +
Postgres, deployed to Cloudflare Workers**, one infrastructure slice at a time, and every
slice runs the same loop:

```
reference → research → wire → plan → execute → local gate → reconcile
          → production gate → reconcile → your manual steps → commit
```

This skill was argued into shape over three weeks and two real repos, one correction at a
time. [Read the prompts that shaped it](docs/prompt-history.md) before you install
anything.

## The stack

It is fixed, and it is one stack rather than a menu. These pieces were verified as a set,
which is the only reason the slices can promise anything: the traps that cost real time are
usually in the seams between two of them, not inside either one.

| Layer            | What it uses                                             | Worth knowing                                                       |
| ---------------- | -------------------------------------------------------- | -------------------------------------------------------------------- |
| **Monorepo**     | pnpm workspaces + turbo                                  | `catalog:` pins, so one version of a dependency across every package |
| **Web**          | Next.js (App Router) on Cloudflare Workers via OpenNext  | Workers, not Vercel. `wrangler` deploys it                           |
| **API**          | GraphQL Yoga on its own Worker                           | graphql-codegen server preset, typed client, service binding from web |
| **Database**     | Drizzle ORM + Postgres                                   | Docker locally, Neon through Cloudflare Hyperdrive in production     |
| **UI**           | Tailwind + shadcn/ui                                     | every token in one `theme.css`, dark mode, no component names a colour |
| **Email**        | React Email + Resend *(optional)*                        | a `log` transport locally, real delivery in production                |
| **Auth**         | Better Auth, magic link *(optional)*                     | no password field and no password column, by default                 |
| **Payments**     | Stripe embedded Checkout *(optional)*                    | signed webhook, idempotent on Stripe's event id                       |
| **Quality**      | TypeScript, ESLint, Prettier, Vitest, turbo              | plus `docs:check`, which fails when the plan and the repo disagree    |
| **Runtime**      | Node 24+, pnpm via corepack, workerd through wrangler    | everything server-side runs on workerd, not Node                      |

If you want a different stack, this skill will say so plainly rather than improvise one.

## Why you would want this

Scaffolding is not the hard part. Anyone can run `create-next-app`. The hard part is that
the twelve tools underneath it move independently, and the guide you wrote in August fails
in September for reasons that have nothing to do with your app. Three things this does
about that:

- **It never trusts its own pins.** Before writing a single command into your repo, the
  skill checks `npm view` and the vendor's current docs for every tool the slice touches,
  and it reads what the install **prints**, not just what it returns. That is how it caught
  `@react-email/components` being folded into `react-email` five months earlier: the
  package still installed, still exported the same names, still compiled green, and the
  only evidence anywhere was one `[WARN] deprecated` line.
- **The plan gets corrected after it is proven, not before.** A green gate means the repo
  is right. It does not mean the plan is. So every slice ends by amending two files: the
  execution record in your `docs/setup/`, which is what actually ran here, and the skill's
  own reference, which is the general lesson that carries to the next project. The traps
  compound instead of evaporating.
- **You can stop after any slice.** Each one deploys and proves both halves of its layer:
  that it works standalone, and that it works joined to what is already built. Stop at 04
  and you have a deployed web app, API, database and theming system. Stop at 06 and you
  have accounts and sign-in. There is no half-finished rung.

The version numbers in the reference rot. The reasoning does not: the `devEngines` block
`pnpm init` writes that corepack then rejects, the second `create-next-app` in a pnpm
workspace that quietly opens its own workspace root inside `apps/web`. That is the payload.

## The slices

Eight build slices plus an audit, one per invocation, in order. Each ends at a green gate,
locally and (from 01 on) in production, which is what makes every one of them a place you
can legitimately stop.

| #      | Slice                    | What lands in the repo                                                                                                                             | Needs             |
| ------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| **00** | Workspace foundation     | pnpm workspace, `catalog:` pins, turbo, Prettier + ESLint + Vitest, `packages/config`, the env-file convention, the first `CLAUDE.md`, `docs:check` | Node 24+, pnpm    |
| **01** | Web shell, deployed      | `apps/web` from `create-next-app`, the OpenNext Cloudflare adapter, `wrangler.jsonc`, the first real unit test, a live `*.workers.dev` URL         | Cloudflare        |
| **02** | GraphQL                  | `apps/graphql` on workerd, modular SDL, codegen'd resolvers, the typed client in `apps/web`, the service binding, CORS allowlist                    | Cloudflare        |
| **03** | Database                 | `packages/db` (Drizzle schema, migrations, client factory), `docker-compose.yml`, the Hyperdrive binding, the first integration tests               | Docker, Neon      |
| **04** | Theming system           | Tailwind, the shadcn registry, and `theme.css`: every token value in one file, dark mode, with a test asserting the theme contract                  | nothing new       |
| **05** | Email                    | `packages/email` (React Email templates, a `log` transport and a `resend` one), the send mutation, a recipient allowlist                            | Resend            |
| **06** | Authentication           | Better Auth mounted before Yoga, generated auth tables, the same-origin `/api/auth/[...all]` proxy, a sign-in panel, a `viewer` field               | Resend (05)       |
| **07** | Payments                 | Embedded Checkout from the API, the form in `apps/web`, the signed webhook at `/stripe/webhook`, a `stripe_event` table for idempotency             | Stripe + CLI      |
| **99** | Security audit           | A report: what the setup itself left exposed, who can reach it, why it is there, and at least two options each. Changes nothing                     | nothing new       |

**00 through 04 is the scaffold.** 05, 06 and 07 are optional infrastructure on top of it,
and each is a hard prerequisite for the next: magic-link sign-in is delivered by email, so
06 genuinely needs 05, and 07 patches files 06 wrote.

| Stop at | You have                                                          |
| ------- | ------------------------------------------------------------------ |
| 04      | the scaffold: deployed web + API + database + theming system       |
| 05      | plus transactional email                                           |
| 06      | plus accounts, magic-link sign-in, sessions                        |
| 07      | plus Stripe embedded Checkout and a signed webhook                 |

**99 is not a rung of the chain.** It builds nothing, needs only slice 00, and reads
whatever exists, so it is re-runnable at any point and never counts as "the next slice".
Run it after anything that adds public surface. The number is 99 and not 08 so that the
filename says as much.

[`reference/slices.md`](reference/slices.md) has the full entry for each one: what its gate
proves, which account it needs, and the specific traps it carries.

## Install

Paste this to your agent:

```
install the skill at https://github.com/boonkgim/setup-project
```

It clones the repo and puts it where your tool looks for skills. To update it later, ask
the same way, or `git pull` in the clone.

<details>
<summary>By hand</summary>

If you would rather see exactly what lands where:

```bash
git clone https://github.com/boonkgim/setup-project.git

# Claude Code
ln -s "$PWD/setup-project" ~/.claude/skills/setup-project

# Codex
ln -s "$PWD/setup-project" ~/.agents/skills/setup-project
```

Symlink into a project's `.claude/skills/` instead to scope it to one repo. Other tools
read skills from their own location, and some take an upload; check yours.

</details>

A skill is instructions your agent will follow, so read `SKILL.md` before installing this
or any other.

## Works with

`SKILL.md` follows the [Agent Skills](https://agentskills.io) open standard, so it loads
directly in any agent that reads the format:

- **Claude Code**, from `~/.claude/skills/`
- **OpenAI Codex**, from `~/.agents/skills/`
- **OpenClaw**
- **Hermes**
- **claude.ai** and the **Claude Agent SDK**, by upload

Where an agent is not listed with a path, check its own docs for the skills directory.

## Usage

```
/setup-project           # shows the catalog, recommends the next slice, waits for you
/setup-project 03        # builds the database slice
/setup-project auth      # names work too
```

One slice per invocation. It stops when that slice is committed.

With no argument it lists every slice, marks which ones your `docs/setup/` shows as built,
recommends one, and waits for your confirmation. There is no separate state file to keep in
sync: a slice doc exists because that slice went green.

**Have the accounts ready.** A slice whose account does not exist yet stalls halfway
through its production gate, with the local half already committed.

| Need                                 | First required at |
| ------------------------------------ | ----------------- |
| Node 24+, pnpm, corepack             | 00                |
| Cloudflare account, `wrangler login` | 01                |
| Docker                               | 03                |
| Neon project (direct/unpooled URL)   | 03 (production)   |
| Resend account + API key             | 05 (production)   |
| Stripe test account + Stripe CLI     | 07                |

Some slices deploy, and a few send real email or hit Stripe. Every one of those is
announced before it runs.

If this is useful, a ⭐ helps other people find it.

## Why not just use a template?

A template hands you a working repo you did not build, pinned to the day it was published.
When something in it breaks, you are debugging a stranger's choices with no record of why
any of them were made. This does the opposite: it writes the plan into **your** repo, as
prose you can read, and then corrects that prose against what actually happened. What you
end up with is a scaffold plus the reasoning behind every line of it, checked by
`pnpm docs:check` so the plan and the repo cannot silently drift apart.

The other difference is where it stops. A generator finishes when files exist. This
finishes when the gates are green in production and you have been handed the short numbered
list of checks only a person can make: the rendered template, the real inbox, the page that
has to look right.

## When not to use this

- **The stack is not a menu.** These slices are one stack that was verified as a set. If
  you want Vercel, Prisma, or tRPC, this is the wrong skill and it will say so rather than
  improvise.
- **It is not fast.** Research, gates and reconciliation on every slice is the whole point,
  and it is slower than accepting a generator's output.
- **It does not design your product.** No schema, no features, no business logic. It builds
  the plumbing those sit on.
- **Slice 99 is not a security practice.** It audits the exposure that setting up this
  stack creates. It knows nothing about your product or your threat model.

## Author

Built by **Khur Boon Kgim** at [boonkgim.com](https://boonkgim.com), where I write about
practical AI for builders: AI agents, coding workflows, and shipping software.

## License

MIT. See [LICENSE](LICENSE).
