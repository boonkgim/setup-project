# Slice 7 — Payments: embedded Checkout and a verified webhook

Horizontal, because three pipelines have never run: an **inbound** request from a third party
— the first traffic this stack takes that came from neither a browser nor `apps/web`; a
signature verified over a raw body under workerd's WebCrypto; and a payment form that runs
**inside our own page**, served by a host we do not own, initialised by a key that
`next build` bakes into the browser bundle.

Slice 5 proved a Worker can call out to an API. This is the other direction, and the
direction where being wrong costs money.

## Shape

```
browser ──▶ /checkout ──server action──▶ __PROJECT__-web ──binding──▶ __PROJECT__-graphql ──▶ Stripe API
        ◀──────────────── client secret ◀──────────────────────────────────────────────────┘
browser ──▶ js.stripe.com ──▶ Stripe's form, in an iframe, on our origin
        the page never leaves; the visitor's card details never touch this stack

Stripe ──POST /stripe/webhook──▶ __PROJECT__-graphql ──▶ Hyperdrive ──▶ Postgres
        signed; no cookie, no Origin, no proxy
```

The webhook lands on the API Worker's own public URL. Slice 6's proxy exists so a session
cookie can belong to the origin the browser asked — a webhook has no cookie and no origin, so
the proxy buys nothing and costs one more hop that can re-encode the bytes the signature
covers. What authenticates Stripe here is the signature, not where the request arrived.

Embedded rather than hosted Checkout moves one risk and adds two. Gone: returning the visitor
to the right host, because they never left it. New: a publishable key that is inlined at build
time rather than read at runtime, which is the opposite of every other credential in this
repo; and a payment surface that is an iframe, so it does not inherit the app's theme and
fails blank rather than loudly.

## Decisions

| Decision                                                            | Why                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Webhook direct to `__PROJECT__-graphql`, not through the proxy      | No cookie to keep same-origin. The signature is the authentication, and every extra hop is a chance to alter the bytes it covers.                                                                                                                      |
| `stripe` with `httpClient: Stripe.createFetchHttpClient()`          | The SDK's default client reaches for `node:https`, which workerd does not provide however `nodejs_compat` is set. It fails at the first call, not at import.                                                                                           |
| `constructEventAsync` + `createSubtleCryptoProvider()`              | WebCrypto is async, so the synchronous `constructEvent` cannot run here at all.                                                                                                                                                                        |
| Raw body read once, as text, before anything parses it              | The signature covers the exact bytes sent. `request.json()` consumes the body, and re-serialising the object yields different bytes for the same data.                                                                                                 |
| `stripe_event`, keyed on Stripe's event id                          | Stripe retries, and retries repeat the id. A primary-key conflict is idempotency with no read to race against; a "have I seen this?" check has one.                                                                                                    |
| The webhook is the record, the return page is not                   | A visitor can pay and close the tab. Stripe says to treat the return as a convenience, which is why this slice is a webhook.                                                                                                                           |
| `ui_mode: "embedded_page"`, and so `return_url` and no `cancel_url` | The API rejects `cancel_url` on an embedded session outright — there is no "cancel" to redirect, because the form was never a page of its own.                                                                                                         |
| `redirect_on_completion` left at its default `always`               | The alternative, `"never"` plus an `onComplete` callback, makes a browser callback the only completion signal. That is weaker evidence than a redirect, and this slice already says the redirect is not evidence.                                      |
| A dedicated `/checkout` route, not the embed on the home card       | The embed is a tall iframe with its own minimum width; the home card is a 28rem status panel. Mounting it there would fight both.                                                                                                                      |
| `fetchClientSecret`, not a server-rendered `clientSecret`           | A secret rendered into the page is a session created for every visitor who merely loads the route, and it cannot be replaced without a new page. The callback also gives the return page's `open` branch somewhere to go back to for a _fresh_ secret. |
| `STRIPE_MODE` named, checked against the secret key's prefix        | Fail-closed like `MAIL_TRANSPORT`. A mode inferred from the key can never disagree with the key, so it catches nothing — including a live key in a dev deploy.                                                                                         |
| Web checks the **shape** of its publishable key, not its mode       | A publishable key cannot move money: `pk_live_` in a test build is a form that fails to load — loud and free. The silent mistake is pasting `sk_` into a `NEXT_PUBLIC_` var, and that is what the check catches.                                       |
| Inline `price_data`, no dashboard Price                             | A product created by hand is a one-time step no doc can check, and the amount belongs in the repo as integer cents.                                                                                                                                    |
| `WEB_ORIGIN` replaces `BETTER_AUTH_URL`                             | The return URL needs the same fact Better Auth's `baseURL` needs. One fact under two names drifts the first time one of them moves.                                                                                                                    |

That last row is a rename inside a payments slice, so it is worth saying why it is not scope
creep: the alternative is a second var holding the identical string, and the failure it
produces — a mailed link on one host and a Checkout return on another — appears only after a
domain move, in production, months later. The change is one line of code and four env
entries, and `src/auth.int.test.ts` covers it.

## packages/db

One table. It is the whole observable output of the slice: nothing else writes it, so a row
means a signed delivery arrived and was accepted.

```bash
cd packages/db
```

```diff
--- packages/db/src/schema.ts
-import { pgTable, serial, text } from "drizzle-orm/pg-core";
+import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
@@
 export const items = pgTable("items", {
   id: serial("id").primaryKey(),
   name: text("name").notNull(),
 });
+
+// Stripe's own event id is the primary key, not a surrogate: a retried or duplicated
+// delivery then conflicts instead of inserting twice, and that conflict is the entire
+// idempotency mechanism. Nothing reads before writing, so there is no window for two
+// concurrent deliveries of the same event to both decide they are the first.
+//
+// No payload column. The event body is Stripe's to hold and is retrievable from their
+// API by id; copying it here would put card metadata in our database for nothing.
+export const stripeEvent = pgTable("stripe_event", {
+  id: text("id").primaryKey(),
+  type: text("type").notNull(),
+  receivedAt: timestamp("received_at", { withTimezone: true })
+    .notNull()
+    .defaultNow(),
+});
```

`withTimezone` because the only two things that will ever compare these values are a Worker
in an unknown region and a psql session on your laptop. A bare `timestamp` stores no offset
and both of them guess.

**Then re-export the query operators**, because two files below need `desc` and `eq` and
`apps/graphql` cannot import them. `drizzle-orm` is a dependency of `packages/db` alone, so
`import { desc } from "drizzle-orm"` in a resolver does not resolve under pnpm's strict
layout — it fails at `pnpm typecheck` with `Cannot find module`. The fix is not to add a
second direct dependency: this package owns the drizzle version, and a second pin in another
package is a second version to drift.

```diff
--- packages/db/src/index.ts
 export { createDb } from "./client";
 export * from "./schema";
+
+// The query operators resolvers need, re-exported rather than imported from
+// "drizzle-orm" at the call site. apps/graphql does not depend on drizzle-orm and
+// should not start: this package owns the drizzle version, and a second direct pin in
+// another package is a second version to drift. Every other db symbol a resolver uses
+// (createDb, items, stripeEvent) already arrives this way, so this keeps one import
+// line per resolver instead of two from two different owners.
+//
+// Named explicitly, not `export * from "drizzle-orm"` — that would re-export hundreds
+// of symbols and collide with the table names above.
+export { and, asc, desc, eq, inArray, isNull, not, or, sql } from "drizzle-orm";
```

```bash
pnpm generate
#   ↳ READ THE GENERATED SQL — one CREATE TABLE, no ALTER on an existing one
pnpm migrate
```

## apps/graphql

```bash
cd ../../apps/graphql
pnpm add stripe
```

No catalog entry: `stripe` has exactly one installer, and the catalog is for versions two
packages must agree on. `@stripe/stripe-js` in `apps/web` is a different package that speaks
a different half of the protocol, not a second copy of this one.

The SDK pins the Stripe API version it was built against and sends it on every call, so
`apiVersion` is deliberately left unset — upgrading the package is what moves the API
version, as a lockfile change you can read, rather than on Stripe's release schedule.

### The client and the mode guard

```bash
cat > src/stripe.ts <<'EOF'
import Stripe from "stripe";
import { requireEnv } from "./env";
import type { Env } from "./context";

/** Where Stripe posts.
 *
 *  A path on this Worker's own public URL rather than behind apps/web's proxy: that
 *  proxy exists so a session cookie can belong to the origin the browser asked, and a
 *  webhook has neither a cookie nor an origin. What it would add is a hop that can
 *  re-encode the body the signature is computed over.
 */
export const STRIPE_WEBHOOK_PATH = "/stripe/webhook";

// Restricted keys are issued alongside secret ones and are equally valid here, so the
// check is on the environment segment rather than on a single whole prefix. No pk_
// here on purpose: this Worker never holds a publishable key, and apps/web never holds
// one of these.
const KEY_PREFIXES: Record<string, string[]> = {
  test: ["sk_test_", "rk_test_"],
  live: ["sk_live_", "rk_live_"],
};

/** Refuse a key that does not match the mode it was deployed under.
 *
 *  The mode is named rather than inferred, for the reason MAIL_TRANSPORT is: a mode read
 *  off the key can never disagree with the key, so it detects nothing. Naming it
 *  separately is what turns the one mistake in this file that charges a real card — a
 *  live key reached by a deploy that believed it was in test — into a startup error.
 */
export function assertKeyMatchesMode(mode: string, key: string): void {
  const prefixes = KEY_PREFIXES[mode];
  if (!prefixes) {
    throw new Error(
      `Unknown STRIPE_MODE ${JSON.stringify(mode)} — expected "test" or "live"`,
    );
  }
  if (!prefixes.some((prefix) => key.startsWith(prefix))) {
    throw new Error(
      `STRIPE_MODE=${mode} needs a key beginning ${prefixes.join(" or ")}`,
    );
  }
}

/** The Stripe client, per request — bindings and secrets do not exist at import time,
 *  the same reason createDb and createAuth are factories.
 *
 *  httpClient is explicit rather than necessary, which is a change from what older
 *  guidance says. `stripe` 22 declares a `workerd` export condition resolving to a Web
 *  platform build whose createDefaultHttpClient() *is* the fetch client (and whose
 *  default crypto provider is SubtleCrypto) — verified by reading
 *  esm/platform/WebPlatformFunctions.js in the published 22.6.0 tarball.
 *
 *  It stays named anyway. Dropping it makes this Worker correct only for as long as the
 *  bundler keeps choosing that condition; the node build it would otherwise fall back to
 *  reaches for node:https, and that failure surfaces at the first API call rather than
 *  at import — so a bundle that uploaded cleanly is not evidence either way. One
 *  argument buys independence from all of it.
 */
export function createStripe(env: Env): Stripe {
  const key = requireEnv(env, "STRIPE_SECRET_KEY");
  assertKeyMatchesMode(requireEnv(env, "STRIPE_MODE"), key);

  return new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
}
EOF
cat > src/stripe.test.ts <<'EOF'
import { expect, test } from "vitest";
import { assertKeyMatchesMode } from "./stripe";

test("a key matching its mode passes, in both issued forms", () => {
  expect(() => assertKeyMatchesMode("test", "sk_test_abc")).not.toThrow();
  expect(() => assertKeyMatchesMode("test", "rk_test_abc")).not.toThrow();
  expect(() => assertKeyMatchesMode("live", "sk_live_abc")).not.toThrow();
});

// The reason the mode is a var at all. Both directions matter: a live key under test
// charges real cards, and a test key under live silently takes no money at all.
test("a key from the other mode is refused, in both directions", () => {
  expect(() => assertKeyMatchesMode("test", "sk_live_abc")).toThrow("STRIPE_MODE");
  expect(() => assertKeyMatchesMode("live", "sk_test_abc")).toThrow("STRIPE_MODE");
});

test("an unset or unknown mode throws rather than guessing", () => {
  expect(() => assertKeyMatchesMode("", "sk_test_abc")).toThrow("STRIPE_MODE");
  expect(() => assertKeyMatchesMode("sandbox", "sk_test_abc")).toThrow("sandbox");
});
EOF
```

### The webhook handler

Unchanged by the move to embedded Checkout, and that is the point: the browser-side flow is a
convenience, and the thing that records money is deliberately independent of it.

