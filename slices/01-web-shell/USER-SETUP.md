# Slice 1 — what you need to do yourself

One account and one browser login. The agent can read the result of both, so once these are
done it will not ask you about Cloudflare again — later slices only re-verify.

Unblocks: **Round 2** only. The local half builds, tests and commits without any of this.

## 1. A Cloudflare account

[dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up). The free plan runs
everything this skill builds — Workers, Hyperdrive and all.

## 2. Log wrangler in

Needs a browser, so it is yours to run. Prefix it with `!` and the output lands in the
conversation:

```
! npx wrangler login
```

## 3. Verify — and read the account table

```bash
npx wrangler whoami
```

It prints your email and a table of every account the login carries.

**If that table has more than one row, tell the agent which account this project belongs
in.** That is the one thing no command can settle: wrangler refuses to guess in
non-interactive mode, and which account owns the Worker is your call, not the plan's. The id
is in the row — the agent writes it to a gitignored `.env.production` itself.
