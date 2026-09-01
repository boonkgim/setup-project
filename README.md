# setup-project

**Every setup guide is stale by the time you run it. This one checks itself against reality
first, then rewrites itself with what actually worked.**

An [agent skill](https://agentskills.io) for Claude Code, Codex, and any other AI coding
agent that reads `SKILL.md`. It scaffolds a full-stack web app **one infrastructure slice
at a time**, and each slice runs the same loop:

```
reference → research → wire → plan → execute → local gate → reconcile
          → production gate → reconcile → your manual steps → commit
```

The stack is fixed and was verified as a set: **pnpm workspace · Next.js on Cloudflare
Workers via OpenNext · GraphQL Yoga Worker · Drizzle + Postgres (Docker locally, Neon
through Hyperdrive in production) · Tailwind + shadcn**, then optionally Resend, Better
Auth and Stripe.

This skill was argued into shape over three weeks and two real repos, one correction at a
time. [Read the prompts that shaped it](docs/prompt-history.md) before you install
anything.

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

## What it builds

| Slice | Builds                                                          |
| ----- | --------------------------------------------------------------- |
| 00    | pnpm workspace, catalog pins, turbo, prettier/ESLint/vitest, `docs:check` |
| 01    | `apps/web` on Cloudflare Workers via OpenNext, deployed         |
| 02    | `apps/graphql` Yoga Worker, codegen, typed client, service binding |
| 03    | `packages/db` with Drizzle, Postgres in Docker, Neon + Hyperdrive |
| 04    | Tailwind, shadcn, and a theme you can re-skin from one file     |
| 05    | `packages/email` with React Email and Resend                    |
| 06    | Better Auth, magic-link sign-in, sessions                       |
| 07    | Stripe embedded Checkout and a signed, idempotent webhook       |
| 99    | A re-runnable audit of what the setup itself left exposed       |

Slice 99 is not a rung of the chain. It builds nothing, reads whatever exists, and reports.

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
