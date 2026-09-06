# Slice 7 — what you need to do yourself

An account, two keys, a CLI, and — at the very end — a webhook endpoint. **Stay in test mode
throughout.** Every step below works identically in live mode and charges a real card, which
is not what a pipeline proof is for.

## 1. A Stripe account — blocks both rounds

[dashboard.stripe.com/register](https://dashboard.stripe.com/register). No business details
and no bank account are needed for test mode.

## 2. Both API keys — blocks both rounds

From the dashboard's API keys page, **in a sandbox**, copy both:

- the secret key, beginning `sk_test_`
- the publishable key, beginning `pk_test_`

Both, unusually. Embedded Checkout runs in the browser, so the publishable key is load-bearing
here in a way it is not for a hosted integration.

A `sk_test_` key cannot charge anyone, so the agent may move it for you provided it never
prints it. A key beginning `sk_live_` is yours alone to handle — do not paste one into this
conversation.

## 3. The Stripe CLI — blocks Round 1

The local gate forwards webhooks through `stripe listen`, so nothing local passes without it.

```bash
stripe --version
```

If it is missing: `brew install stripe/stripe-cli/stripe` on macOS, otherwise
[docs.stripe.com/stripe-cli](https://docs.stripe.com/stripe-cli) for the Linux package and the
Windows build.

Then link it — a browser step, so it is yours:

```
! stripe login
```

**Link it to the same sandbox step 2's keys came from.** This is the one thing the command
cannot tell you it got wrong: forwarding from one account to a Worker holding another
account's key fails signature verification, and the error names neither.

## 4. A webhook endpoint — blocks Round 2 only

Created against the deployed Worker, so it comes last. The agent will tell you the URL and the
two settings the form asks for; you copy back the signing secret, which begins `whsec_`.

## 5. The card

`4242 4242 4242 4242`, any future expiry, any CVC. It is a documented public constant that
belongs to nobody and moves no money.

**This step is yours, and not on policy grounds.** Checkout's fields live in a cross-origin
`js.stripe.com` iframe, so they never reach the accessibility tree and the agent physically
cannot type into them. Everything else about the pipeline is provable without a card.