```bash
cat > src/stripe-webhook.ts <<'EOF'
import Stripe from "stripe";
import { createDb, stripeEvent } from "@__PROJECT__/db";
import { createStripe, STRIPE_WEBHOOK_PATH } from "./stripe";
import { requireEnv } from "./env";
import type { Env } from "./context";

// Module scope, and safe there unlike everything else in this Worker: building a crypto
// provider reads no binding and performs no I/O.
const webCrypto = Stripe.createSubtleCryptoProvider();

/** Exact match, not a prefix — this path has no children, and a startsWith would also
 *  claim /stripe/webhooks-disabled. */
export function isStripeWebhookPath(url: string): boolean {
  return new URL(url).pathname === STRIPE_WEBHOOK_PATH;
}

/** Verify a delivery, record it at most once, and answer.
 *
 *  Every rejection here is a 4xx and never a 5xx. Stripe retries a 5xx with backoff for
 *  days, and a body that failed verification will fail it on the tenth attempt too — so
 *  retrying is noise. The case genuinely worth retrying is a database that is down, and
 *  that one throws past this handler and becomes a 500 on its own.
 */
export async function handleStripeWebhook(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature", { status: 400 });
  }

  // Read once, as text, before anything parses it. The signature covers the exact bytes
  // Stripe sent: request.json() consumes the body and re-serialising the parsed object
  // produces different bytes for identical data, while a second read on a Workers
  // Request throws outright.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = await createStripe(env).webhooks.constructEventAsync(
      payload,
      signature,
      requireEnv(env, "STRIPE_WEBHOOK_SECRET"),
      // The timestamp tolerance, left at its default. It is spelled out only because
      // the crypto provider is positional and comes after it.
      undefined,
      webCrypto,
    );
  } catch (cause) {
    // The reason goes to the log and not to the caller: whoever sent this is
    // unauthenticated by definition, and the detail is only useful to us.
    console.error("[stripe] signature verification failed", cause);
    return new Response("Invalid signature", { status: 400 });
  }

  // No branch on event.type. This slice records deliveries; deciding what a
  // checkout.session.completed *means* is fulfilment, and fulfilment is a feature.
  const db = createDb(env.HYPERDRIVE.connectionString);
  const inserted = await db
    .insert(stripeEvent)
    .values({ id: event.id, type: event.type })
    .onConflictDoNothing()
    .returning({ id: stripeEvent.id });

  // 200 either way: a duplicate is a delivery that worked, and answering 4xx would make
  // Stripe retry the one event already handled.
  return Response.json({ received: true, duplicate: inserted.length === 0 });
}
EOF
cat > src/stripe-webhook.test.ts <<'EOF'
import { expect, test } from "vitest";
import { handleStripeWebhook, isStripeWebhookPath } from "./stripe-webhook";
import type { Env } from "./context";

// No HYPERDRIVE on purpose: every case below must be refused before the database is
// reached, and a missing binding is what proves it — a handler that got that far would
// throw rather than return the status asserted.
const env = {
  STRIPE_MODE: "test",
  STRIPE_SECRET_KEY: "sk_test_not_a_real_key",
  STRIPE_WEBHOOK_SECRET: "whsec_not_a_real_secret",
} as unknown as Env;

const deliver = (init: RequestInit & { signature?: string }) =>
  handleStripeWebhook(
    new Request("http://localhost/stripe/webhook", {
      ...init,
      headers: init.signature ? { "stripe-signature": init.signature } : {},
    }),
    env,
  );

test("claims exactly its own path", () => {
  expect(isStripeWebhookPath("http://localhost/stripe/webhook")).toBe(true);
  expect(isStripeWebhookPath("http://localhost/stripe/webhook?x=1")).toBe(true);
});

test("leaves graphql and the auth base path alone", () => {
  expect(isStripeWebhookPath("http://localhost/graphql")).toBe(false);
  expect(isStripeWebhookPath("http://localhost/api/auth/sign-in/email")).toBe(false);
  expect(isStripeWebhookPath("http://localhost/stripe/webhook/extra")).toBe(false);
});

// A GET here is a browser or a scanner, never Stripe.
test("anything but POST is refused", async () => {
  expect((await deliver({ method: "GET" })).status).toBe(405);
});

test("a delivery with no signature header is refused", async () => {
  expect((await deliver({ method: "POST", body: "{}" })).status).toBe(400);
});

// The one that matters: an attacker can post any body they like to this URL.
test("a signature that does not verify is a 400, not a 500", async () => {
  const res = await deliver({
    method: "POST",
    body: JSON.stringify({ id: "evt_forged", type: "checkout.session.completed" }),
    signature: "t=1,v1=deadbeef",
  });

  expect(res.status).toBe(400);
});
EOF
```

### Routing

The Worker now serves three things. Both non-Yoga branches sit ahead of it for the same
reason — they are HTTP endpoints, not GraphQL — and the webhook sits ahead of CORS for a
different one: `corsFor` names browser origins, and Stripe sends no `Origin` at all.

```diff
--- apps/graphql/src/index.ts
 import { createAuth, isAuthPath } from "./auth";
+import { handleStripeWebhook, isStripeWebhookPath } from "./stripe-webhook";
 import type { Env } from "./context";
@@
-// Better Auth owns everything under its basePath; Yoga owns the rest. Auth is a set of
-// HTTP endpoints, not a GraphQL concern — behind a mutation it would mean
-// re-implementing its cookie handling in a resolver.
+// Better Auth owns everything under its basePath, Stripe's webhook owns one path, and
+// Yoga owns the rest. Both are sets of HTTP endpoints rather than GraphQL concerns:
+// auth behind a mutation would mean re-implementing its cookie handling in a resolver,
+// and a webhook behind one would mean verifying a signature over a body Yoga had
+// already parsed and re-serialised.
+//
+// The webhook branch also sits ahead of Yoga's CORS: corsFor names browser origins, and
+// Stripe sends no Origin at all.
@@
     if (isAuthPath(request.url)) return createAuth(env).handler(request);
+    if (isStripeWebhookPath(request.url))
+      return handleStripeWebhook(request, env);
     return yoga.fetch(request, env, ...(ctx ? [ctx] : []));
```

### Env

`BETTER_AUTH_URL` becomes `WEB_ORIGIN`, because the Checkout return URL needs the same value:

```diff
--- apps/graphql/src/auth.ts
 export function createAuth(env: Env) {
-  const webOrigin = requireEnv(env, "BETTER_AUTH_URL");
+  // WEB_ORIGIN, not BETTER_AUTH_URL: Slice 7 needs this same origin for Stripe's
+  // return URL, and one fact under two names disagrees with itself the first time
+  // either moves. The name says what the value is, not which library first wanted it.
+  const webOrigin = requireEnv(env, "WEB_ORIGIN");
```

```diff
--- apps/graphql/src/auth.int.test.ts
   HYPERDRIVE: { connectionString: CONNECTION },
-  BETTER_AUTH_URL: WEB,
+  WEB_ORIGIN: WEB,
   BETTER_AUTH_SECRET: "integration-test-secret-not-used-anywhere-else",
```

```diff
--- apps/graphql/.env.example
-# The origin the browser sees - apps/web, never this Worker. See src/auth.ts.
-BETTER_AUTH_URL=http://localhost:3000
-# The two keys with no counterpart in wrangler.jsonc. Secrets are set with
+# The origin the browser sees - apps/web, never this Worker. Better Auth's baseURL and
+# Stripe Checkout's return host are the same fact, so they are one key.
+WEB_ORIGIN=http://localhost:3000
+# test or live, checked against the key prefix below. Unset is an error, never a guess.
+STRIPE_MODE=test
+# The four keys with no counterpart in wrangler.jsonc. Secrets are set with
 # `wrangler secret put` and stored by Cloudflare; a `vars` entry would be plaintext.
 RESEND_API_KEY=re_dev_only_not_a_real_key
+# The generator prints a whole `KEY=value` line - paste only the part after the `=`.
 BETTER_AUTH_SECRET=dev-only-not-a-real-secret
+STRIPE_SECRET_KEY=sk_test_dev_only_not_a_real_key
+# Printed by `stripe listen`, and not the deployed endpoint's. Stable per account and
+# device rather than per run - `stripe listen --print-secret` returns the same value, so
+# restarting the CLI is not a reason to re-copy it.
+STRIPE_WEBHOOK_SECRET=whsec_dev_only_not_a_real_secret
```

`wrangler.jsonc` by hand, as always — it carries an account-specific Hyperdrive id:

```jsonc
{
  ...,
  "vars": {
    ...,
    // Renamed from BETTER_AUTH_URL. Same value, same reason it must be the web origin;
    // now also the host Stripe returns the visitor to after Checkout.
    "WEB_ORIGIN": "https://__PROJECT__-web.YOUR-SUBDOMAIN.workers.dev",
    // test or live. Deployed value, and the one var in this file worth reading twice:
    // src/stripe.ts refuses to start if the deployed key disagrees with it.
    "STRIPE_MODE": "test"
  }
}
```

Local overrides go in `.env.development` by hand — gitignored, and it now holds three
credentials:

```ini
WEB_ORIGIN=http://localhost:3000
STRIPE_MODE=test
STRIPE_SECRET_KEY="sk_test_..."
# Printed by `stripe listen` when it starts. New value each session.
STRIPE_WEBHOOK_SECRET="whsec_..."
```

Delete the old `BETTER_AUTH_URL` line while you are in there; leaving it is harmless and
misleading, which is the pair of properties that keeps a stale key alive for years.

```bash
pnpm cf-typegen
```

### The schema module

A new module directory, not a line in someone else's:

```bash
mkdir -p src/schema/payments
cat > src/schema/payments/schema.graphql <<'EOF'
type Mutation {
  """
  Creates an embedded Stripe Checkout Session for one fixed test item and returns its
  client secret, which mounts the form in the browser. Exists to prove the payment
  pipeline in production; not part of any feature.
  """
  createTestCheckoutSession: String!
}

type Query {
  """
  The status of a Checkout Session, read back from Stripe by id. The id comes off the
  return URL, so it is a claim until this field checks it — never a fact the browser
  is allowed to assert.
  """
  checkoutSessionStatus(id: ID!): CheckoutStatus!

  """
  Stripe events this API has accepted, newest first. The webhook is the only writer, so
  an empty list means nothing has been delivered — not that nothing has been paid.
  """
  stripeEvents(limit: Int! = 5): [StripeEvent!]!
}

"""
Stripe's three terminal session states, narrowed to an enum so the web layer gets an
exhaustive union rather than a string it has to guess the domain of.
"""
enum CheckoutStatus {
  OPEN
  COMPLETE
  EXPIRED
}

type StripeEvent {
  id: ID!
  type: String!
  """
  ISO 8601, in UTC. A String rather than a scalar, because this schema has no custom
  scalars and one added for a single field is a contract to maintain for a timestamp.
  """
  receivedAt: String!
}
EOF
```

`CheckoutStatus` is this schema's first enum, and the default emission is a real TypeScript
`enum` — a runtime object that every comparison has to import, including from a JSX
expression in another app. One line makes it a union of string literals instead: identical
exhaustiveness, nothing to import, nothing added to either bundle, and a resolver that can
return `"COMPLETE"`.

```diff
--- apps/graphql/codegen.ts
-        typesPluginsConfig: { contextType: "../context#Env" },
+        typesPluginsConfig: {
+          contextType: "../context#Env",
+          // Enums as string-literal unions, not TS enums. A TS enum is a value, so
+          // every `=== CheckoutStatus.Complete` needs an import of a generated module;
+          // the union form compares against "COMPLETE" and erases at build.
+          enumsAsTypes: true,
+        },
```

```bash
pnpm turbo codegen --filter @__PROJECT__/graphql
```

```bash
cat > src/schema/payments/resolvers/Mutation/createTestCheckoutSession.ts <<'EOF'
import { GraphQLError } from "graphql";
import { createStripe } from "./../../../../stripe";
import { requireEnv } from "./../../../../env";
import type { MutationResolvers } from "./../../../types.generated";

// Integer cents, like every amount in this repo — nothing in a money path is a float.
// Inline on the session rather than a Price created in the dashboard: a hand-made
// product is a one-time step no doc can check, and the amount belongs in the repo.
const TEST_ITEM_CENTS = 1900;

export const createTestCheckoutSession: NonNullable<
  MutationResolvers["createTestCheckoutSession"]
> = async (_parent, _arg, ctx) => {
  const origin = requireEnv(ctx, "WEB_ORIGIN");

  const session = await createStripe(ctx).checkout.sessions.create({
    // "embedded_page", not "embedded" — the latter is not a value this API accepts.
    // Verified against the live API on 2026-09-01: `embedded` now returns "The ui_mode
    // value `embedded` is no longer supported. Use `embedded_page` instead."
    // Setting it is what makes client_secret present and url absent.
    ui_mode: "embedded_page",
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: TEST_ITEM_CENTS,
          product_data: { name: "__PROJECT__ test item" },
        },
      },
    ],
    // Where the iframe sends the browser once the attempt is over, one way or the
    // other. There is no cancel_url to pair it with: the API rejects that param on an
    // embedded session, because the form was never a page the visitor could leave.
    // Stripe substitutes the real id for the template before redirecting.
    return_url: `${origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
    // redirect_on_completion is left at its default, "always". The alternative is
    // "never" plus an onComplete callback in the browser — which would make a
    // client-side event the only completion signal, and this slice's whole position is
    // that the browser is not what proves a payment.
  });

  // Typed nullable because a hosted session has no client secret. This one is embedded,
  // so a null here means something changed rather than something is optional.
  if (!session.client_secret) {
    throw new GraphQLError(
      "Stripe returned an embedded session with no client secret",
    );
  }
  return session.client_secret;
};
EOF
cat > src/schema/payments/resolvers/Query/checkoutSessionStatus.ts <<'EOF'
import { GraphQLError } from "graphql";
import { createStripe } from "./../../../../stripe";
import type { QueryResolvers } from "./../../../types.generated";

// Stripe's status strings are typed as a union widened with `string` (the SDK spells it
// OtherString), so this switch is the narrowing rather than decoration. An unrecognised
// value is not mapped to a guess: a new terminal state is something to find out about,
// not to render as OPEN.
const STATUS = {
  open: "OPEN",
  complete: "COMPLETE",
  expired: "EXPIRED",
} as const;

