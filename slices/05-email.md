# Slice 5 — Email: Resend and React Email

Horizontal. Three pipelines have never run: React Email rendering under workerd, an outbound
third-party API call from a Worker, and the first secret delivered by `wrangler secret put`.

A verification mail you cannot send is not a gate, so this groundwork comes before a layer
that would need to send one.

## Decisions

| Decision                                                                       | Why                                                                                                                                                                               |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/email`, not a directory in `apps/graphql`                            | JSX config, React deps, and the preview server want their own root. Slice 2's one-importer objection was about a re-export; this is a toolchain boundary.                         |
| Resend                                                                         | HTTP API, no SMTP connection to hold open from an isolate.                                                                                                                        |
| Everything — components, `render`, the CLI — from one `react-email` dependency | Since `react-email@6` that package _is_ the library; `@react-email/components` and the per-component packages are deprecated. Verify this has not moved again before you install. |
| Render to **html and text**, not `react:` passthrough                          | Resend can render a component itself, but then the `log` transport has nothing to show and there is no plain-text alternative.                                                    |
| Transport named by `MAIL_TRANSPORT`, fail-closed                               | `log` locally and in tests, `resend` in production. Unset is an error, so production cannot silently stop sending.                                                                |
| `sendTestEmail` mutation, allowlisted                                          | The slice needs something to observe in production. `MAIL_TEST_RECIPIENTS` fails closed like `CORS_ORIGINS`.                                                                      |

`react` and `react-dom` move into the workspace catalog here: `apps/web` and `packages/email`
both install them, which is the rule as written.

## packages/email

```bash
mkdir -p packages/email && cd packages/email && pnpm init
pnpm pkg set name="@__PROJECT__/email"
pnpm pkg set exports="./src/index.ts"
pnpm pkg delete main
pnpm add resend react-email
pnpm add -D @react-email/ui @types/react vitest typescript@catalog:
pnpm pkg set \
  scripts.typecheck="tsc --noEmit" \
  scripts.lint="eslint . --max-warnings 0" \
  scripts.format="prettier --write . --ignore-path ../../.gitignore --ignore-path ../../.prettierignore" \
  scripts.test="vitest run" \
  'scripts["test:unit"]=vitest run --project unit' \
  'scripts["test:integration"]=vitest run --project integration' \
  'scripts["email:dev"]=email dev --dir emails --port 3001'
```

(Two `--ignore-path`s, not one. `--ignore-path` _replaces_ prettier's default ignore
list rather than adding to it, and that default is `.gitignore` — so the single-flag
form switches gitignore-based exclusion off and `pnpm format` reformats build output.
Slice 0 states the rule and Slice 1 is where it was discovered; this line is one of the
sibling commands that kept the pre-correction form until 2026-08-31.)

**`react-email` is a runtime dependency, and there is no separate components package.** Until
`react-email@6.0.0` (2026-04-16) this slice installed three packages —
`@react-email/components` and `@react-email/render` at runtime, `react-email` as a dev-only
CLI — and that was right at the time. v6 moved every component and the rendering utilities
**into** `react-email` and deprecated what they came from. `@react-email/render` and
`@react-email/ui` are the only survivors, and `react-email` re-exports the former, so nothing
needs it named.

The trap is that **nothing fails**. The deprecated packages still install, still export the
same names, and every code block below compiles against either shape — so a slice run from a
stale reference produces a working, green, quietly-unmaintained tree. What gives it away is a
single line of install output:

```
[WARN] deprecated @react-email/components@1.0.12: Package no longer supported.
```

That is the general lesson, not the specific version: **§3 must read what `pnpm add` prints,
not just its exit code.** A deprecation notice is the only signal a moved package gives when
its API did not move with it.

Pulling the CLI into `dependencies` looks alarming, because its own dependencies include
esbuild, chokidar, socket.io, prismjs and tailwindcss. It costs nothing at runtime: those are
reachable only from `dist/cli/index.mjs`, and the Worker imports the package's main entry,
which is the components plus a re-export of the renderer. esbuild's native binary is installed
(Slice 0's `allowBuilds` already permits it) and never bundled. The production gate's bundle
figures are the check on that claim, and they came in within 1% of what the three-package
split measured — which is the evidence, not the reasoning.

The merge does not carry over an export map: `react-email` declares plain `import`/`require`
with no `workerd` condition. That is fine, and was equally true of `@react-email/components` —
the condition that matters lives on `@react-email/render`'s own `package.json` and is honoured
when the re-export resolves it, whichever package points there.

Port 3001, because `email dev` defaults to 3000 and `next dev` is already there. The flag is a preference, not a
reservation: the CLI takes the next free port and says so (`Port 3001 is already in use,
trying 3002`), which is what happens on a machine already previewing another project's
templates. The gate row reads the port off the output, not off this line.

`@react-email/ui` is the preview server's own interface, and `email dev` does not ship it:
without it the CLI stops on a `Would you like to install it? (Y/n)` prompt, which on a machine
with no TTY — CI, or a command run by an agent — is not a prompt but a silent exit. Declaring
it makes the gate row runnable anywhere. It is a dev dependency of the preview tool only;
nothing under `src` imports it.

```bash
cat > tsconfig.json <<'EOF'
{
  "extends": "../../packages/config/tsconfig.base.json",
  // Templates are React components, so JSX has to compile. react-jsx needs no React
  // import in scope. skipLibCheck for the same reason apps/graphql needs it: the
  // renderer's types reach react-dom/server, which force-loads the DOM lib.
  "compilerOptions": {
    "jsx": "react-jsx",
    "skipLibCheck": true
  },
  "include": ["src", "emails"]
}
EOF
cat > eslint.config.mjs <<'EOF'
import base from "../../packages/config/eslint.base.mjs";

