# Slice 5 — what you need to do yourself

One account and one key. Both block **Round 2 only** — local rendering sends nothing, so the
whole package can be built, gated and committed first.

## 1. A Resend account

[resend.com/signup](https://resend.com/signup). The free tier sends enough to prove the
pipeline.

## 2. An API key with sending access only

The key is shown **once, at creation.** Resend's own docs are explicit that you cannot view or
edit a key's value afterwards, so if you close the dialog without copying it, the only fix is to
delete that key and make another. Have somewhere to paste it before you start.

1. Go to **[resend.com/api-keys](https://resend.com/api-keys)** (sign in if prompted).
2. Click **Create API Key**.
3. **Name** — anything you will recognise later. `cc4-test-worker` is the useful shape: which
   project, and what holds it.
4. **Permission** — choose **Sending access**, not Full access. Full access can also read your
   contacts and manage domains and other keys; this Worker only ever calls `emails.send`. The
   narrower scope costs nothing and bounds what a leaked key can do.
5. **Domain** — leave it unrestricted while `MAIL_FROM` is still `onboarding@resend.dev`
   (see §3). Restricting to a domain you have not verified yet would refuse every send.
6. **Add** — the key appears **once**. It starts `re_`. Copy it now.

Then store it against the Worker, in the terminal, without pasting it into the chat:

```
! cd apps/graphql && pnpm wrangler secret put RESEND_API_KEY
```

It prompts, you paste, and the value goes straight to Cloudflare encrypted — it is never
written to a file in the repo and never appears in this conversation. `wrangler deploy` does
**not** clear secrets, so this is one-time, re-run only to rotate.

Two ways to check it afterwards, neither of which reveals it:

```
! cd apps/graphql && pnpm wrangler secret list
```

and, once deployed, a `sendTestEmail` that returns `true` rather than
`MAIL_TRANSPORT=resend needs RESEND_API_KEY`.

**Or let the agent do the whole thing.** Verified on 2026-09-06: the agent can drive this
end to end in your own logged-in Chrome without the key ever being displayed. Resend renders the
new key in an `<input type="password">` with a **Copy to clipboard** button beside it, so there
is a path from creation to Cloudflare that never reveals the value — click Copy, never click
**Show value**, and pipe the clipboard straight in:

```bash
xclip -selection clipboard -o | pnpm wrangler secret put RESEND_API_KEY --env-file .env.production
```

That is the same clipboard→pipe pattern slice 3 uses for the Neon connection string, and the
same rule governs it: assert the shape before piping (`case "$V" in re_*)`), print nothing but a
verdict, and clear the clipboard afterwards. Ask the agent for it if you would rather not handle
the key at all — it still needs your say-so first, because creating an API key makes a real
credential in your name.

## 3. Know who can actually receive

`MAIL_FROM` starts as `onboarding@resend.dev`, Resend's shared sender. It delivers **only to
the address you signed up with** — any other recipient is rejected at Resend, not by this code.

That is fine for proving the pipeline and a dead end for real users. Sending anywhere else
needs a verified domain and a new `MAIL_FROM`.

So tell the agent the address you signed up with: it goes in `MAIL_TEST_RECIPIENTS`, and
without it the production gate refuses your own send.
