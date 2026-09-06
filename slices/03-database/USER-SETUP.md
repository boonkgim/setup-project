# Slice 3 — what you need to do yourself

A local daemon and a hosted Postgres. They block different rounds, so read the tags.

## 1. Docker — blocks Round 1

```bash
docker info --format '{{.ServerVersion}}'
```

A version means the daemon is running. An error means it is not, which is a different problem
from not being installed:

- **Installed but down** — Linux: `! sudo systemctl start docker`. macOS/Windows: open Docker
  Desktop and wait for the whale to settle.
- **Absent** — [docs.docker.com/get-started](https://docs.docker.com/get-started/). Docker
  Desktop on macOS/Windows; on Linux the `docker.io` (or `docker-ce`) package, then add
  yourself to the `docker` group so it runs without `sudo`.

Nothing local passes without this: the gate runs migrations and an integration test against a
real Postgres in a container.

## 2. A Neon project — blocks Round 2 only

[console.neon.tech](https://console.neon.tech) — the free tier is enough. The agent can build,
gate and commit the whole local half before you do this.

**Leave "Enable Neon Auth" off on the create form.** It provisions Neon's own auth tables into
this database. The authentication slice uses Better Auth and generates its own, so turning it
on lands a second, competing auth system in the same database. It defaults to off, so this
costs nothing but noticing.

Pin the newest Postgres major the form offers.

## 3. The direct connection string — blocks Round 2 only

From the project's connection panel, copy the **direct / unpooled** string — not the pooled
one. Hyperdrive is itself the pooler, and stacking it on Neon's pooled endpoint is discouraged
by both vendors.

The quickest way to tell them apart: the pooled host carries `-pooler` in it, the direct one
does not.

Hand it to the agent, which writes it to a gitignored `packages/db/.env.production`. This is
the one string in the repo worth treating as a password.