export default [...base];
EOF
cat > vitest.config.ts <<'EOF'
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["**/*.int.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["src/**/*.int.test.ts"],
        },
      },
    ],
  },
});
EOF
```

The `react-email` CLI has a build directory no slice created: `email build` and `email export`
copy a Next.js app into `.react-email/` at the project root and work from there. **`email dev`
does not** — v6 packs the preview server into `$HOME/.react-email` instead, and running the
gate row leaves the working tree untouched. So this is insurance, not a fix: the two commands
that fill the directory are one word away from the one `email:dev` runs, and nothing about the
script announces which you are about to type. Left unignored it costs a few thousand generated
files reformatted by `pnpm format`, linted by `pnpm lint`, and offered up by `git status`.
`.gitignore` is also what keeps prettier off it (`--ignore-path ../../.gitignore`):

```diff
--- .gitignore
 node_modules/
 .next
 .open-next
 .turbo
 .wrangler
+# `email build` / `email export` copy a Next.js app in here. Build output, not source.
+.react-email
 .cache
 .env*
 !.env.example
```

`.gitignore` does not settle it for ESLint, which is why the other build directories are
listed twice: flat config reads no ignore file, so the shared base carries its own copy of
that list. `.react-email` belongs in both or `pnpm lint` walks it:

```diff
--- packages/config/eslint.base.mjs
       "**/.turbo/**",
       "**/.wrangler/**",
+      // The react-email CLI's build directory — a generated Next.js app, see Slice 5.
+      "**/.react-email/**",
       "**/dist/**",
```

`tsconfig.json` needs no equivalent: this package's `include` names `src` and `emails`, so
`tsc` never sees the directory in the first place.

The catalog gains `react` and `react-dom`, pinned at the exact versions Next chose — a range
here would let the two packages resolve differently and render with two React copies:

```diff
--- pnpm-workspace.yaml
 # Track the newest release of the Node major this repo runs, not npm's `latest`:
 # @types/node ships majors for Node versions you are not on.
+#
+# react/react-dom are exact, not ranged: apps/web takes what Next pinned and
+# packages/email must match it. Two resolutions means two React copies, which
+# renders nothing and explains nothing.
 catalog:
   typescript: ^6.0.3
   eslint: ^10.9.1
   "@types/node": ^24.13.3
+  react: 19.2.8
+  react-dom: 19.2.8
```

Only then can anything ask for `react@catalog:` — a catalog specifier resolves at install
time, so the entry has to exist before the install that names it:

```bash
cd ../../apps/web
pnpm pkg set dependencies.react="catalog:" 'dependencies["react-dom"]=catalog:'
cd ../../packages/email
pnpm add react@catalog: react-dom@catalog:
```

The bracket form is not a style choice: `pnpm pkg set` reads a dot path, and a hyphen in a
segment is a parse error rather than a key — `dependencies.react-dom=` fails outright, and it
fails after `dependencies.react` has already been written.

### The template

Written now; a real token is wired in only once a verified sign-up layer exists to issue one.

```bash
mkdir -p emails
cat > emails/verify-email.tsx <<'EOF'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from "react-email";

export interface VerifyEmailProps {
  url: string;
}

// Inline styles only. Email clients strip or ignore <style> blocks unpredictably, and
// there is no cascade to rely on — this is the one place in the repo where naming a
// colour is correct, because theme.css does not reach a mail client.
const main = { backgroundColor: "#ffffff", fontFamily: "sans-serif" };
const container = { margin: "0 auto", padding: "24px", maxWidth: "480px" };
const button = {
  backgroundColor: "#18181b",
  color: "#ffffff",
  borderRadius: "6px",
  padding: "10px 16px",
  fontSize: "14px",
  textDecoration: "none",
  display: "inline-block",
};
const muted = { color: "#71717a", fontSize: "12px" };

export function VerifyEmail({ url }: VerifyEmailProps) {
  return (
    <Html>
      <Head />
      {/* The inbox line under the subject. Without it clients scrape the first text
          they find, which is usually the heading repeated. */}
      <Preview>Confirm your __PROJECT__ email address</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading>Confirm your email</Heading>
          <Text>Click the button to confirm this address for __PROJECT__.</Text>
          <Button href={url} style={button}>
            Confirm email
          </Button>
          {/* The bare URL is not decoration: a client that blocks the button leaves
              the recipient with no way through, and the text alternative needs it. */}
          <Text style={muted}>Or paste this into your browser: {url}</Text>
        </Container>
      </Body>
    </Html>
  );
}