/** Read a session back from Stripe by the id on the return URL.
 *
 *  The id arrives in a query string, which makes it a claim: anyone can type one. This
 *  is the sanctioned way to turn it into a fact — ask Stripe — and it is why the return
 *  page does not simply believe a `?paid=true`.
 *
 *  The field is public and returns nothing but the status, deliberately. It is an
 *  oracle for "is this session id complete?", which is worth little against ids that are
 *  unguessable random strings; adding the customer's email to the response is what would
 *  make it worth something to an attacker.
 */
export const checkoutSessionStatus: NonNullable<
  QueryResolvers["checkoutSessionStatus"]
> = async (_parent, { id }, ctx) => {
  let status: string | null;
  try {
    ({ status } = await createStripe(ctx).checkout.sessions.retrieve(id));
  } catch (cause) {
    // Stripe's message names the id and the account. Logged, not returned.
    console.error("[stripe] could not retrieve session", cause);
    throw new GraphQLError("No such Checkout Session");
  }

  const known = status && STATUS[status as keyof typeof STATUS];
  if (!known) {
    throw new GraphQLError(
      `Unhandled Checkout Session status ${String(status)}`,
    );
  }
  return known;
};
EOF
cat > src/schema/payments/resolvers/Query/stripeEvents.ts <<'EOF'
import { createDb, desc, stripeEvent } from "@__PROJECT__/db";
import type { QueryResolvers } from "./../../../types.generated";

// A ceiling the caller cannot raise. The SDL's default is a default, not a limit, and
// this field is public — `stripeEvents(limit: 100000)` is otherwise a free table scan.
const MAX_ROWS = 50;

export const stripeEvents: NonNullable<QueryResolvers["stripeEvents"]> = async (
  _parent,
  { limit },
  ctx,
) => {
  const db = createDb(ctx.HYPERDRIVE.connectionString);
  const rows = await db
    .select()
    .from(stripeEvent)
    .orderBy(desc(stripeEvent.receivedAt))
    .limit(Math.min(Math.max(limit, 1), MAX_ROWS));

  // Converted here rather than left to JSON.stringify on a Date, which produces the
  // same string today by coincidence rather than by contract.
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    receivedAt: row.receivedAt.toISOString(),
  }));
};
EOF
```

### The integration test

The unit tests above cover every path that is refused. What only a real Worker and a real
database can show is the accepted one — and that the second copy of an event changes nothing.

```bash
cat > src/stripe-webhook.int.test.ts <<'EOF'
import Stripe from "stripe";
import { expect, test } from "vitest";
import { createDb, eq, stripeEvent } from "@__PROJECT__/db";
import worker, { type Env } from "./index";

const DOCKER_URL = "postgres://postgres:postgres@localhost:5434/__PROJECT__";
const CONNECTION = process.env.DATABASE_URL ?? DOCKER_URL;
const SECRET = "whsec_integration_test_secret_not_used_anywhere_else";

// Values in code, not in a gitignored env file a fresh clone does not have.
const env = {
  HYPERDRIVE: { connectionString: CONNECTION },
  STRIPE_MODE: "test",
  STRIPE_SECRET_KEY: "sk_test_never_calls_stripe_in_this_file",
  STRIPE_WEBHOOK_SECRET: SECRET,
} as unknown as Env;

// Nothing here reaches the network. Verifying a signature is HMAC over the body and the
// secret, computed locally; the client exists only to hold that code.
const stripe = new Stripe("sk_test_never_calls_stripe_in_this_file");

const sign = (payload: string) =>
  stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });

const deliver = (body: string, signature: string) =>
  worker.fetch(
    new Request("http://localhost/stripe/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      body,
    }),
    env,
  );

const event = (id: string) =>
  JSON.stringify({
    id,
    object: "event",
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_integration" } },
  });

async function rowsFor(id: string) {
  const db = createDb(CONNECTION);
  try {
    return await db.select().from(stripeEvent).where(eq(stripeEvent.id, id));
  } finally {
    // createDb hides the Pool; drizzle re-exposes it as $client. Without this the open
    // handle keeps vitest from exiting.
    await db.$client.end();
  }
}

async function forget(id: string) {
  const db = createDb(CONNECTION);
  try {
    await db.delete(stripeEvent).where(eq(stripeEvent.id, id));
  } finally {
    await db.$client.end();
  }
}

test("a signed delivery is recorded once, however many times it arrives", async () => {
  const id = `evt_int_${process.pid}_${Date.now()}`;
  const payload = event(id);

  try {
    const first = await deliver(payload, sign(payload));
    expect(await first.json()).toEqual({ received: true, duplicate: false });

    // What a retry looks like: Stripe resends the same body under the same event id.
    const second = await deliver(payload, sign(payload));
    expect(await second.json()).toEqual({ received: true, duplicate: true });

    const rows = await rowsFor(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("checkout.session.completed");
  } finally {
    await forget(id);
  }
});

test("a body that does not match its signature writes nothing", async () => {
  const id = `evt_tampered_${process.pid}_${Date.now()}`;
  const signed = event(id);
  // Signed as one event, delivered as another — the exact attack the signature exists
  // for, and the reason the raw bytes are never re-serialised on the way in.
  const tampered = signed.replace("checkout.session.completed", "invoice.paid");

  const res = await deliver(tampered, sign(signed));

  expect(res.status).toBe(400);
  expect(await rowsFor(id)).toHaveLength(0);
});
EOF
```

## apps/web

Nothing here imports `stripe`, and nothing should: the secret key is a secret and this app has
no Hyperdrive binding to record anything with. What it does now import is the _other_ pair of
packages — the browser half, which holds no key it did not get from a public var.

```bash
cd ../web
pnpm add @stripe/stripe-js @stripe/react-stripe-js
```

`@stripe/stripe-js` is a loader, not a copy of Stripe.js: it injects the script from
`js.stripe.com` at runtime. That is not an optimisation to undo — self-hosting or bundling
that script takes you out of the PCI posture the iframe exists to provide, and Stripe say so
outright.

### The publishable key

```bash
cat > src/lib/stripe.ts <<'EOF'
import { loadStripe } from "@stripe/stripe-js";

/** Assert the public key is a public key.
 *
 *  Not a mode check, unlike the API's. A publishable key cannot move money, so a
 *  pk_live_ shipped in a test build is a form that refuses to load — loud, immediate,
 *  and free. The mistake worth catching here is the opposite one and it is silent:
 *  pasting an sk_ key into a NEXT_PUBLIC_ var hands a key that can charge cards to
 *  everyone who views source, and nothing else in the stack would notice.
 *
 *  The message never echoes the value, for the case where the value is the secret.
 */
export function assertPublishableKey(key: string | undefined): string {
  if (!key) {
    throw new Error("Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
  }
  if (!key.startsWith("pk_")) {
    throw new Error(
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must begin pk_ — never a secret key",
    );
  }
  return key;
}

/** Module scope and exactly once, which is Stripe's own instruction: loadStripe injects
 *  a script tag, and calling it inside a render would re-run that on every render.
 *
 *  The literal member expression is the only form `next build` inlines — see the web
 *  skill. It also means this value is fixed at build time rather than read from the
 *  Worker's env, so changing keys is a rebuild, not a `wrangler secret put`.
 */
export const stripePromise = loadStripe(
  assertPublishableKey(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
);
EOF
cat > src/lib/stripe.test.ts <<'EOF'
import { expect, test } from "vitest";
import { assertPublishableKey } from "./stripe";

test("a publishable key passes, test and live alike", () => {
  expect(assertPublishableKey("pk_test_abc")).toBe("pk_test_abc");
  expect(assertPublishableKey("pk_live_abc")).toBe("pk_live_abc");
});

// The one that matters. A secret key here would be served to every visitor.
test("a secret key in the public var is refused", () => {
  expect(() => assertPublishableKey("sk_test_abc")).toThrow("never a secret key");
  expect(() => assertPublishableKey("rk_live_abc")).toThrow("never a secret key");
});

// What an un-inlined NEXT_PUBLIC_ var actually looks like in the browser.
test("an unset key names the variable rather than failing at mount", () => {
  expect(() => assertPublishableKey(undefined)).toThrow(
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  );
  expect(() => assertPublishableKey("")).toThrow("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
});
EOF
```

Module scope is the catch that only shows up when the test runs: importing this file to test
`assertPublishableKey` also evaluates `stripePromise`, which calls that same guard. Vitest
reads no env file and does no `next build` inlining, so the key is `undefined` and the
module throws before a single test is collected. The unit project supplies one:

```diff
--- apps/web/vitest.config.ts
           name: "unit",
           include: ["src/**/*.test.ts"],
           exclude: ["**/*.int.test.ts"],
+          // src/lib/stripe.ts calls loadStripe at module scope behind the same guard
+          // it exports, so importing it to test that guard runs it. Vitest reads no
+          // env file, and next build's inlining is not in play here -- without a
+          // value the module throws before a single test is collected.
+          //
+          // A literal pk_test_ key and not the real one: nothing here reaches Stripe,
+          // and a test that needs a credential is a test a fresh clone cannot run.
+          env: {
+            NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
+              "pk_test_unit_tests_never_call_stripe",
+          },
         },
```

A dummy key and not the real one, for the reason the integration test keeps its connection
string in code: a test that needs a credential is a test a fresh clone cannot run.

The key must reach `next build`, not the Worker, so it goes in web's env files:

**Append to `.env.example`, do not `cat >` over it.** The heredoc below is written as a
replacement, and by Slice 7 that file already carries `CLOUDFLARE_ACCOUNT_ID` from Slice 1 —
which `deploy:production` reads through wrangler's `--env-file`. Recreating the file deletes
it, nothing fails at the local gate, and the next production deploy is the first thing to
notice. Merge the new key into whatever is there, and check what the file already says about
the mode split before restating it: a project built through Slice 6 may already have
`.env.development` / `.env.production` and no `.env.local`, in which case only the publishable
key below is new.

```diff
--- apps/web/.env.example
 # Which Cloudflare account the Worker is uploaded to. `wrangler whoami` lists
 # yours. Deliberately not in .env.development: the deploy target is not a value
 # your machine gets to supply, and the two may be different accounts.
 CLOUDFLARE_ACCOUNT_ID=
+
+# Public by design - the half of the key pair meant to be read by anyone. Belongs in
+# BOTH .env.development and .env.production, because `next dev` reads the first and
+# `next build` - so `pnpm preview` and `pnpm deploy:production` alike - reads the
+# second. Inlined by `next build`, which makes it a build input and not a runtime one:
+# changing it needs a rebuild and redeploy, unlike every secret in apps/graphql. Keep
+# it a pk_test_ key here; see the payments skill.
+NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_dev_only_not_a_real_key
```

A `diff` hunk and not a `cat >` or `cat >>`, for two reasons that both cost a run to learn.
A whole-file rewrite deletes `CLOUDFLARE_ACCOUNT_ID`, which Slice 1 put there and
`deploy:production` still reads — and nothing fails until the next deploy. A `cat >>` append
fixes that but is invisible to `docs:check`, which parses only whole-file heredocs and diff
hunks, so the file would drift silently from here on. The hunk is the only form that both
preserves what is there and stays checkable.

`.env.example` is rewritten rather than extended, because this slice also splits the files
it describes. `apps/web` had one `.env.local`; it now has `.env.development` and
`.env.production`, and the reason is a load order that is easy to get backwards:

```
process.env  >  .env.<mode>.local  >  .env.local  >  .env.<mode>  >  .env
```

`.env.local` is read in **every** mode except `test`, and it sits **above** `.env.<mode>`.
So a key in `.env.local` beats the same key in `.env.production` during a production build —
`.env.production` is silently ignored, and the symptom is a wrong bundle rather than an
error. Verified against `@next/env`'s own loader, not recalled:

```js
const mode = isTest ? "test" : dev ? "development" : "production";
const files = [
  `.env.${mode}.local`,
  mode !== "test" && `.env.local`,
  `.env.${mode}`,
  ".env",
];
```

One file per mode has no such rank to lose. Create both by hand — they are gitignored and
hold an account-specific key:

```ini
# apps/web/.env.development — next dev only
NEXTJS_ENV=development
NEXT_PUBLIC_APP_ENV=local
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_..."
```

```ini
# apps/web/.env.production — pnpm preview AND pnpm deploy:production
NEXT_PUBLIC_APP_ENV=local
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_..."
```

What this does **not** buy is a preview/deploy split: both run `next build`, so both are
`production` and read the same file. Nothing named `.env.*` can separate them — only
`process.env`, which is what `deploy:production` already uses for `NEXT_PUBLIC_APP_ENV`.
That is why the key here stays `pk_test_`: the live key belongs to whatever runs the deploy,
and a live key in a working copy is a live payment form on `localhost`. Going live is
therefore a CI concern, and CI is a slice this scaffold has not built.

Delete `apps/web/.env.local` while you are here. Leaving it is worse than untidy — it
outranks both new files and would quietly reinstate the problem they exist to remove.

### The server action

```bash
cat > src/app/actions.ts <<'EOF'
"use server";

import { graphql } from "@/generated";
import { graphqlFetch } from "@/lib/api";

const CreateTestCheckoutSession = graphql(`
  mutation CreateTestCheckoutSession {
    createTestCheckoutSession
  }
`);

/** Create a Checkout Session and hand its client secret to the embedded form.
 *
 *  A server action rather than a route handler: graphqlFetch runs in this Worker, where
 *  the API service binding is, and Stripe's `fetchClientSecret` option wants exactly a
 *  `() => Promise<string>` — which is what a server action imported into a client
 *  component already is. No route, no JSON envelope, no second place to keep in sync.
 *
 *  It throws rather than returning a sentinel because a rejected promise is the only
 *  failure shape Stripe.js understands here; the caller turns that into something on
 *  screen.
 */
export async function fetchCheckoutClientSecret(): Promise<string> {
  const res = await graphqlFetch(CreateTestCheckoutSession);
  const clientSecret = res.data?.createTestCheckoutSession;

  if (!clientSecret) {
    // The API's message is for the log. The visitor gets the caller's sentence.
    console.error("createTestCheckoutSession failed", res.errors);
    throw new Error("Could not start checkout");
  }
  return clientSecret;
}
EOF
cat > src/app/actions.test.ts <<'EOF'
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  result: {} as { data?: { createTestCheckoutSession: string }; errors?: unknown[] },
}));
vi.mock("@/lib/api", () => ({ graphqlFetch: () => Promise.resolve(mocks.result) }));

