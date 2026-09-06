# Slice 5 — what you need to do yourself

One account and one key. Both block **Round 2 only** — local rendering sends nothing, so the
whole package can be built, gated and committed first.

## 1. A Resend account

[resend.com/signup](https://resend.com/signup). The free tier sends enough to prove the
pipeline.

## 2. An API key with sending access only

From the dashboard, create a key and give it **Sending access** — not full access. It is the
one credential this slice adds, and a narrower scope costs nothing.

Hand it to the agent, or run the interactive store yourself:

```
! cd apps/graphql && pnpm wrangler secret put RESEND_API_KEY
```

Cloudflare keeps it encrypted against the Worker, and `wrangler deploy` does **not** clear it —
so this is a one-time step, re-run only to rotate. `pnpm wrangler secret list` confirms it is
there without revealing it.

## 3. Know who can actually receive

`MAIL_FROM` starts as `onboarding@resend.dev`, Resend's shared sender. It delivers **only to
the address you signed up with** — any other recipient is rejected at Resend, not by this code.

That is fine for proving the pipeline and a dead end for real users. Sending anywhere else
needs a verified domain and a new `MAIL_FROM`.

So tell the agent the address you signed up with: it goes in `MAIL_TEST_RECIPIENTS`, and
without it the production gate refuses your own send.