// `email dev` renders the default export, with PreviewProps as its sample data.
VerifyEmail.PreviewProps = {
  url: "https://__PROJECT__.example/api/auth/verify-email?token=preview",
} satisfies VerifyEmailProps;

export default VerifyEmail;
EOF
```

### Render and send

```bash
mkdir -p src
cat > src/render.tsx <<'EOF'
// Components and `render` both come from `react-email`. Since v6 that is the whole
// library — @react-email/components and the per-component packages are deprecated.
import { render } from "react-email";
import { VerifyEmail } from "../emails/verify-email";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// Two passes, because `render` returns one format per call. The text alternative is
// not optional politeness: a message without one is scored as spam by most filters,
// and a client with images and HTML off shows an empty body.
export async function renderVerifyEmail(url: string): Promise<RenderedEmail> {
  const element = <VerifyEmail url={url} />;

  return {
    // The subject lives here rather than in the template: a React component renders a
    // body, and a subject is a header. Keeping them in one function is what stops a
    // template being sent with someone else's subject.
    subject: "Confirm your __PROJECT__ email address",
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}
EOF
cat > src/mailer.ts <<'EOF'
import { Resend } from "resend";

/** What a mailer needs from the environment.
 *
 *  Declared structurally rather than importing the Worker's Env: this package must not
 *  know it is used from a Worker, and a generated interface satisfies this one by shape.
 */
export interface MailEnv {
  MAIL_TRANSPORT: string;
  MAIL_FROM: string;
  RESEND_API_KEY?: string;
}

export interface Message {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  send(message: Message): Promise<void>;
}

/** Pick a transport by name. Unknown or unset throws.
 *
 *  Explicit rather than inferred from NODE_ENV or from whether a key happens to be
 *  present: both of those fail *open* in the wrong direction — a production deploy that
 *  lost its key would quietly degrade to logging and report every send as a success.
 */
export function createMailer(env: MailEnv): Mailer {
  switch (env.MAIL_TRANSPORT) {
    case "resend": {
      const key = env.RESEND_API_KEY;
      if (!key) throw new Error("MAIL_TRANSPORT=resend needs RESEND_API_KEY");
      const resend = new Resend(key);

      return {
        async send(message) {
          // The SDK returns { data, error } and does not throw, so a send that failed
          // looks exactly like one that worked unless this is checked.
          const { error } = await resend.emails.send({
            from: env.MAIL_FROM,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
          });
          if (error)
            throw new Error(`Resend refused the message: ${error.message}`);
        },
      };
    }

    case "log":
      return {
        async send(message) {
          console.log(`[mail:log] to=${message.to} subject=${message.subject}`);
        },
      };

    default:
      throw new Error(
        `Unknown MAIL_TRANSPORT ${JSON.stringify(env.MAIL_TRANSPORT)} — expected "resend" or "log"`,
      );
  }
}
EOF
cat > src/index.ts <<'EOF'
export { renderVerifyEmail, type RenderedEmail } from "./render";
export {
  createMailer,
  type MailEnv,
  type Mailer,
  type Message,
} from "./mailer";
EOF
```

### Tests

```bash
cat > src/render.test.ts <<'EOF'
import { expect, test } from "vitest";
import { renderVerifyEmail } from "./render";

const URL = "https://__PROJECT__.example/api/auth/verify-email?token=abc123";

test("the html carries the verification link", async () => {
  const { html } = await renderVerifyEmail(URL);

  expect(html).toContain(URL);
  expect(html).toContain("<html");
});

// A recipient with HTML disabled must still be able to finish, so the link has to
// survive the text conversion — a button alone would not.
test("the text alternative carries it too", async () => {
  const { text } = await renderVerifyEmail(URL);

  expect(text).toContain(URL);
  expect(text).not.toContain("<html");
});

test("the subject is set and is not the URL", async () => {
  const { subject } = await renderVerifyEmail(URL);

  expect(subject).toBeTruthy();
  expect(subject).not.toContain("http");
});
EOF
cat > src/mailer.test.ts <<'EOF'
import { expect, test, vi } from "vitest";
import { createMailer, type MailEnv } from "./mailer";

const mocks = vi.hoisted(() => ({
  keys: [] as string[],
  send: vi.fn(async (_payload: unknown) => ({
    data: { id: "1" },
    error: null,
  })),
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.send };
    constructor(key: string) {
      mocks.keys.push(key);
    }
  },
}));

const message = {
  to: "someone@example.test",
  subject: "s",
  html: "<p>h</p>",
  text: "h",
};
const env = (over: Partial<MailEnv>): MailEnv =>
  ({ MAIL_FROM: "__PROJECT__ <no-reply@example.test>", ...over }) as MailEnv;