const { fetchCheckoutClientSecret } = await import("./actions");

test("returns the client secret the API minted", async () => {
  mocks.result = { data: { createTestCheckoutSession: "cs_test_secret" } };

  await expect(fetchCheckoutClientSecret()).resolves.toBe("cs_test_secret");
});

// Stripe.js only reacts to a rejection, and the API's own message must not be the one
// that travels — it is written for us, not for whoever is holding a card.
test("a failed session rejects without surfacing the API's message", async () => {
  mocks.result = { errors: [{ message: "Stripe refused the request" }] };

  await expect(fetchCheckoutClientSecret()).rejects.toThrow("Could not start checkout");
});
EOF
```

### The event timestamp

The panel says _which_ event landed; the row it was written in also knows _when_. That is a
formatter, and formatters here are tested functions rather than string surgery in a page —
`formatPrice` set the precedent.

```bash
cat > src/lib/formatUtc.ts <<'EOF'
/** Render an ISO 8601 instant as a UTC wall clock, with the zone said out loud.
 *
 *  UTC and not the visitor's zone, for the reason the UI rules give: this renders in a
 *  server component, and the visitor's offset is a value that only exists after mount.
 *  The trailing Z is not decoration — without it the string reads as local time and is
 *  wrong by however far the reader sits from Greenwich.
 *
 *  An unparseable value comes back untouched rather than as "Invalid Date". The field is
 *  a String in the SDL, so this is the one place that assumption is checked, and a
 *  diagnostic panel showing a strange timestamp is better than one showing nothing.
 */
export function formatUtc(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${at.toISOString().slice(0, 19).replace("T", " ")}Z`;
}
EOF
cat > src/lib/formatUtc.test.ts <<'EOF'
import { expect, test } from "vitest";
import { formatUtc } from "./formatUtc";

test("renders an ISO instant as a UTC wall clock", () => {
  expect(formatUtc("2026-08-09T07:53:46.125Z")).toBe("2026-08-09 07:53:46Z");
});

// The reason the Z is in the output. A reader east of Greenwich seeing "07:53:46" with
// no zone reads their own clock and concludes the webhook landed hours ago.
test("keeps the instant in UTC rather than the running machine's zone", () => {
  expect(formatUtc("2026-08-09T23:30:00.000+08:00")).toBe("2026-08-09 15:30:00Z");
});

test("a value that is not a date is returned untouched, never Invalid Date", () => {
  expect(formatUtc("not a timestamp")).toBe("not a timestamp");
  expect(formatUtc("")).toBe("");
});
EOF
```

UTC rather than the visitor's zone is forced by the layer, not chosen for taste: the home
page is a server component, and an offset that only exists after mount is precisely the
hydration trap `code-ui` names. Spelling the zone out in the output is what keeps the value
honest for a reader who is not on UTC.

### The checkout route

The form is a client component because Stripe.js is a browser API; the page around it stays a
server component, so the only JavaScript this route ships is the wrapper and the loader.

```bash
mkdir -p src/app/checkout/return
cat > src/app/checkout/checkout-form.tsx <<'EOF'
"use client";

import { useCallback, useState } from "react";
import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from "@stripe/react-stripe-js";
import { stripePromise } from "@/lib/stripe";
import { fetchCheckoutClientSecret } from "../actions";

/** Stripe's form, in an iframe, on our origin.
 *
 *  The iframe is Stripe's page: it does not inherit this app's theme tokens and will not
 *  follow the mode toggle, because embedded Checkout is styled from the account's
 *  branding settings in the dashboard rather than from anything sent per session.
 */
export function CheckoutForm() {
  const [failed, setFailed] = useState(false);

  // useCallback because this component has state: a new function identity on the
  // re-render would be a second option object, and the provider takes fetchClientSecret
  // once and ignores later ones.
  const fetchClientSecret = useCallback(
    () =>
      fetchCheckoutClientSecret().catch((cause: unknown) => {
        // Stripe renders nothing useful for a rejected fetch, so the page has to say
        // it. Rethrown anyway: the provider still needs to know it failed.
        console.error(cause);
        setFailed(true);
        throw cause;
      }),
    [],
  );

  if (failed) {
    return (
      <p role="alert" className="text-destructive text-sm">
        Could not start checkout. Reload the page to try again.
      </p>
    );
  }

  return (
    <EmbeddedCheckoutProvider stripe={stripePromise} options={{ fetchClientSecret }}>
      <EmbeddedCheckout />
    </EmbeddedCheckoutProvider>
  );
}
EOF
cat > src/app/checkout/page.tsx <<'EOF'
import { CheckoutForm } from "./checkout-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// max-w-xl, wider than the home card's max-w-md: the embedded form is Stripe's layout
// and it crowds itself below about 28rem. The card is here for the page to have edges,
// not to constrain the iframe.
export default function CheckoutPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>__PROJECT__ test item</CardTitle>
        </CardHeader>
        <CardContent>
          <CheckoutForm />
        </CardContent>
      </Card>
    </main>
  );
}
EOF
cat > src/app/checkout/return/outcome.ts <<'EOF'
import type { CheckoutStatus } from "@/generated/graphql";

/** What the return card says, as data rather than JSX.
 *
 *  Separated from the page for two reasons: the page becomes a layout with no copy
 *  decisions in it, and the copy becomes testable without a DOM — which matters here
 *  more than most places, because the difference between two of these strings is the
 *  difference between thanking someone and telling them their card was declined.
 */
export type Outcome = {
  title: string;
  body: string;
  /** Where the single button goes. A failed attempt belongs back at the form; a
   *  successful one has nothing left to do on this page. */
  href: string;
  cta: string;
  /** The ARIA role on the body. Confirmations are announced politely; only a checkout
   *  this app could not read is worth interrupting a screen reader for. */
  role: "status" | "alert";
};

/** A `Record` keyed by the generated enum, not a chain of ternaries. Adding a fourth
 *  value to the SDL's `CheckoutStatus` stops this file compiling, where a ternary chain
 *  would have quietly rendered the last branch for it.
 */
export const OUTCOMES: Record<CheckoutStatus, Outcome> = {
  // Stripe reported this session complete when we asked it directly, so the thanks is
  // a fact about Stripe rather than about the browser that arrived here. What it does
  // not claim is that this stack has recorded anything — the webhook writes the row on
  // the home page, and that is a separate sentence we do not owe the customer.
  COMPLETE: {
    title: "Thank you",
    body: "Your payment is complete. Nothing more is needed from you.",
    href: "/",
    cta: "Back to __PROJECT__",
    role: "status",
  },
  // A visitor lands here on a decline too, and the session is still open. Saying so
  // plainly is the whole reason this page reads the status instead of assuming that
  // arriving means paying.
  OPEN: {
    title: "Nothing was charged",
    body: "The payment did not go through. You can try again.",
    href: "/checkout",
    cta: "Try again",
    role: "status",
  },
  EXPIRED: {
    title: "Nothing was charged",
    body: "That checkout expired before it was completed.",
    href: "/checkout",
    cta: "Start again",
    role: "status",
  },
};

/** No id on the URL, or Stripe would not tell us about the one there was.
 *
 *  Deliberately says nothing either way about money: the resolver throws the same error
 *  for an id that never existed and for a call that failed, so this text has to be true
 *  of both.
 */
export const UNREADABLE: Outcome = {
  title: "We could not check that payment",
  body: "This checkout could not be confirmed. Try again from the store.",
  href: "/",
  cta: "Back to __PROJECT__",
  role: "alert",
};
EOF
cat > src/app/checkout/return/outcome.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { OUTCOMES, UNREADABLE } from "./outcome";

// The Record's key type already makes this exhaustive at compile time. What a test can
// still hold is the meaning of the strings, which is the part an edit can get wrong
// while everything still compiles.
describe("checkout return copy", () => {
  it("thanks the visitor for COMPLETE and for nothing else", () => {
    expect(OUTCOMES.COMPLETE.title).toMatch(/thank/i);
    // A declined card lands on this page too, with the session still OPEN. Thanking
    // there is the failure this whole page exists to avoid.
    for (const outcome of [OUTCOMES.OPEN, OUTCOMES.EXPIRED, UNREADABLE]) {
      expect(`${outcome.title} ${outcome.body}`).not.toMatch(/thank/i);
    }
  });

  it("says plainly that a failed attempt cost nothing", () => {
    expect(OUTCOMES.OPEN.body).toMatch(/did not go through/i);
    expect(OUTCOMES.OPEN.title).toMatch(/nothing was charged/i);
    expect(OUTCOMES.EXPIRED.title).toMatch(/nothing was charged/i);
    // Not the unreadable case: this app does not know either way there, and a
    // reassurance it cannot support is worse than none.
    expect(UNREADABLE.title).not.toMatch(/nothing was charged/i);
  });

  it("sends a failed attempt back to the form and a paid one home", () => {
    expect(OUTCOMES.OPEN.href).toBe("/checkout");
    expect(OUTCOMES.EXPIRED.href).toBe("/checkout");
    expect(OUTCOMES.COMPLETE.href).toBe("/");
  });

  it("interrupts a screen reader only when the checkout could not be read", () => {
    expect(UNREADABLE.role).toBe("alert");
    for (const outcome of Object.values(OUTCOMES)) {
      expect(outcome.role).toBe("status");
    }
  });
});
EOF
cat > src/app/checkout/return/page.tsx <<'EOF'
import Link from "next/link";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { LoaderCircle } from "lucide-react";
import { graphql } from "@/generated";
import { graphqlFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OUTCOMES, UNREADABLE, type Outcome } from "./outcome";

const CheckoutStatusQuery = graphql(`
  query CheckoutStatus($id: ID!) {
    checkoutSessionStatus(id: $id)
  }
`);

/** Where Stripe sends the browser once the attempt is over — successful or not.
 *
 *  The session id arrives in the query string, so it is a claim. The status comes from
 *  asking Stripe, never from a parameter: a page that believed `?paid=true` would be a
 *  page anyone could talk into saying "paid".
 *
 *  Nothing in this component awaits, and that is the point. Stripe's iframe hands the
 *  browser a top-level navigation, and until this Worker sends a byte the visitor is
 *  still looking at the payment form they have already finished with — a Stripe API
 *  round trip spent staring at the thing they just completed. Keeping the shell
 *  synchronous means the card paints in the first chunk and only the sentence inside it
 *  waits.
 */
export default function CheckoutReturn({
  searchParams,
}: PageProps<"/checkout/return">) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        {/* searchParams is a promise and is passed on unread. Awaiting it here would
            pull the dynamic access above the boundary and there would be no shell left
            to stream. */}
        <Suspense fallback={<Confirming />}>
          <Confirmed searchParams={searchParams} />
        </Suspense>
      </Card>
    </main>
  );
}

/** The card's contents, in one place, so the pending state and the four outcomes are
 *  the same shape and — because the button's box is always occupied — the same height.
 *  A centred card that grows when the status lands would move under a cursor already on
 *  its way to the button. */
function Message({
  title,
  action,
  children,
}: {
  title: string;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      {/* No text-sm: Card already sets it on the root and every child inherits. */}
      <CardContent className="grid gap-4">
        {children}
        {action}
      </CardContent>
    </>
  );
}

/** What the visitor sees while the status is still in flight — which is the only thing
 *  on this page they should ever have to wait for. */
function Confirming() {
  return (
    <Message
      title="Confirming your payment"
      // The button's box, held empty. `Button`'s default size is h-8, so the card is
      // the same height before and after the status arrives.
      action={<div className="h-8" />}
    >
      <p role="status" className="text-muted-foreground flex items-center gap-2">
        {/* aria-hidden because the sentence beside it already says this to a screen
            reader, and a spinning icon has nothing to add to that. */}
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        Checking with Stripe — a moment.
      </p>
    </Message>
  );
}

/** The half of the page that suspends: one read-back from Stripe, turned into copy.
 *
 *  A COMPLETE here is a statement about Stripe's session, not about this stack: the
 *  event row on the home page is written by the webhook, and that is what proves the
 *  payment was recorded rather than merely taken.
 */
async function Confirmed({
  searchParams,
}: {
  searchParams: PageProps<"/checkout/return">["searchParams"];
}) {
  const id = (await searchParams).session_id;
  const res =
    typeof id === "string"
      ? await graphqlFetch(CheckoutStatusQuery, { id })
      : undefined;

  const status = res?.data?.checkoutSessionStatus;
  const outcome: Outcome = status ? OUTCOMES[status] : UNREADABLE;

  return (
    <Message
      title={outcome.title}
      action={
        // nativeButton={false} for the reason the home page's link-button carries it:
        // render produces an <a>, and the primitive defaults to native button
        // semantics.
        <Button
          render={<Link href={outcome.href} />}
          nativeButton={false}
          variant="secondary"
        >
          {outcome.cta}
        </Button>
      }
    >
      <p
        role={outcome.role}
        className={outcome.role === "alert" ? "text-destructive" : undefined}
      >
        {outcome.body}
      </p>
    </Message>
  );
}
EOF
```

The return page is split in two, and the seam is a `<Suspense>` boundary rather than a
component-size preference. Stripe's iframe finishes by handing the browser a top-level
navigation, so until this Worker sends its first byte the visitor is still looking at the
payment form they have just completed — a web-to-API-to-Stripe round trip spent staring at
the thing they thought they were done with. Nothing above the boundary awaits, `searchParams`
is passed on as a promise rather than unwrapped, and the card paints in the first chunk while
only the sentence inside it waits. Measured against the production build on workerd: shell at
+0ms, outcome at +200ms.

The copy lives in `outcome.ts` as data, not JSX, for the reason the next paragraph gives — the
difference between two of those strings is the difference between thanking someone and telling
them their card was declined, and that is worth a test that needs no DOM. A `Record` keyed by
the generated enum keeps it exhaustive: a fourth `CheckoutStatus` stops the file compiling.

`OPEN` is a state the hosted flow did not have to render: there, a visitor who abandoned or
had a card declined came back through `cancel_url`. Embedded has no `cancel_url`, so a decline
lands here with the session still open — and a page that said "payment sent" to a declined
card would be a wrong statement on screen, which is the one thing this project's UI rules do
not tolerate.

The home page keeps the status panel and gains a link, not a form — starting checkout is now
navigation, and the payment happens on the route it goes to:

```diff
--- apps/web/src/app/page.tsx
+import Link from "next/link";
 import { graphqlFetch } from "@/lib/api";
 import { graphql } from "@/generated";
+import { formatUtc } from "@/lib/formatUtc";
 import { ModeToggle } from "@/components/mode-toggle";
 import { AuthPanel } from "@/components/auth-panel";
+import { Button } from "@/components/ui/button";
 import {
   Card,
   CardAction,
@@
     viewer {
       email
     }
+    stripeEvents(limit: 1) {
+      type
+      receivedAt
+    }
   }
 `);

@@
 // binding in production and to the local Worker in dev. Nothing reaches the browser.
 export default async function Home() {
   const res = await graphqlFetch(HomeQuery);
+  // Lifted out of the JSX because it is read three times below, and an optional chain
+  // repeated three times does not narrow — this does.
+  const lastEvent = res.data?.stripeEvents[0];

   return (
     <main className="flex flex-1 items-center justify-center p-6">
@@
                   the same session in the browser; the two agreeing is the proof. */}
               <dt className="text-muted-foreground">viewer</dt>
               <dd>{res.data?.viewer?.email ?? "signed out"}</dd>
+              {/* Written by the webhook and by nothing else, so "none yet" means no
+                  signed delivery has arrived — not that no one has paid. */}
+              <dt className="text-muted-foreground">last stripe event</dt>
+              {/* wrap-anywhere because this is the one value in the panel that is
+                  wider than its column: `checkout.session.completed` measures 218px in
+                  a 179px grid track, so without it the type overruns the card's right
+                  padding. `anywhere` and not `break-all` — it breaks only the value
+                  that has to break, and leaves the short ones intact if they grow. */}
+              <dd className="wrap-anywhere">
+                {lastEvent ? (
+                  <>
+                    {lastEvent.type}
+                    {/* The time the webhook wrote the row, not the time Stripe made the
+                        event — this panel reports what this stack did. UTC, because the
+                        visitor's offset only exists after mount and this is a server
+                        component. */}
+                    <span className="text-muted-foreground block">
+                      {formatUtc(lastEvent.receivedAt)}
+                    </span>
+                  </>
+                ) : (
+                  "none yet"
+                )}
+              </dd>
             </dl>
           )}
         </CardContent>
         {/* No padding or border added here: CardFooter already carries both
-            (`border-t p-(--card-spacing)`). The wrapper only stretches the panel to the
-            footer's width, since CardFooter is a flex row. */}
+            (`border-t p-(--card-spacing)`). The wrapper stretches its children to the
+            footer's width, since CardFooter is a flex row, and stacks them. */}
         <CardFooter>
-          <div className="w-full">
+          <div className="grid w-full gap-3">
             <AuthPanel />
+            {/* A link, not a form: the payment form lives on /checkout, and getting
+                there is navigation. `render` rather than asChild — this Button is Base
+                UI, whose composition prop is render. `nativeButton={false}` because what
+                render produces here is an <a>: left at its default the primitive applies
+                native button semantics to an element that is not one, and says so. No
+                notice slot here either, since the return page owns everything there is
+                to say about an attempt. */}
+            <Button
+              render={<Link href="/checkout" />}
+              nativeButton={false}
+              variant="secondary"
+            >
+              Buy the test item
+            </Button>
           </div>
         </CardFooter>
       </Card>
```

The same enum decision has to be made on this side too — the two presets do not share a
config, and a TS enum here would mean importing a generated value into the page just to write
three equality checks:

```diff
--- apps/web/codegen.ts
-      config: { documentMode: "string" },
+      // enumsAsTypes mirrors apps/graphql's setting. The two configs are independent, so
+      // this is a decision made twice rather than one inherited; setting it on only one
+      // side gives a resolver returning "COMPLETE" and a page comparing an enum member.
+      config: { documentMode: "string", enumsAsTypes: true },
```

```bash
pnpm turbo codegen --filter @__PROJECT__/web
```

## Local gate

Docker up, both dev servers running, and the Stripe CLI forwarding. Install it once with
`npm install -g @stripe/cli`, then `stripe login`.

```bash
cd ../..
stripe listen --events checkout.session.completed \
  --forward-to localhost:8787/stripe/webhook
```

`--events`, and not a bare `stripe listen`, for the reason step 4 subscribes the deployed
endpoint to one type: without it the CLI forwards everything, and one
`stripe trigger checkout.session.completed` is a six-event cascade —
`charge.succeeded`, two `payment_intent.*`, the session, then `charge.updated` a few seconds
later. All six are recorded, because this handler is deliberately type-agnostic, so the
newest row is `charge.updated` and the table below would read as a failure when nothing
failed. Filtering here makes local match production.

It prints `Your webhook signing secret is whsec_…`. Put that in `apps/graphql/.env.development` and
**restart `wrangler dev`** — the env file is read at startup, so a running Worker keeps the
old value and rejects every delivery with a 400 that looks exactly like a real forgery.

**Better: take the secret before either process starts.** `stripe listen --print-secret`
prints the same value without opening a forwarder, because the CLI's secret is stable per
account and device rather than per run. Writing it into `.env.development` first and only then
starting `wrangler dev` removes the restart step and the 400 that follows forgetting it:

```bash
stripe listen --print-secret        # whsec_… — the same value every run
```

Forward to `:8787` and not `:3000`: the webhook goes to the API Worker directly, which is the
whole point of it not being behind the proxy.

`:8787` is also not negotiable: `apps/web/src/lib/api.ts` hardcodes it for `next dev`, so a
second `wrangler dev` already holding the port sends this one to `:8788` and the browser
keeps talking to the stale Worker while every delivery lands nowhere. If deliveries vanish,
check `ss -ltnp | grep 8787` names the Worker you just started.

| Where      | Check                                                  | Expect                                                                       |
| ---------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| browser    | `localhost:3000`                                       | `last stripe event` reads `none yet`; the link is there                      |
| browser    | **Buy the test item**                                  | `/checkout`, Stripe's form inline, address bar still `:3000`                 |
| browser    | the form's iframe                                      | `$19.00`, one line item                                                      |
| terminal   | `stripe trigger checkout.session.completed`            | one `200` in `stripe listen`, and one new row                                |
| browser    | `/checkout/return?session_id=<that trigger's session>` | "Thank you" — the `COMPLETE` branch, with no card typed                      |
| browser    | `/checkout/return?session_id=<any still-open session>` | "Nothing was charged" — the `OPEN` branch, likewise                          |
| terminal   | the same event replayed from the Stripe CLI            | `"duplicate":true`, and **no** second row                                    |
| terminal   | `curl -X POST localhost:8787/stripe/webhook -d '{}'`   | `400`, and nothing written                                                   |
| browser    | `/checkout/return?session_id=cs_test_nonsense`         | the red "Could not read that checkout", not a crash                          |
| `apps/web` | `pnpm preview --port 3000`                             | same under workerd                                                           |
| root       | `pnpm typecheck`                                       | pass                                                                         |
| root       | **`pnpm lint`**                                        | **`6 successful`** — unchanged from Slice 6                                  |
| root       | **`pnpm test:unit`**                                   | **+8 in graphql, +12 in web** over the baseline you measured before starting |
| root       | **`pnpm test:integration`**                            | **+2** over that same baseline                                               |

**The two card-entry rows are not on this table, and that is deliberate.** Paying with
`4242 4242 4242 4242` and being declined with `4000 0000 0000 9995` are Round 3 steps handed
to a person: this skill's own rule is never to enter a payment detail itself, test card or
not. They are not lost — everything they would prove about the _return page_ is provable
without a card, which is what the two `checkout/return?session_id=` rows above do. A
`stripe trigger` produces a real `complete` session, and any session created and abandoned is
`open`; loading the return page with each id exercises `checkoutSessionStatus`, the enum
mapping and both copy branches. What only a card proves is Stripe's own form submitting, and
that is the part a person should watch anyway.

**Measure the baseline before running any of this, and do not inherit a total.** Earlier
versions of this slice carried absolute figures that were wrong twice over: they assumed a
Slice 6 leaving 40 unit tests where a real one left 39, and they counted this slice's own new
web tests as 8 when the files it writes hold 12 (`stripe` 3, `actions` 2, `formatUtc` 3,
`outcome` 4). A gate whose number is wrong is worse than one with no number, because the run
that matches it is indistinguishable from the run that does not.

Row ten is the one worth doing by hand. Every other row exercises the happy path with a
correct signature attached by Stripe's own tooling; this is the only one that asks what
happens when someone posts to a public URL that writes to your database. Row eleven is its
counterpart for the new public read: `checkoutSessionStatus` takes an id from a stranger.

Rows eight and nine are the pair. A webhook handler that records duplicates looks identical to
a correct one until Stripe's first retry, which happens on their schedule and not yours.

Row seven is new to embedded and cannot be skipped. With no `cancel_url`, a declined card is
the only way to reach the `OPEN` branch of the return page, and that branch is the one that
would otherwise tell someone their failed payment succeeded.

Three things will look wrong and are not. The form does not follow the mode toggle — it is
Stripe's iframe, themed from the account's dashboard branding, not from `theme.css`.
`view-source` on `/checkout` shows the `pk_test_…` key inline; that is what a publishable key
is for. And under `pnpm preview` the card paints with an **empty** form area for several
seconds before the iframe mounts — measured at roughly five under workerd, against under one
in `next dev`. That is latency, not the "fails blank" failure: check the console before
chasing it, because a real key or session failure logs there and this does not.

`preview` runs on port 3000 with `next dev` stopped, for Slice 6's reason: `WEB_ORIGIN` names
`localhost:3000`, and the return URL is built from whatever that says.

Then rerun in a fresh `git clone` with no `.env.development`. This slice adds two Worker secrets, one
build-time public var, and a rename, which is exactly the shape of change that passes only on
the machine that made it — `wrangler types` reads your local env file, so `WorkerEnv` carries
the new keys for you and not for the clone, and `next build` inlines a publishable key the
clone does not have.

## Production gate

Steps 1–4 run once per environment. Steps 5–7 are the gate and re-run on every later deploy
that touches payments.

Every step carries its own `cd` from the repo root rather than relying on one at the top.
`wrangler` and `drizzle-kit` are devDependencies of their packages, so from the root both fail
with `Command not found`; and each reads its config from the working directory, so the
directory decides which Worker a secret attaches to and which database a migration runs
against.

**Stay in test mode for this gate.** Every step below works identically in live mode and
charges a real card at step 7, which is not what a pipeline proof is for.

### 1. Stripe account and API keys — one time