test("the resend transport posts the rendered message and the configured from", async () => {
  await createMailer(
    env({ MAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_test" }),
  ).send(message);

  expect(mocks.keys).toContain("re_test");
  expect(mocks.send).toHaveBeenCalledWith({
    from: "__PROJECT__ <no-reply@example.test>",
    to: ["someone@example.test"],
    subject: "s",
    html: "<p>h</p>",
    text: "h",
  });
});

// The SDK reports failure in the return value, not by throwing.
test("a refusal from Resend becomes an error", async () => {
  mocks.send.mockResolvedValueOnce({
    data: null,
    error: { message: "domain not verified" },
  } as never);

  await expect(
    createMailer(
      env({ MAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_test" }),
    ).send(message),
  ).rejects.toThrow("domain not verified");
});

test("the log transport touches no network", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  await createMailer(env({ MAIL_TRANSPORT: "log" })).send(message);

  expect(fetchMock).not.toHaveBeenCalled();
});

// The whole point of naming the transport: neither of these may fall back to logging.
test("an unset or unknown transport throws rather than degrading", () => {
  expect(() => createMailer(env({}))).toThrow("MAIL_TRANSPORT");
  expect(() => createMailer(env({ MAIL_TRANSPORT: "smtp" }))).toThrow("smtp");
  expect(() => createMailer(env({ MAIL_TRANSPORT: "resend" }))).toThrow(
    "RESEND_API_KEY",
  );
});
EOF
```

## apps/graphql

```bash
cd ../../apps/graphql
pnpm add @__PROJECT__/email@workspace:*
```

The package's `exports` is `./src/index.ts` — source, not a build — so importing it hands this
app a `.tsx` file to compile, and `tsc` refuses with `--jsx is not set` about a file no one
here wrote. The flag belongs to the consumer because the compilation does:

```diff
--- apps/graphql/tsconfig.json
   // in this workspace today and would break on a clean or hoisting-free install.
+  //
+  // jsx is here for a package this app does not itself write JSX in. @__PROJECT__/email
+  // exports TypeScript source, not a build, so its render.tsx is compiled by whoever
+  // imports it — and `--jsx is not set` is what tsc says about a file it was handed
+  // rather than one it was asked for. The Worker bundle is unaffected either way;
+  // esbuild reads the extension.
   "compilerOptions": {
     "skipLibCheck": true,
+    "jsx": "react-jsx",
     "types": ["node"]
   },
```

Three vars and a secret. `wrangler.jsonc` by hand, as always — the file carries an
account-specific Hyperdrive id:

```jsonc
{
  ...,
  "vars": {
    ...,
    "MAIL_FROM": "__PROJECT__ <onboarding@resend.dev>",
    "MAIL_TRANSPORT": "resend",
    // Who sendTestEmail may write to. Fail-closed, like CORS_ORIGINS: an empty list
    // refuses everything, so a public mutation cannot become an open relay.
    "MAIL_TEST_RECIPIENTS": "you@example.com"
  }
}
```

Local overrides go in `.env.development` by hand — it is gitignored and now holds a
credential, so the doc stops owning it whole:

```ini
MAIL_TRANSPORT=log
MAIL_FROM="__PROJECT__ <onboarding@resend.dev>"
MAIL_TEST_RECIPIENTS=you@example.com
# Only needed while you flip MAIL_TRANSPORT to resend for the real-send gate row.
RESEND_API_KEY="re_..."
```

Slice 2 wrote that file whole; from here nobody can. A heredoc would either overwrite your
real key or commit one, so this slice appends a fragment and hands the file back — which is
drift the checker cannot distinguish from the real thing, and so takes a **permanent** line in
`scripts/docs-check.ignore`, added by hand beside `wrangler.jsonc`'s and for the same reason:

```diff
--- scripts/docs-check.ignore
 apps/graphql/wrangler.jsonc  # permanent: vars are added by hand, never whole-file
+
+# Permanent, and for the same reason as the line above: from Slice 5 this file holds
+# RESEND_API_KEY, so no doc can ever write it whole again — a heredoc would either
+# overwrite your real key or commit one. Slice 2 wrote it; Slice 5 appends a fragment
+# and hands it back. Nothing to delete when a later slice lands.
+apps/graphql/.env.development  # permanent: gitignored and holds secrets, appended by hand
```

**A `diff` hunk, not a plain fence, and it needs a context line.** `docs:check` composes a
file's expected contents from the last `cat >` heredoc plus every `diff` hunk after it, and
ignores any other fence — so a fenced listing of the line to add reads as prose, and the file
drifts by exactly the line it was supposed to document. A hunk of nothing but `+` lines is
rejected too (`hunk has no context or removed lines to anchor on`); `wrangler.jsonc`'s
baseline from Slice 2 is the context line that anchors this one to the end of the file.

Nothing to delete when a later slice lands — no doc will own this file whole again, and one
that tried would be wrong.

```diff
--- apps/graphql/.env.example
 CORS_ORIGINS=http://localhost:3000
 APP_ENV=local
+# log renders and prints; resend actually sends. Unset is an error, never a fallback.
+MAIL_TRANSPORT=log
+MAIL_FROM=__PROJECT__ <onboarding@resend.dev>
+MAIL_TEST_RECIPIENTS=you@example.com
+# The one key with no counterpart in wrangler.jsonc. Secrets are set with
+# `wrangler secret put` and stored by Cloudflare; a `vars` entry would be plaintext.
+RESEND_API_KEY=re_dev_only_not_a_real_key
```

```bash
pnpm cf-typegen
```

### The allowlist

```bash
cat > src/mail.ts <<'EOF'
import type { Env } from "./context";

/** Who sendTestEmail may write to.
 *
 *  Fail closed on an unset or empty list, the same shape as cors.ts: this mutation has no
 *  session layer to gate it against yet, and a send-to-anyone mutation on a public endpoint
 *  is an open relay. An empty list refusing everything is the safe reading of a var someone
 *  forgot.
 */
export function isAllowedRecipient(env: Env, to: string): boolean {
  const allowed = (env.MAIL_TEST_RECIPIENTS ?? "")
    .split(",")
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean);

  return allowed.includes(to.trim().toLowerCase());
}
EOF
cat > src/mail.test.ts <<'EOF'
import { expect, test } from "vitest";
import { isAllowedRecipient } from "./mail";
import type { Env } from "./context";

const envWith = (list?: string) =>
  ({ MAIL_TEST_RECIPIENTS: list }) as unknown as Env;

test("an address on the list is allowed, case and spacing insensitive", () => {
  const env = envWith(" A@example.test , b@example.test ");

  expect(isAllowedRecipient(env, "a@EXAMPLE.test")).toBe(true);
  expect(isAllowedRecipient(env, "b@example.test")).toBe(true);
});

test("an address off the list is refused", () => {
  expect(isAllowedRecipient(envWith("a@example.test"), "c@example.test")).toBe(
    false,
  );
});

// The trap: an empty list must mean "nobody", not "no restriction".
test("an unset list refuses everything", () => {
  expect(isAllowedRecipient(envWith(undefined), "a@example.test")).toBe(false);
  expect(isAllowedRecipient(envWith(""), "a@example.test")).toBe(false);
});
EOF
```

### The mutation

The schema's first `Mutation` type. Same module rule as ever — a new directory, not a line in
someone else's:

```bash
mkdir -p src/schema/mail
cat > src/schema/mail/schema.graphql <<'EOF'
type Mutation {
  """
  Sends the verification template to an address on MAIL_TEST_RECIPIENTS.
  Exists to prove the mail pipeline in production; not part of any feature.
  """
  sendTestEmail(to: String!): Boolean!
}
EOF
pnpm turbo codegen --filter @__PROJECT__/graphql
```

The preset scaffolds under `resolvers/Mutation/` exactly as it does for `Query` — root fields
are root fields.

```bash
cat > src/schema/mail/resolvers/Mutation/sendTestEmail.ts <<'EOF'
import { createMailer, renderVerifyEmail } from "@__PROJECT__/email";
import { GraphQLError } from "graphql";
import { isAllowedRecipient } from "./../../../../mail";
import type { MutationResolvers } from "./../../../types.generated";

export const sendTestEmail: NonNullable<
  MutationResolvers["sendTestEmail"]
> = async (_parent, { to }, ctx) => {
  if (!isAllowedRecipient(ctx, to)) {
    throw new GraphQLError("Recipient is not in MAIL_TEST_RECIPIENTS");
  }

  // A placeholder link, because nothing in this slice issues real tokens. What is
  // being proven is the pipeline, not the URL.
  const message = await renderVerifyEmail(
    "https://__PROJECT__.example/api/auth/verify-email?token=slice-7",
  );
  await createMailer(ctx).send({ to, ...message });

  return true;
};
EOF
```

`createMailer(ctx)` typechecks because `MailEnv` is declared structurally and `WorkerEnv`
now carries all three keys.

## Local gate

```bash
cd ../..
```

**Two rounds, and they are not interchangeable.** The first is scriptable and belongs to
whoever is building the slice. The second is a person looking at something no assertion
covers — a rendered template, an inbox, a plain-text part. Naming them separately is what
stops the manual half being quietly skipped because the automated half went green, and it is
what tells the person which rows are actually theirs.

### Round 1 — automated

| Where          | Check                            | Expect                                            |
| -------------- | -------------------------------- | ------------------------------------------------- |
| root           | `pnpm typecheck`                 | pass                                              |
| root           | **`pnpm lint`**                  | **`6 successful`** — 4 lint + 2 `codegen` (was 5) |
| root           | **`pnpm test:unit`**             | **`Tests 32 passed`** — 22 + email 7 + graphql 3  |
| root           | **`pnpm test:integration`**      | **`Tests 2 passed`** — unchanged                  |
| root           | `pnpm docs:check`                | no drift                                          |
| `apps/graphql` | `pnpm wrangler deploy --dry-run` | bundles, and reports the upload size              |

### Round 2 — manual, and every row is one click

Start `pnpm dev` in `apps/graphql` first — it serves on `:8787`. Yoga ships GraphiQL on
`GET /graphql`, and GraphiQL reads `?query=` straight into its editor, so a link can arrive
**pre-filled and unrun**: press play, and nothing fires on load. Each distinct query opens its
own GraphiQL tab, so several such links do not overwrite each other.

**Write these links into the plan with the address already substituted.** A manual row that
makes the reader hand-write a mutation is a row that gets skipped or mistyped, and this is the
round where a mistyped recipient means testing nothing. `encodeURIComponent` the query; the
`Accept` header a browser sends is what selects GraphiQL over the JSON endpoint, so the same
URL under `curl` returns `405` unless you pass `-H 'accept: text/html'`.

| Open                                                                                                                                                         | Expect                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `pnpm email:dev` in `packages/email`, then the port it prints                                                                                                | the template renders; `</>` gives a Plain Text tab carrying the link              |
| [send to an allowed address](http://localhost:8787/graphql?query=mutation%20%7B%20sendTestEmail%28to%3A%20%22%3Cyour%20allowlisted%20address%3E%22%29%20%7D) | `{"data":{"sendTestEmail":true}}`, and one `[mail:log]` line in the Worker output |
| [send to an address off the list](http://localhost:8787/graphql?query=mutation%20%7B%20sendTestEmail%28to%3A%20%22nobody%40example.com%22%29%20%7D)          | an error, and **no** log line                                                     |

The third row is the reason this round exists. An allowlist that logs the refusal _after_
sending is the failure that looks fine in every test checking only the return value — and it
looks fine in row two as well. Only the absence of a second log line disproves it.

**The real-send row lives in the production gate, not here.** Flipping
`MAIL_TRANSPORT=resend` locally proves the same pipeline against the same API, so running it
at both ends spends money twice for one piece of evidence. If you do want it locally, the key
goes into `.env.development` by hand — see the fragment above — and goes back to `log`
afterwards, or `pnpm dev` sends real mail for the rest of the slice.

**Nothing in `test:integration` sends mail.** A test that hit Resend would cost money, need a
network, and deliver to a real inbox on every CI run. The transport split is what buys the
coverage instead: the unit tests assert the exact payload against a mocked SDK, and the one
real send is a gate row a human performs.

## Production gate

Steps 1–3 run once per account. Steps 4–6 are the gate and re-run on every later deploy that
touches mail.

Every command below runs in `apps/graphql`, and each step repeats the `cd` rather than
relying on one at the top. `wrangler` is a devDependency of that package, so from the root
`pnpm wrangler` fails with `Command "wrangler" not found`; and wrangler reads `wrangler.jsonc`
from the working directory, so the directory is what decides which Worker a secret attaches
to. A `cd` a reader can scroll past is a wrong-Worker secret waiting to happen.

### 1. Resend account and API key — one time

Sign up at [resend.com](https://resend.com), create a key with **Sending access** only.

`onboarding@resend.dev` is Resend's shared sender and delivers **only to the address you
signed up with**. Any other recipient is rejected at Resend, not by this code. Sending
elsewhere needs a verified domain and a new `MAIL_FROM`; the pipeline is proven either way.

### 2. `MAIL_TEST_RECIPIENTS` — one time

`wrangler.jsonc` ships the slice author's address. Change it to yours or step 5 refuses your
own send:

```jsonc
"MAIL_TEST_RECIPIENTS": "your-resend-account-address@example.com"
```

A `var`, so it takes a redeploy — do it before step 4. Not a secret: the list is not
sensitive, and `src/mail.ts` failing closed is what makes it safe.

### 3. The secret — one time, again only to rotate

```bash
cd apps/graphql
pnpm wrangler secret put RESEND_API_KEY   # paste the key at the prompt
```

Interactive because the key is never a file, a flag, or a `vars` entry. Cloudflare stores it
against the Worker and **`wrangler deploy` does not clear it** — do not re-run this before
each deploy. `pnpm wrangler secret list` confirms it without revealing it.

### 4. Deploy — re-runnable

```bash
cd apps/graphql
pnpm wrangler deploy --dry-run
pnpm deploy:production
```

`apps/web` is untouched and does not redeploy. Idempotent; the step 3 secret survives.

The dry run reports the bundle, which this slice moves most: roughly 2576 KiB raw and 521 KiB
gzipped, about four times what preceded it. Cloudflare enforces the gzipped figure against
3 MiB on the free plan, so there is room — but React Email roughly doubled the upload for one
template, so measure the next addition.

That figure is also the check on taking `react-email` as a runtime dependency: it lands within
1% of what the three-package split measured before v6, which is the evidence that the CLI's
own esbuild/chokidar/socket.io/tailwindcss dependencies stay behind an entry point the Worker
never imports. Had they been reachable, the number would not be close.

### 5. Observe — re-runnable, each pass sends a real email

Against the deployed Worker, not localhost:

```bash
curl -s https://__PROJECT__-graphql.<account>.workers.dev/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"mutation { sendTestEmail(to: \"<your allowlisted address>\") }"}'
```

| Check                                      | Expect                                    |
| ------------------------------------------ | ----------------------------------------- |
| the call above                             | `{"data":{"sendTestEmail":true}}`         |
| your inbox                                 | the message arrives                       |
| the same call with an address off the list | an error, and no message                  |
| "show original" in the client              | a `text/plain` part, not just `text/html` |

`true` only proves Resend accepted it; arrival is what proves React Email rendered under
workerd and a Worker's egress reached the API. The plain-text part is invisible in a rendered
view, so read the raw source — that recipient is the reason the part exists.

### 6. If it fails

| Symptom                                      | Where it broke                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `Recipient is not in MAIL_TEST_RECIPIENTS`   | step 2, not redeployed since                                            |
| `MAIL_TRANSPORT=resend needs RESEND_API_KEY` | step 3 never ran, or ran against a different Worker                     |
| `Resend refused the message: …`              | Resend — usually `MAIL_FROM` against the recipient from step 1          |
| `true`, but nothing arrives                  | spam folder, then Resend's dashboard, which logs every accepted message |

```bash
cd apps/graphql
pnpm wrangler tail        # then re-run step 5 in another shell
```

That separates "the resolver threw" from "Resend accepted and did not deliver".

Commit.

## The operating manual

````bash
cd ../..
mkdir -p .claude/skills/email
cat > .claude/skills/email/SKILL.md <<'EOF'
---
name: email
description: Write or change transactional email in __PROJECT__ — React Email templates in packages/email, the render helpers, and the Resend transport. Use when a feature sends mail, when a template's copy or markup changes, or when the mail transport or sender address changes.
---

# email — `packages/email`

## Owns / never touches

- **Owns:** `emails/*.tsx` (templates), `src/render.tsx` (subject + html + text),
  `src/mailer.ts` (transports). Exported through `src/index.ts`.
- **Never imports the Worker's `Env`.** `createMailer` takes `MailEnv`, declared
  structurally, so this package does not know it runs on Workers.
- **Never sends from a test.** Unit tests mock the `resend` module and assert the payload.
  The one real send is a gate row a human runs.
- Only `apps/graphql` imports this package. `apps/web` has no reason to.

## Adding a template

```bash
# 1. emails/<name>.tsx — a component, plus a default export and PreviewProps
# 2. src/render.tsx — a render<Name>Email() returning { subject, html, text }
# 3. export it from src/index.ts
pnpm --filter @__PROJECT__/email email:dev      # preview on :3001, not :3000
```

- **Inline styles only.** Email clients strip or ignore `<style>` and there is no cascade.
  This is the one place in the repo where naming a colour is correct — `theme.css` does not
  reach a mail client.
- **Always render a text alternative** (`render(element, { plainText: true })`). Without one
  the message scores as spam and shows empty in a client with HTML off.
- **Import everything from `react-email`** — components and `render` both. The old
  `@react-email/components` and per-component packages are deprecated as of `react-email@6`;
  an example written before then imports from packages that still install and no longer get
  fixed.
- **The subject belongs in the render function, not the template.** A component renders a
  body; keeping the pair in one function is what stops a template going out under someone
  else's subject.
- **Every actionable link appears as bare text as well as a button.** A client that blocks
  the button otherwise leaves the recipient with no way through.

## Transports

`MAIL_TRANSPORT` selects one, and unset or unknown **throws**:

| Value    | Behaviour                      | Where                     |
| -------- | ------------------------------ | ------------------------- |
| `log`    | renders, prints, sends nothing | `.env.development`, tests |
| `resend` | sends; needs `RESEND_API_KEY`  | `wrangler.jsonc` `vars`   |

Never infer the transport from `NODE_ENV` or from whether a key is present: both fail open,
and a production deploy that lost its key would report every send as a success.

## Judgment calls

- `RESEND_API_KEY` is a **secret** — `wrangler secret put`, never a `vars` entry.
- `MAIL_FROM` must be on a domain Resend has verified for the account, or delivery fails at
  Resend rather than in your code. `onboarding@resend.dev` needs no domain but only delivers
  to your own account address.
- The Resend SDK returns `{ data, error }` and does **not** throw. An unchecked call makes a
  failed send indistinguishable from a successful one.
- `sendTestEmail` is a scaffold mutation guarded by `MAIL_TEST_RECIPIENTS`, which fails
  closed. Do not widen it, and do not model real mail on it — real sends are triggered by a
  domain event, not by a caller naming a recipient.

## Enforced elsewhere

- `src/mailer.test.ts` pins the payload, the error path, that `log` touches no network, and
  that an unset transport throws.
- `src/render.test.ts` pins that the link survives into the text alternative.
- `apps/graphql/src/mail.test.ts` pins the allowlist, including that empty means nobody.

EOF
````

`CLAUDE.md` gains the package, and nothing else — it is the one file every session pays for:

```diff
--- CLAUDE.md
 Worker; SDL modules colocated with resolvers under src/schema), packages/db (Drizzle
-schema + client), packages/config (shared tsconfig).
+schema + client), packages/email (React Email templates + Resend transport),
+packages/config (shared tsconfig).
```

## Sources and findings

The documentation this slice's §3 research rests on, and what running it actually turned up —
kept here rather than in a shared bibliography so that reading the slice is reading its
evidence. **Every version and claim below is dated.** A pin is only as good as its date;
re-check rather than inherit, and add a dated entry when you do (SKILL.md §7).

### Sources

- [Resend Node SDK](https://resend.com/docs/send-with-nodejs) and [Resend on Cloudflare Workers](https://resend.com/docs/send-with-cloudflare-workers)
- [React Email components](https://react.email/docs/components/html) and [`render`](https://react.email/docs/utilities/render)
- [React Email CHANGELOG](https://github.com/resend/react-email/blob/main/packages/react-email/CHANGELOG.md) — the v6 consolidation and its migration steps are only stated here
- [React Email CLI](https://react.email/docs/cli) (`email dev`)
- [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/) (`wrangler secret put`)

### Slice 5 — Email (checked 2026-09-01)

Versions at time of writing: `resend` 6.25.0, `react-email` 6.9.3, `@react-email/ui` 6.9.3,
`@react-email/render` 2.0.6 (transitive, exactly pinned by `react-email`).

- **`react-email@6.0.0` (2026-04-16) merged the whole library into one package**, and
  `@react-email/components` plus every per-component package is deprecated — "Package no
  longer supported", last published 2026-04-09. `@react-email/render` and `@react-email/ui`
  are the survivors. The changelog's own migration is three steps: remove
  `@react-email/components`, move `react-email` into `dependencies`, and import everything
  from `react-email`.
- **Nothing about that fails.** The deprecated packages install and export the same names, so
  the pre-v6 slice compiles, tests green, and deploys. The only signal is `pnpm add` printing
  `[WARN] deprecated …: Package no longer supported`. **Read install output, not exit codes** —
  a package that moved without changing its API has no other way to tell you.
- **The CLI in `dependencies` is not a bundle problem.** esbuild, chokidar, socket.io, prismjs
  and tailwindcss are reachable only from `dist/cli/index.mjs`. Measured Worker bundle after
  this slice: 2576.07 KiB raw / 520.84 KiB gzipped — within 1% of the pre-v6 three-package
  split.
- **`render(element, { plainText: true })` is unchanged** in `@react-email/render` 2.x, and
  the `workerd` export condition still lives on that package's own `package.json` (so it is
  honoured through `react-email`'s re-export, even though `react-email` itself declares only
  `import`/`require`).
- **`email dev` creates no `.react-email` directory** — v6 packs the preview server into
  `$HOME/.react-email`. It is `email build` and `email export` that write `.react-email/` in
  the project. Ignore it anyway; the commands are one word apart.
- **`--port` is a preference, not a reservation.** `email dev` takes the next free port and
  prints `Port 3001 is already in use, trying 3002`. Read the port off the output.
- **`@react-email/ui` is still absent from the CLI's own dependencies**, so the reference's
  reason for declaring it holds: without it `email dev` stops on an install prompt that, with
  no TTY, is a silent exit.
- **`resend` 6.25.0 still returns `{ data, error }` and does not throw**, and now declares
  `@react-email/render` as an _optional_ peer, so nothing warns when it is only transitive.
- **A `docs-check.ignore` entry must be added by a `diff` hunk with a context line.** A plain
  fenced block is prose to the checker, and an all-`+` hunk is rejected with `hunk has no
context or removed lines to anchor on`. This bit on the first run of this slice.

## Leaves behind

Read by Slice 99 (the audit), which treats this as a **cross-check and never as the source of truth** —
the code is that. An entry here is a claim about the repo; where the two disagree, the code
wins and this table is the finding.

**Provisional** is something built to prove a mechanism, with the condition that retires it.
**Accepted** is a risk taken knowingly, with the reasoning written down so a later slice can
re-decide it rather than rediscover it.

### Provisional

| Artifact                        | Why it exists                                                                    | Retired when                                                                                                                                                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sendTestEmail` + `src/mail.ts` | The slice needs something observable in production; nothing else sends mail yet. | **No slice retires it, and that is a known gap.** It has no successor: Slice 6 adds real verification mail _alongside_ it rather than replacing it, and Slice 7 documents it as part of the schema. Retire it deliberately, or accept it deliberately — but not by default. |

### Accepted

| Risk                                                      | Reachable by        | Why this is the right trade                                                                                                                                                                                                       |
| --------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An unauthenticated mutation sends real mail               | The entire internet | No session layer exists until Slice 6. `MAIL_TEST_RECIPIENTS` fails closed, so the worst a stranger achieves is mail to the one address already listed — not a relay, but still an unauthenticated way to fill the owner's inbox. |
| That mutation is discoverable through production GraphiQL | The entire internet | Inherited from Slice 2's default. This slice is the first to make that default _cost_ something, which is why it is restated here rather than left upstream.                                                                      |
| `MAIL_FROM` is Resend's shared `onboarding@resend.dev`    | —                   | Needs no verified domain, and delivers only to the account owner's own address, which bounds the blast radius while the pipeline is being proven. A real domain is required before real users.                                    |