Sign up at [stripe.com](https://stripe.com). No business details or bank account are needed
for test mode. From the dashboard's API keys page, in a sandbox, copy **both** keys this time:
the secret one, beginning `sk_test_`, and the publishable one, beginning `pk_test_`. Embedded
Checkout runs in the browser, so unlike a hosted integration the publishable key is load-
bearing here.

### 2. `WEB_ORIGIN`, `STRIPE_MODE`, and the publishable key — one time

`wrangler.jsonc` ships the slice author's account subdomain, and `BETTER_AUTH_URL` is gone.
Make both yours:

```jsonc
"WEB_ORIGIN": "https://__PROJECT__-web.<your account>.workers.dev",
"STRIPE_MODE": "test"
```

The **web** origin, never this Worker's — it is what Better Auth validates the browser's
`Origin` against, what the verification link is built from, and now where Checkout returns.
Both are `vars`, so they take a redeploy: do this before step 6.

The publishable key does not live here at all. It is a build input, and it goes in the file
the _production_ build reads:

```bash
cd apps/web
echo 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_…' >> .env.production
```

`.env.production`, not `.env.development`: `deploy:production` runs `next build`, which is
mode `production`. Both files carry a `pk_test_` key while this gate stays in test mode, so
they agree — but they are read by different commands, and only this one reaches a deploy.

Both are gitignored. **This is the one credential in the repo that a deploy cannot change** —
it is compiled into the bundle, so rotating it means rebuilding and redeploying web, not
`wrangler secret put`. And because `pnpm preview` is also a production build, it reads this
same file: keep a live key out of it, or the next `pnpm preview` mounts a real payment form
on `localhost`. A live key belongs to whatever runs the deploy, which is CI's job and not a
working copy's.

### 3. `STRIPE_SECRET_KEY` — one time, again only to rotate

```bash
cd apps/graphql
pnpm wrangler secret put STRIPE_SECRET_KEY   # paste the sk_test_… key at the prompt
```

`secret put` also reads **stdin**, which is the better form while the gate is in test mode: it
keeps the key out of the terminal, out of scrollback and out of the clipboard. Pair it with a
guard that asserts the mode rather than trusting it, so a live key cannot flow through even by
accident — the difference between promising not to touch one and making it impossible
(SKILL.md §6). `--env-file .env.production` is what points wrangler at the right Cloudflare
account, exactly as `deploy:production` does.

Interactive because the key is never a file, a flag, or a `vars` entry. Cloudflare stores it
against the Worker and **`wrangler deploy` does not clear it** — do not re-run this before
each deploy. `pnpm wrangler secret list` confirms it without revealing it.

Rotate it in Stripe's dashboard, not here, and then re-run this. A key with `sk_live_` in it
will not start the Worker while step 2 says `test`, which is the guard working.

### 4. The webhook endpoint and its secret — one time

Two settings decide whether this endpoint works, and the dashboard's form asks for them in
two different places: the URL must name the **API** Worker, and the event list must hold
exactly one entry. The CLI states both on one line, which is why it is the path given here —
the same `stripe` binary the local gate already uses, no `listen` involved.

```bash
stripe webhook_endpoints create \
  --url https://__PROJECT__-graphql.<your account>.workers.dev/stripe/webhook \
  --enabled-events checkout.session.completed \
  --description "__PROJECT__ — Slice 7"
```

`__PROJECT__-graphql`, not `__PROJECT__-web`: the webhook does not go through the proxy, for the
reason at the top of this slice. And one `--enabled-events`, not `'*'` — a subscription to
everything delivers account-lifecycle noise to a handler that records each item forever, and
this list is the cheapest place to say what the endpoint is for.

Everything the command does **not** say is a default, and each one is a setting:

| Setting         | What you get                    | Why that is right here                                                                                                                         |
| --------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| mode            | **test** — `--live` switches it | matches step 2's `STRIPE_MODE` and step 3's `sk_test_` key. A live endpoint over a test Worker never delivers anything                         |
| account         | whatever `stripe login` linked  | must be the sandbox step 1's keys came from — see below                                                                                        |
| `--connect`     | omitted → `false`               | events from your own account. `true` is the Connect variant, and delivers other accounts' events to a handler with no notion of whose they are |
| `--api-version` | omitted → the account's default | pinning a version here means payloads stop matching the `stripe` package's types the day the SDK is upgraded                                   |
| status          | enabled                         | there is nothing to switch on afterwards                                                                                                       |

**The account is the one thing the command cannot tell you it got wrong.** `stripe login`
links one account or sandbox, and if step 1's keys came from a different one the endpoint is
created somewhere real — it just is not the somewhere your Worker's secret key belongs to,
and nothing fails until deliveries never arrive. Check before and after:

```bash
stripe config --list                    # which account this CLI is linked to
stripe webhook_endpoints list           # what now exists on it
```

`list` is also the guard against the second-worst outcome: running the create twice leaves
**two** endpoints on the same URL, both delivering, and the secret you stored matches only
one. Every other delivery then fails signature verification, which reads as intermittent
forgery. If you see two, `stripe webhook_endpoints delete we_…` the extra one.

The create response is the `whsec_…`:

```json
{
  "id": "we_1Mr5…",
  "enabled_events": ["checkout.session.completed"],
  "livemode": false,
  "secret": "whsec_…",
  "status": "enabled",
  "url": "https://__PROJECT__-graphql.…workers.dev/stripe/webhook"
}
```

**This response is the only place the API ever shows it.** A later `webhook_endpoints
retrieve` returns the object without `secret`; only the dashboard's endpoint page will reveal
it again. So put it somewhere durable before moving on:

```bash
cd apps/graphql
pnpm wrangler secret put STRIPE_WEBHOOK_SECRET   # paste the whsec_… at the prompt
```

Or skip the clipboard entirely — `wrangler secret put` reads stdin, and the output above is
plain JSON with `--color off`:

```bash
stripe webhook_endpoints create --color off --confirm \
  --url https://__PROJECT__-graphql.<your account>.workers.dev/stripe/webhook \
  --enabled-events checkout.session.completed \
| jq -r .secret \
| pnpm wrangler secret put STRIPE_WEBHOOK_SECRET --cwd apps/graphql
```

Run from the repo root — `--cwd` is what points wrangler at the API Worker's config, doing
the job the `cd` does in the two-step version. Worth it beyond the typing saved: the secret
never lands in a terminal buffer, a clipboard, or scrollback.

<details>
<summary>Doing it in the dashboard instead — every field</summary>

Developers → Webhooks → **Add endpoint**, with the test/live toggle set to **test**:

| Field          | Set it to                                                               |
| -------------- | ----------------------------------------------------------------------- |
| Endpoint URL   | `https://__PROJECT__-graphql.<your account>.workers.dev/stripe/webhook` |
| Listen to      | **Events on your account** — not "Events on Connected accounts"         |
| Events to send | `checkout.session.completed`, and nothing else                          |
| Version        | leave on the account's default API version                              |
| Description    | anything; it is a label                                                 |

Then **Reveal** the signing secret on the endpoint's page and `wrangler secret put` it as
above. The dashboard is also where you come back if the secret is ever lost.

</details>

**The `whsec_…` here is a different secret from the one `stripe listen` printed.** The CLI's
belongs to your machine and its account — stable across runs, and recoverable with
`stripe listen --print-secret`; this one belongs to the registered endpoint. Swapping them
gives a 400 on every delivery that reads exactly like a forgery.

Registering before the deploy is fine. Anything Stripe sends first gets a 404 and is retried
— which is the retry behaviour this slice depends on, arriving early.

### 5. Migrate — re-runnable; the first run creates one table

```bash
cd packages/db
pnpm migrate:production
```

Before the deploy, not after: the deployed handler inserts into `stripe_event` on the first
delivery. `:production` selects `.env.production` and Neon's direct URL — a migration never
goes through Hyperdrive. Idempotent; drizzle records what it has applied.

### 6. Deploy — re-runnable, API first

```bash
cd apps/graphql
pnpm wrangler deploy --dry-run
pnpm deploy:production
cd ../web
pnpm deploy:production
```

**API first is a hard constraint**: web's `API` binding resolves at upload time. Web redeploys
too — the routes, the action, and the inlined publishable key are all new.

Read the dry run's figure before deploying. Slice 6 left the API bundle well under
Cloudflare's 3 MiB gzipped ceiling and said to measure the next addition; the Stripe SDK is a
larger dependency than better-auth, so record what it costs here rather than discovering the
ceiling at upload. Web's bundle grows too, but only by the React wrapper — Stripe.js itself is
fetched from `js.stripe.com` at runtime and is never in it.

### 7. Observe — re-runnable, each pass creates a real Checkout Session

On the deployed **web** URL, never the API's.

| Check                                                      | Expect                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| **Buy the test item**                                      | Stripe's form inline on your own origin, showing `$19.00` |
| the page's URL, while the form is up                       | your web origin — never `checkout.stripe.com`             |
| the form's footer                                          | a **TEST MODE** indication                                |
| pay with `4242 4242 4242 4242`                             | `/checkout/return`, "Payment sent"                        |
| **Back to **PROJECT****                                    | `last stripe event` reads `checkout.session.completed`    |
| `stripe trigger checkout.session.completed`                | Stripe delivers to the **deployed** endpoint; one new row |
| `stripe events resend <evt_…> --webhook-endpoint <we_…>`   | still **one** row, and `receivedAt` **unchanged**         |
| `curl -X POST https://…workers.dev/stripe/webhook -d '{}'` | `400 Invalid signature`                                   |
| **Buy the test item**, pay with `4000 0000 0000 9995`      | declined inline; no new event row                         |

The resend row is the one that could not be proven locally against the real endpoint secret,
and it is the difference between a handler that is idempotent and one that has not been asked
yet. Prefer the CLI's `--webhook-endpoint` form over the dashboard's Resend button: it names
which endpoint it is retrying and prints the event it sent, so a silent no-op cannot be
mistaken for a passing row. **Read `receivedAt`, not just the row count** — a handler that
deleted and re-inserted would also show one row, and only an unchanged timestamp rules that
out. The `curl` row proves the same thing the local gate did, against the URL that is actually
public.

**`stripe trigger` fans out to every endpoint on the account subscribed to that event**, not
only this project's. If the account carries endpoints for other projects they receive it too —
harmless in test mode, but worth knowing before wondering why another project grew a row.

### The two rows only a person can run

Filling Stripe's embedded form is not something the agent can do: the fields live in a
cross-origin `js.stripe.com` iframe, absent from the accessibility tree, and coordinate-based
clicking does not focus them. A tooling limit, not a policy one (SKILL.md §6).

| Check                                            | Expect                                                      |
| ------------------------------------------------ | ----------------------------------------------------------- |
| **Buy the test item**, pay `4242 4242 4242 4242` | `/checkout/return`, "Thank you"; a new row on the home card |
| **Buy the test item**, pay `4000 0000 0000 9995` | declined inline; no new event row                           |

Everything those two would prove about the _return page_ is already covered above by loading it
with a real session id, so what rests on them is narrow: that Stripe's own form submits and
redirects.

Row two is the row this slice's change exists for. If the address bar ever reads
`checkout.stripe.com`, the session was created hosted and `ui_mode` did not take.

### 8. If it fails

| Symptom                                                    | Where it broke                                                         |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| `Missing required environment variable: STRIPE_SECRET_KEY` | step 3 never ran, or ran against a different Worker                    |
| `STRIPE_MODE=test needs a key beginning sk_test_ …`        | a live key reached a test deploy — the guard, working                  |
| `Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`               | step 2's `.env.development` line, or a build on a machine without it   |
| `… must begin pk_ — never a secret key`                    | the secret key went into the public var. Rotate it; it was published   |
| `Missing required environment variable: WEB_ORIGIN`        | step 2 — renamed in the code, not in `wrangler.jsonc`                  |
| the form area stays blank, console names Stripe.js         | the publishable key belongs to another account or mode than the secret |
| the return page says "Could not read that checkout"        | the id is from another account — usually mixed test and live keys      |
| every delivery `400 Invalid signature`                     | step 4 — the CLI's `whsec_` instead of the endpoint's                  |
| _some_ deliveries `400`, the rest `200`                    | step 4 run twice: two endpoints, one URL, one matching secret          |
| no deliveries at all, and no endpoint in `list`            | step 4 landed on a different account than step 1's keys                |
| a delivery `500`, `relation "stripe_event" does not exist` | step 5 never ran against the production database                       |
| deliveries `404`                                           | step 6 not run, or the endpoint URL names the web Worker               |
| `200`, but the row never appears                           | the insert conflicted — check whether the id is already in the table   |
| the web deploy fails on an unresolved `API` binding        | step 6 out of order                                                    |

```bash
cd apps/graphql
pnpm wrangler tail        # then resend a delivery from the dashboard
```

That separates "the handler threw" from "Stripe never delivered". Stripe's own delivery log
answers the second half — it records every attempt, its response code, and its body.

Commit.

**Left for later, deliberately.** This slice records that an event arrived; it does not act on
one. Fulfilment — reading the session back with `line_items` expanded, checking
`payment_status`, and marking an order — is a vertical slice, and so are a `Customer` per
signed-in user, subscriptions, `automatic_tax`, and dashboard branding so the iframe stops
being the one light-mode rectangle in a dark page. Also left: `redirect_on_completion: "never"`
with an `onComplete` callback, which keeps the visitor on `/checkout` for the whole flow and
is worth having once there is something to show them that is not just a webhook's shadow. And
the handler does its database write inline, so a slow Postgres is a slow webhook response — a
queue between the two is a binding with its own pipeline, which makes it a horizontal slice.

## The operating manual

Payments span `packages/db`, `apps/graphql` and `apps/web`, like auth, so they get a skill
rather than three sets of bullets. The new skill is a heredoc; the pointers are deltas.

````bash
cd ../..
mkdir -p .claude/skills/payments
cat > .claude/skills/payments/SKILL.md <<'EOF'
---
name: payments
description: Work with Stripe in __PROJECT__ — embedded Checkout Sessions from apps/graphql, the form mounted in apps/web, the signed webhook at /stripe/webhook, and the stripe_event table in packages/db. Use when a feature takes money, when a Stripe event must be acted on, or when the Stripe configuration changes.
---

# payments — Stripe, across three layers

## Shape

Checkout is **embedded**: Stripe's form runs in an iframe on our own origin, and the
browser never navigates to Stripe.

```
apps/web  ──server action──▶ apps/graphql ──▶ Stripe API     (create a session)
          ◀──────── client secret ◀───────────────────────
browser   ──▶ js.stripe.com ──▶ iframe mounted on our page
Stripe    ──POST /stripe/webhook────────────▶ apps/graphql ──▶ Postgres
```

`/stripe/webhook` is on the **API** Worker's own public URL, routed in `src/index.ts` ahead
of Yoga. It is deliberately _not_ behind apps/web's auth proxy: that proxy exists so a
cookie can belong to the browser's origin, and a webhook has no cookie, no Origin, and
nothing to gain from a hop that can re-encode the bytes the signature covers.

## Owns / never touches

- **Owns:** `apps/graphql/src/stripe.ts` (client factory + mode guard),
  `src/stripe-webhook.ts` (verification + recording), `src/schema/payments/**`,
  `apps/web/src/lib/stripe.ts`, `apps/web/src/app/checkout/**`, and `stripeEvent` in
  `packages/db/src/schema.ts`.
- **`apps/web` never imports `stripe`** — the server SDK. It _does_ import
  `@stripe/stripe-js` and `@stripe/react-stripe-js`, which are the browser half and hold
  no secret. The distinction is the whole security boundary: the secret key and the
  database binding are in `apps/graphql` and stay there.
- **Never act on a Stripe object the client sent you.** A session id in a query string is a
  claim. Read it back from Stripe's API — as `checkoutSessionStatus` does — or take it
  from a verified event.
- **Never branch on `event.type` in the handler** without deciding what happens to every
  other type. Recording is type-agnostic on purpose; fulfilment is not.

## Embedded Checkout, and what the mode implies

- **`ui_mode: "embedded_page"`** — not `"embedded"`, which the API rejects outright with
  _"no longer supported. Use `embedded_page` instead."_ It is what makes `client_secret`
  present and `url` absent. Verified against the live API 2026-09-01.
- **There is no `cancel_url`.** The API rejects it on an embedded session. Everything comes
  back through `return_url`, so the return page must handle `OPEN` — a declined card — and
  not assume it means success.
- **`return_url` carries `{CHECKOUT_SESSION_ID}`**, which Stripe substitutes. Anything the
  return page says about that id must be read back from Stripe first.
- **`fetchClientSecret`, not a rendered `clientSecret`.** A secret in the page means a
  session created for every visitor who loads the route, and no way to get a fresh one
  when the visitor retries.
- **`loadStripe` at module scope, exactly once.** It injects a script tag; calling it in a
  render re-runs that. Stripe.js is loaded from `js.stripe.com` and is never bundled or
  self-hosted — that is a PCI posture, not a performance choice.
- The iframe does not inherit `theme.css` and will not follow the mode toggle. Embedded
  Checkout is styled from the account's dashboard branding settings.
- Under `pnpm preview` the form area sits **empty for about five seconds** before the iframe
  mounts. That is latency, not failure — a real key or session error logs to the console.

## The webhook, and the four things that break it

1. **Read the body once, as text, before anything parses it.** The signature covers the
   exact bytes. `request.json()` consumes the body, re-serialising gives different bytes,
   and a second read on a Workers `Request` throws.
2. **`constructEventAsync`, never `constructEvent`.** WebCrypto is async, so the sync form
   cannot work on workerd. The provider is `Stripe.createSubtleCryptoProvider()`, passed
   as the fifth argument — the fourth is the tolerance, left `undefined`.
3. **Idempotency is the primary key, not a lookup.** Insert with `onConflictDoNothing()` and
   read the returned rows. Stripe retries, and can deliver the same event concurrently, so
   a "have I seen this?" read has a window that a conflict does not.
4. **Reject with 4xx, never 5xx.** Stripe retries a 5xx for days. A body that failed
   verification will fail it every time; a duplicate is a success, so it answers 200 too.

## Keys and modes

| Value                                | Kind        | Where                                                   |
| ------------------------------------ | ----------- | ------------------------------------------------------- |
| `STRIPE_MODE`                        | var         | `wrangler.jsonc`, `.env.development` — `test` or `live` |
| `STRIPE_SECRET_KEY`                  | secret      | `wrangler secret put`, `.env.development`               |
| `STRIPE_WEBHOOK_SECRET`              | secret      | `wrangler secret put`, `.env.development`               |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | build input | `apps/web/.env.development` + `.env.production`         |

- **`createStripe(env)` is per request.** Never hoist it: secrets do not exist at import
  time on a Worker.
- **`httpClient: Stripe.createFetchHttpClient()` is named on purpose, not required.** Since
  `stripe` 22 the `workerd` export condition already resolves to a build whose default
  client is fetch and whose default crypto provider is SubtleCrypto. Naming both keeps this
  Worker correct without depending on export-condition resolution — and the node build it
  would otherwise fall back to reaches for `node:https`, failing at the first API call
  rather than at import.
- **The API's mode is named, not inferred.** `assertKeyMatchesMode` refuses a `sk_live_` key
  under `STRIPE_MODE=test` and the reverse. Deleting that check makes a live key in a dev
  deploy a silent, chargeable success.
- **Web checks its key's shape, not its mode.** A `pk_live_` in a test build fails loudly and
  charges nothing; an `sk_` in a `NEXT_PUBLIC_` var is published to every visitor.
  `assertPublishableKey` catches the second and never echoes the value.
- **The publishable key is the one credential a deploy cannot change.** It is compiled in,
  so rotating it is a rebuild of `apps/web`, not `wrangler secret put`. It is read from
  `.env.production` by `pnpm preview` as well as by `deploy:production` — keep a live key
  out of a working copy, or the next preview mounts a real payment form on localhost.
- **The local `whsec_` and the deployed one are different secrets.** The CLI's belongs to
  your machine and account and is stable across runs — `stripe listen --print-secret` prints
  it, and taking it that way *before* starting `wrangler dev` avoids a restart; the deployed
  endpoint has its own, returned once by `stripe webhook_endpoints create` and re-revealable
  only from that endpoint's dashboard page. Swapping them gives a 400 that reads exactly
  like a forgery.
- **Local development pins port 8787.** `apps/web/src/lib/api.ts` hardcodes it for `next dev`
  and `stripe listen` forwards to it, so a second `wrangler dev` holding the port pushes the
  new one to 8788 — and the browser keeps talking to the stale Worker while deliveries land
  nowhere. Vanished deliveries: check `ss -ltnp | grep 8787`.
- **`stripe listen --events checkout.session.completed`**, mirroring the deployed
  subscription. A bare `stripe listen` forwards the whole cascade a trigger produces, and
  since the handler records every type, the newest row ends up `charge.updated`.
- The SDK pins its own Stripe API version. Upgrading `stripe` moves it — read the changelog
  rather than the diff.

## Judgment calls

- **The return page proves nothing.** It means the browser came back; a visitor can pay and
  close the tab. Only the webhook is evidence that money moved.
- **Money is integer cents, everywhere**, and `formatPrice` is the only thing that renders
  it. Nothing in a money path is a float.
- Inline `price_data` keeps the amount in the repo. Reach for a dashboard Price when a
  human needs to change it without a deploy, and accept that it is then untracked.
- **A public list field needs a server-side ceiling.** The SDL's `limit: Int! = 5` is a
  default, not a limit; `stripeEvents` clamps it.
- **A public field that takes a Stripe id is an oracle.** `checkoutSessionStatus` returns a
  status and nothing else on purpose — adding the customer's email would make it worth
  attacking.
- **Resolvers reach drizzle through `@__PROJECT__/db`, never `drizzle-orm` directly.** That
  package is not a dependency of `apps/graphql` and should not become one — `packages/db`
  owns the version, and its `index.ts` re-exports the operators (`eq`, `desc`, …).
- **Testing the return page needs no card.** A `stripe trigger checkout.session.completed`
  leaves a real `complete` session and any abandoned session is `open`; loading
  `/checkout/return?session_id=…` with each exercises every branch.
- **An agent cannot fill the embedded form.** The fields are in a cross-origin
  `js.stripe.com` iframe, so they never enter the accessibility tree and coordinate clicks do
  not focus them. Card entry is a human step; everything else is reachable through the CLI.
- **Prove a deployed webhook with `stripe trigger`, then `stripe events resend <evt>
  --webhook-endpoint <we>`.** The first exercises the real endpoint secret end to end, the
  second is the idempotency check. Read `receivedAt`, not just the row count — a delete-and
  -reinsert bug also leaves one row, and only an unchanged timestamp rules it out. Note that
  a trigger fans out to every endpoint on the account subscribed to that event.
- **Move a test key with a pipe and a guard, never a paste.** `wrangler secret put` reads
  stdin, so a `sk_test_` key can go from the local Stripe config straight to Cloudflare
  without touching a terminal or clipboard — behind a check that exits non-zero on anything
  without `_test_`. A live key is never handled this way, or any way.

## Enforced elsewhere

- `apps/graphql/src/stripe.test.ts` pins the mode guard in both directions, including an
  unset mode.
- `apps/graphql/src/stripe-webhook.test.ts` pins the routing switch and every refusal path:
  wrong method, no signature, bad signature — all without a database binding, so a handler
  that reached one would throw instead of returning the asserted status.
- `apps/graphql/src/stripe-webhook.int.test.ts` drives a correctly signed delivery, its
  retry, and a tampered body against real Postgres. Needs `docker compose up -d`.
- `apps/web/src/lib/stripe.test.ts` pins that a secret key in the public var is refused.
  `apps/web/vitest.config.ts` supplies a dummy `pk_test_` to the unit project — that module
  guards its own `loadStripe` call at import, so without one it throws before collection.
- `apps/web/src/app/actions.test.ts` pins that a failed session rejects without surfacing
  the API's message.
- `apps/web/src/lib/formatUtc.test.ts` pins that the event time stays in UTC rather than the
  running machine's zone, and that an unparseable value is never rendered as `Invalid Date`.
EOF
````

The `code-db` skill owns the tables, so it says which one is Stripe's and why its key is what it
is:

```diff
--- .claude/skills/code-db/SKILL.md
 - **Never:** `apps/web` must not import `@__PROJECT__/db` — only the API Worker does. The
   dependency graph is the architecture; web reaches data through the API or not at all.
+- **`stripeEvent` is keyed on Stripe's event id**, not a serial. That is not a style
+  choice — the conflict on re-insert is the webhook's whole idempotency mechanism. See
+  the `payments` skill before changing its key or adding a payload column.
+- **This package owns `drizzle-orm`, and re-exports its operators** (`eq`, `desc`, `and`, …)
+  from `src/index.ts`. `apps/graphql` does not depend on drizzle-orm, so a resolver writing
+  `import { eq } from "drizzle-orm"` does not resolve. Add to the re-export list rather than
+  adding a second direct dependency — one owner, one version.
```

The `graphql` skill gains the third thing this Worker serves, and the var rename:

```diff
--- .claude/skills/graphql/SKILL.md
 - **A new feature gets a new module directory, not a line in someone else's.**
-  `system/` is health/version/appEnv, `mail/` is sendTestEmail, `auth/` is the viewer.
+  `system/` is health/version/appEnv, `mail/` is sendTestEmail, `auth/` is the viewer,
+  `payments/` is checkout, session status, and the event list.
 - **This Worker also serves Better Auth**, at `authOptions.basePath` — `src/index.ts`
   routes there before Yoga. Read the `auth` skill before touching `src/auth*.ts`.
+- **It also serves Stripe's webhook**, at `STRIPE_WEBHOOK_PATH`, routed in the same place
+  and ahead of CORS — Stripe sends no Origin. Read the `payments` skill before touching
+  `src/stripe*.ts`.
+- **Resolvers import drizzle operators from `@__PROJECT__/db`, not `drizzle-orm`.** This app has
+  no drizzle dependency; `packages/db` re-exports what a resolver needs.
@@
   distinguishable errors are an enumeration oracle. The `auth` skill holds the check itself.
+- **A public list field needs its own ceiling.** An SDL default is a default, not a limit —
+  clamp the argument in the resolver, as `stripeEvents` does.
+- **Prefer an enum to a String for a closed set.** `CheckoutStatus` is three values, so the
+  web layer gets an exhaustive union and a fourth state becomes a compile error there.
 - **The local env file is `.env.development`, and `--env-file` on `dev` is what points
@@
 - `wrangler.jsonc` carries production-only `vars` — today `CORS_ORIGINS`, `APP_ENV`, the
-  mail keys and `BETTER_AUTH_URL`.
+  mail keys, `WEB_ORIGIN` and `STRIPE_MODE`.
@@
-  (`src/index.int.test.ts`, `src/auth.int.test.ts`). Run it with `pnpm test:integration`, after
+  (`src/index.int.test.ts`, `src/auth.int.test.ts`, `src/stripe-webhook.int.test.ts`). Run it
+  with `pnpm test:integration`, after
```

The `web` skill gains server actions and the third-party script, which are both new here:

```diff
--- .claude/skills/web/SKILL.md
 - **`src/app/api/auth/[...all]/route.ts` is a transparent proxy to the API Worker**, and the
   browser must never call the API's own origin. Read the `auth` skill before touching it,
   `src/lib/auth-client.ts`, or `apiFetch`.
+- **`src/app/actions.ts` holds server actions**, which run in this Worker and reach the API
+  the same way a page does. Never import `stripe` — the server SDK — anywhere in this app;
+  `@stripe/stripe-js` and `@stripe/react-stripe-js` are the browser half and are fine. Read
+  the `payments` skill.
 - **This is not the Next.js you know.** Next 16 has breaking changes against training data:
   read the relevant guide in `node_modules/next/dist/docs/` before reaching for an API from
   memory. `export const dynamic` is gone — `connection()` replaces it.
@@
   (`process.env.NEXT_PUBLIC_APP_ENV`). `process.env[name]` and destructuring are not
   inlined by `next build` and arrive `undefined` in the browser. Nothing secret ever gets
   the `NEXT_PUBLIC_` prefix.
+- **This app has no `.env.local`, on purpose.** Next reads
+  `process.env > .env.<mode>.local > .env.local > .env.<mode> > .env`, so `.env.local` is
+  loaded in _both_ modes and outranks `.env.production` — a development value then wins
+  silently in a production build. Use `.env.development` and `.env.production`.
+- **`pnpm preview` is a production build**, so it reads `.env.production`, exactly as
+  `pnpm deploy:production` does. No filename separates the two; only `process.env` does,
+  which is how both scripts override `NEXT_PUBLIC_APP_ENV`. Never put a production
+  credential in `.env.production` on a working copy — a live publishable key there is a
+  live payment form on localhost.
 - A client-side sign-in does not re-render a server component. `router.refresh()` is what
   makes a server-read `viewer` catch up.
+- **A server action that redirects must call `redirect()` outside any `try`.** It signals by
+  throwing, so a catch around it turns the navigation into a silent no-op.
+- **An action called from a client component is just a promise.** Its rejection is the
+  caller's to render — a third-party widget will not do it for you. See `CheckoutForm`.
+- **`Button` is Base UI, so composition is `render={<Link … />}`, not `asChild`** — and
+  rendering anything that is not a `<button>` needs `nativeButton={false}` with it, or the
+  primitive warns that it applied native button semantics to an element that has none.
 - New binding in `wrangler.jsonc` → `pnpm cf-typegen`.
 - `next dev` rewrites the rules block in `AGENTS.md`. Committing that with your work keeps
   the tree clean; removing it just re-creates the uncommitted change.
```

The `auth` skill has two rules naming a var that no longer exists:

```diff
--- .claude/skills/auth/SKILL.md
-- **`BETTER_AUTH_URL` is the web origin**, never this Worker's. It is what Better Auth
-  validates the browser's `Origin` against, and what `trustedOrigins` is built from.
+- **`WEB_ORIGIN` is the web origin**, never this Worker's. It is what Better Auth validates
+  the browser's `Origin` against, what `trustedOrigins` is built from, and — since Slice 7 —
+  where Stripe Checkout returns the visitor. One value, one name.
@@
 - **The verification link is built from `baseURL`**, so it lands on the web origin and is
-  proxied back. Nothing works if `BETTER_AUTH_URL` names the API Worker.
+  proxied back. Nothing works if `WEB_ORIGIN` names the API Worker.
```

## The docs:check baseline

`apps/web/.env.development` now holds an account-specific credential appended by hand, which
is exactly the situation `apps/graphql/.env.development` has been in since Slice 5. No doc can
write it whole again without either overwriting your key or committing one, so this slice
baselines it — and per that file's own rule, the entry is added by the slice that makes it
true rather than in advance.

```diff
--- scripts/docs-check.ignore
 packages/email/emails/verify-email.tsx  # retired by Slice 6's rename
+
+# Permanent, and for the same reason as apps/graphql/.env.development above: from Slice 7
+# this file holds NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, which is account-specific. Slice 1
+# wrote it whole; Slice 7 appends a fragment by hand and hands it back. It is public as
+# keys go, but it is still yours — a heredoc would either overwrite it or commit one.
+apps/web/.env.development  # permanent: gitignored and holds an account key, appended by hand
```

## Sources and findings

The documentation this slice's §3 research rests on, and what running it actually turned up —
kept here rather than in a shared bibliography so that reading the slice is reading its
evidence. **Every version and claim below is dated.** A pin is only as good as its date;
re-check rather than inherit, and add a dated entry when you do (SKILL.md §7).

### Sources

- [Stripe webhooks quickstart](https://docs.stripe.com/webhooks/quickstart) (`stripe listen`, `STRIPE_WEBHOOK_SECRET`)
- [Stripe webhooks](https://docs.stripe.com/webhooks) (signature verification, automatic retries, 4xx vs 5xx)
- [Fulfil orders with Checkout](https://docs.stripe.com/checkout/fulfillment) (why the webhook and not the redirect, and the 10-second wait)
- [Create a Checkout Session](https://docs.stripe.com/api/checkout/sessions/create) (`mode`, inline `price_data`, `success_url`)
- [stripe-node](https://github.com/stripe/stripe-node) (`createFetchHttpClient`, `createSubtleCryptoProvider`, `constructEventAsync`)
- [Stripe SDK on Cloudflare Workers · OpenNext](https://opennext.js.org/cloudflare/howtos/stripeAPI) (why the default `node:https` client does not work)
- [Stripe CLI](https://docs.stripe.com/stripe-cli) (`stripe listen`, `stripe trigger`)
- [Next.js server actions](https://nextjs.org/docs/app/getting-started/updating-data) (a form `action`, and `redirect` outside `try`)

### Findings

#### 2026-09-01 — first end-to-end execution (nanoapp, Slice 6 already built)

Resolved and verified: `stripe` **22.6.0**, `@stripe/stripe-js` **9.15.0**,
`@stripe/react-stripe-js` **6.8.2**; none deprecated (`npm view <pkg> deprecated` empty).
Stripe CLI 1.45.1, API version `2026-04-22.dahlia`.

**Reproduced against the live API rather than assumed** (`stripe checkout sessions create`
against a test account):

- `ui_mode: "embedded"` is **rejected**: _"The ui_mode value `embedded` is no longer
  supported. Use `embedded_page` instead."_ The slice was right and the obvious guess is
  wrong; do not "fix" `embedded_page` back.
- `cancel_url` with `ui_mode: embedded_page` is **rejected**: _"`cancel_url` is not supported
  with `ui_mode: embedded_page`."_
- An `embedded_page` session returns `client_secret` set and `url: null`, with
  `redirect_on_completion: "always"` and `status: "open"`.
- The SDK types agree: `UiMode = 'elements' | 'embedded_page' | 'form' | 'hosted_page' |
OtherString`, and `Session.Status = 'complete' | 'expired' | 'open' | OtherString`. The
  `OtherString` widening is why `checkoutSessionStatus` narrows through a lookup table
  instead of casting — that is load-bearing, not decoration.

**`httpClient` guidance was stale, and the reasoning had to be rewritten.** `stripe` 22
declares a `workerd` export condition resolving to a Web platform build whose
`createDefaultHttpClient()` already returns the fetch client and whose
`createDefaultCryptoProvider()` already returns the SubtleCrypto one — read directly from
`esm/platform/WebPlatformFunctions.js` and the `exports` map in the published tarball. The old
claim ("it fails at the first API call without this") is no longer true under that condition.
Both arguments are still passed, now justified as independence from export-condition
resolution rather than as a fix. The command did not change; the explanation did.

**`import { desc } from "drizzle-orm"` in a resolver does not compile.** `drizzle-orm` is a
dependency of `packages/db` only, so under pnpm's strict layout it does not resolve from
`apps/graphql` — `pnpm typecheck` fails with `Cannot find module`. Both `stripeEvents.ts` and
`stripe-webhook.int.test.ts` hit this. Fixed by re-exporting the operators from
`packages/db/src/index.ts`, matching how every other db symbol already reaches a resolver,
rather than adding a second direct pin on drizzle.

**The home panel's new row overflows its grid column.** `checkout.session.completed` measures
218px in a 179px track (`grid-cols-2` at `font-mono text-sm`), so the type ran past the card's
right padding. Measured in the browser, not guessed. Fixed with `wrap-anywhere` on that `dd`.

**The local gate's test totals were wrong twice.** It claimed Slice 6 leaves 40 unit tests
(this repo's left 39) and counted this slice's new web tests as 8 (the files it writes hold
12). Actual after this slice: unit 59 = web 27 + graphql 24 + email 8; integration 7.
The rows now say "+N over your measured baseline" instead of an absolute.

**Two workflow improvements found while running it:**

- `stripe listen --print-secret` yields the CLI's signing secret without starting a forwarder,
  and it is stable per account and device. Writing it into `.env.development` _before_
  starting `wrangler dev` removes the paste-then-restart step the slice described, and with it
  the 400-that-looks-like-a-forgery.
- All three return-page branches are provable **without entering a card**: a
  `stripe trigger checkout.session.completed` leaves a real `complete` session, any session
  created and abandoned is `open`, and a made-up id exercises the unreadable branch. Loading
  `/checkout/return?session_id=…` with each covers `checkoutSessionStatus`, the enum mapping
  and every copy branch. Card entry is then only about Stripe's own form, which is a person's
  job anyway.

Also observed, and not a bug: under `pnpm preview` the checkout card paints with an empty form
area for about five seconds before the iframe mounts (well under a second in `next dev`).
Nothing logs to the console; a genuine key or session failure does.

#### 2026-09-01 — production gate, same run

Deployed and observed. Bundle sizes at upload, for the next slice to measure against:
**API 942.11 KiB gzipped** (5227.60 KiB raw) and **web 1201.72 KiB gzipped** — both far under
Cloudflare's 3 MiB ceiling, and the Stripe SDK is the larger part of the API's growth. Web
carries only the React wrapper; Stripe.js itself is fetched from `js.stripe.com` at runtime.

**Proven against the real deployed endpoint:** a `stripe trigger checkout.session.completed`
was delivered by Stripe to `nanoapp-graphql`, verified against the registered endpoint's own
`whsec_`, and written to Neon through Hyperdrive. `stripe events resend` on the same event id
returned `200` and left **one** row with an **unchanged** `receivedAt` — the idempotency claim,
tested against the secret the local gate could not use. `curl` to the public URL returned `400
Missing stripe-signature`, `400 Invalid signature` for a forged one, and `405` for `GET`; all
4xx rather than 5xx, which also proves the secrets resolved (a missing one throws a 500).

**The webhook endpoint's defaults were all confirmed by reading the create response**, not
assumed: `livemode: false`, one `enabled_events` entry, `application: null` (not Connect) and
`api_version: null` (the account default).

**`wrangler secret put` reads stdin**, so a test key can be piped in from a guard that asserts
the mode, and never reaches a terminal or clipboard. That is now the recommended form while
the gate is in test mode; see SKILL.md §6 on where the live/test line actually sits.

**The agent cannot fill Stripe's embedded Checkout form, and this cost a detour to establish.**
The fields are in a cross-origin `js.stripe.com` iframe and never enter the accessibility tree.
Worse, the first diagnosis was wrong: it looked like an iframe sandbox problem, but the same
`type` failed on this app's **own** same-origin email input. The real cause is that in the
Chrome extension only `ref`-based clicks focus an input — coordinate clicks focus nothing, in
either screenshot space or CSS space, even though the viewport (1685×1326) and the screenshot
(1232×970) differ by a clean 1.368×. **Test a same-origin input before blaming a third party's
iframe.** Since a cross-origin frame exposes no refs, the two card rows are the user's; the
rest of the production gate was rebuilt around `stripe trigger` + `stripe events resend`, which
needs no card and proves strictly more (it exercises the deployed endpoint's real secret).

**Not verified in this run:** the two card rows above — Stripe's own form accepting
`4242 4242 4242 4242` and declining `4000 0000 0000 9995`.

## Leaves behind

Read by Slice 99 (the audit), which treats this as a **cross-check and never as the source of truth** —
the code is that. An entry here is a claim about the repo; where the two disagree, the code
wins and this table is the finding.

**Provisional** is something built to prove a mechanism, with the condition that retires it.
**Accepted** is a risk taken knowingly, with the reasoning written down so a later slice can
re-decide it rather than rediscover it.

> **Not yet verified by a run.** This block was written by reading the slice, not by executing
> it. Slice 99 should treat every row as unconfirmed and check it against the code first.

### Provisional

Nothing new. `sendTestEmail` still survives, and this slice is where it starts being described
as permanent architecture — which is the point at which it stops looking provisional to a reader.

### Accepted

| Risk                                                     | Reachable by        | Why this is the right trade                                                                                                                                                         |
| -------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /stripe/webhook` is public and unauthenticated     | The entire internet | It must be: Stripe has no cookie and no origin. `constructEventAsync` verifying the signature is the authentication, and the `stripe_event` primary key is what makes replay inert. |
| Prices are inline `price_data`, set by the caller's code | —                   | The amount lives in the repo as integer cents rather than in a dashboard no doc can check. It is server-side; confirm no client input reaches it.                                   |
