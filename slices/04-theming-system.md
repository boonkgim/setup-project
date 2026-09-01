# Slice 4 — Theming system: Tailwind, shadcn, and one theme file

Tailwind has been in the repo since Slice 1 — `create-next-app` installed it — but nothing
owns it. The scaffold left `globals.css` holding two hex tokens and a `body { font-family:
Arial }` that contradicts the Geist variables declared three lines above it, and Slice 2's page
paints itself with `bg-zinc-50 dark:bg-black text-zinc-600`. That page is _styled_ and it is
not _themeable_: every colour decision is spelled out at the point of use, so changing the look
means editing every component that has one.

This slice makes the look a layer. The default shadcn/ui look is what goes in — that is the
point of using it — but it arrives as **token values in one file that no component names**, so
re-theming later is editing that file and nothing else.

**The pipeline risk this slice proves.** CSS and fonts are _build output served from the
`ASSETS` binding_, and this slice adds the app's first client component. `next dev` serves
styles from memory and hydrates over a local socket, so it is evidence about neither. An
unstyled page in production, a font that silently falls back, and a toggle that renders but
does nothing are three distinct failures, all invisible locally — which is what the production
gate is for.

## The decisions

Six, made once here so nothing downstream has to re-litigate them:

| Decision                                                     | Why                                                                                                                                                                              |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Components in `apps/web/src/components/ui`                   | One consumer. shadcn's `init --monorepo` builds a shared `packages/ui` instead, and a package with a single importer is the same mistake the index rejects for a schema package. |
| Base UI primitives (`--base base`), `lucide` icons           | The CLI's current defaults. Radix and React Aria are equally supported and the component API is the same either way, so this is reversible and not worth a decision.             |
| `nova` visual style, `neutral` base colour                   | The default look, as literally as the CLI will give it.                                                                                                                          |
| `cssVariables: true`, always                                 | The setting the whole slice depends on. `false` inlines palette values into each component's classes, and then re-theming is a find-and-replace across `src/`.                   |
| Dark mode by a `.dark` **class**, not `prefers-color-scheme` | A media query cannot be toggled. The scaffold's `globals.css` used one; nothing can offer a light/dark control on top of it.                                                     |
| Token **values** in `src/styles/theme.css`, alone            | The rest of this document, from "Split the theme out of the plumbing" down.                                                                                                      |

If a second app ever needs these components, the migration is the one the index already
describes for Workers: create `packages/ui`, move `src/components/ui` into it, point both
`components.json` files at it. Doing it now would be paying for a boundary with no second side.

## Install

```bash
cd apps/web
pnpm dlx shadcn@latest init --template next --base base --preset nova --no-monorepo
```

`--preset <style>` is what makes the run non-interactive; without it the CLI prompts for the
visual style and hangs. **Do not trust `init --help` for its value** — as of shadcn 4.19 the help
text advertises `--defaults` as `--preset=base-nova`, and the CLI rejects that string:
`Invalid preset: base-nova. Available presets: nova, vega, maia, lyra, mira, luma, sera, rhea`.
The preset is the style name alone; `base-nova` is what `components.json`'s `style` field ends up
as (`<base>-<style>`). `--no-monorepo` answers the monorepo prompt, which must be answered no:
the CLI's monorepo is the `packages/ui` layout the decisions table rejects. There is no
`--base-color` flag any more — the preset carries it — and `--css-variables` is already the
default.

The flags move between CLI releases, so re-check them; `components.json` below is the durable
record of the answers either way. Record whatever the CLI writes there rather than composing it:
4.19 adds `rtl`, `menuColor`, `menuAccent` and `registries`, and a shorter hand-written file
silently drops them.

What that leaves behind: `components.json`, a rewritten `src/app/globals.css` (the token block,
the `@theme inline` mapping, and a `@layer base`), `src/lib/utils.ts` (the `cn` helper), and
dependencies — `shadcn`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`,
`tw-animate-css`, plus the primitives for the base you chose.

None of those go in the `catalog:` block. The catalog exists for packages **more than one
workspace member installs** — `typescript`, `eslint`, `@types/node` — where npm's `latest`
would silently un-align two packages. These are `apps/web`'s alone, so a plain `pnpm add` is
correct and a catalog entry would be a second place to maintain a version with nothing to
align it against.

Two more things the CLI does not bring:

```bash
pnpm add next-themes
pnpm dlx shadcn@latest add card
```

`button` and `card` are the whole component budget for this slice — enough to render one real
surface and one real control, which is what the gate needs to be able to see — but check what
`init` already wrote before asking for either. With `base-nova` it creates
`src/components/ui/button.tsx` and `src/lib/utils.ts` itself, so only `card` has to be added.

Then pin the config the CLI wrote — small, stable, account-independent, so the doc owns it
whole:

```bash
cat > components.json <<'EOF'
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "base-nova",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "utils": "@/lib/utils",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
EOF
```

`style` is `<base>-<visual style>`, which is why one field carries two of the decisions above.
`tailwind.config` is empty on purpose: Tailwind v4 has no config file, and the CLI reads that
emptiness as "v4" rather than guessing. `rsc: true` is what stops the CLI stamping
`"use client"` onto every component it generates in an App Router project.

**`src/lib/utils.ts` and `src/components/ui/*` are the CLI's, and this doc does not write
them.** Same rule as the Hyperdrive id in Slice 2: a whole-file heredoc for a file a generator
owns replaces real content with a snapshot that goes stale on the next `shadcn add`. They are
committed — they are your source, that is shadcn's whole premise — but the plan of record
describes the command that produces them, not their contents.

## Split the theme out of the plumbing

The CLI puts everything in `globals.css`: the imports, the `@theme inline` mapping, the
`:root`/`.dark` token values, and the base layer. Three of those four are plumbing you will
never deliberately edit. The fourth _is_ the design, and it is the one thing that should be
easy to find, diff, and replace. So move it out.

This works because of what `inline` means. With `@theme inline`, Tailwind compiles
`bg-background` straight to `background-color: var(--background)` — the utility carries the
`var()` reference itself and Tailwind emits no `--color-background` at all. The token's
_value_ can therefore be declared anywhere in the document, including a file the CLI never
touches:

```css
/* what Tailwind emits for `bg-background`, given `--color-background: var(--background)` */
.bg-background {
  background-color: var(--background);
}
```

Drop the `inline` and Tailwind instead defines `--color-background: var(--background)` in its
own `:root` and compiles the utility to `var(--color-background)`. That indirection is resolved
on the element where it is declared, so a `.dark` block on a _descendant_ — a dark-themed panel
inside a light page, or any nested scope — no longer reaches it, and every colour in that
subtree stays light. `inline` removes the whole class of bug, which is why shadcn generates it
and why nothing below works without it.

The values, and nothing else:

```bash
mkdir -p src/styles
cat > src/styles/theme.css <<'EOF'
/* The look, and the whole look. Token *values* live here and nowhere else; the mapping
 * that turns them into Tailwind utilities lives in app/globals.css. Re-theming the app
 * is editing this file -- no component changes, because no component names a colour.
 *
 * Every token appears twice, once per scheme. `--radius` is the exception: a corner
 * radius is not a colour and does not change with the scheme. */
:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --chart-1: oklch(0.87 0 0);
  --chart-2: oklch(0.556 0 0);
  --chart-3: oklch(0.439 0 0);
  --chart-4: oklch(0.371 0 0);
  --chart-5: oklch(0.269 0 0);
  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-primary: oklch(0.205 0 0);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.97 0 0);
  --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border: oklch(0.922 0 0);
  --sidebar-ring: oklch(0.708 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
  --chart-1: oklch(0.87 0 0);
  --chart-2: oklch(0.556 0 0);
  --chart-3: oklch(0.439 0 0);
  --chart-4: oklch(0.371 0 0);
  --chart-5: oklch(0.269 0 0);
  --sidebar: oklch(0.205 0 0);
  --sidebar-foreground: oklch(0.985 0 0);
  --sidebar-primary: oklch(0.488 0.243 264.376);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.269 0 0);
  --sidebar-accent-foreground: oklch(0.985 0 0);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: oklch(0.556 0 0);
}
EOF
```

Those are the CLI's `neutral` values, moved verbatim. **Add nothing.** Earlier revisions of this
slice added `--destructive-foreground`, because shadcn used to map `--color-destructive-foreground`
in `@theme inline` without declaring the token, leaving `text-destructive-foreground` resolving to
nothing. As of shadcn 4.19 that mapping is gone, and `base-nova`'s destructive button variant is
`bg-destructive/10 text-destructive` rather than the literal `text-white` that was the visible
symptom. Check before adding it back: if the `@theme inline` block the CLI writes has no
`--color-destructive-foreground` line, the token has nothing to fix and is just an entry the next
reader has to explain. The test below is the check.

Then the plumbing, which no longer contains a single decision:

```bash
cat > src/app/globals.css <<'EOF'
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "../styles/theme.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --font-sans: var(--font-sans-src);
  --font-mono: var(--font-mono-src);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }

  body {
    @apply bg-background text-foreground;
  }
}
EOF
```

Three things changed besides the extraction. The font mappings are **renamed**, and this is not
cosmetic: `init` runs an "Updating fonts" pass over the scaffold's `globals.css` and, as of 4.19,
emits `--font-sans: var(--font-sans)` — a token pointing at itself. Nothing errors; `font-sans`
simply stops resolving and the page silently falls back to the UA font. The `-src` rename fixes
that as a side effect of naming the seam properly, and is the reason to do it even in a project
that never changes its font. `--font-heading` is new in `base-nova` (`CardTitle` uses it) and
points at the same source.

The `--font-sans` / `--font-mono` mappings are otherwise the scaffold's, kept — they resolve to
the variables `next/font` declares in `layout.tsx`, and they are why `font-sans` means Geist —
but those variables are **renamed**. The scaffold called them
`--font-geist-sans` / `--font-geist-mono`, and a variable named after a family lies the day the
family changes; this is the one seam a font swap goes through, so it names its role instead.
`--font-sans-src` is the source `font-sans` resolves to, and "Geist" is now written in exactly
one place: the `next/font` call in `layout.tsx`. The scaffold's `body { font-family: Arial,
Helvetica, sans-serif }` is **gone**: it was a plain CSS rule overriding the font the app went
to the trouble of self-hosting, and `@layer base` now paints `body` from the tokens instead. And the
`@media (prefers-color-scheme: dark)` block is gone, replaced by `@custom-variant dark (&:is(.dark
*))` — the line that makes `dark:` mean "inside `.dark`" and makes the next section possible.

The four `@import`s and the `@custom-variant` line are the CLI's. If a newer CLI writes a
different set, keep its version rather than this one and let `pnpm docs:check` tell you the doc
drifted — that check exists for exactly this.

**What each file costs you from here.** `theme.css` changes when the look changes, which is the
point. `globals.css` changes only when the token _vocabulary_ grows — `shadcn add` appends a
mapping line and a token block for a component that needs new ones. When it does: keep the
mapping line, move the values down into `theme.css`, and the invariant holds. `pnpm docs:check`
flags the file either way, and the fix is "update the doc" when the vocabulary genuinely grew.

**Re-theming later, the vendor's way.** `pnpm dlx shadcn@latest apply --preset <code> --only
theme` swaps the whole token set from a preset code, and `--only font` does typography alone —
neither touches your components, which is the payoff for never naming a colour in one. The
trap: `apply` writes the tokens back into `globals.css`, where they now sit _after_ the
`@import` of `theme.css` and win on cascade order. It will look like it worked. Move the new
block into `theme.css` and delete it from `globals.css`, or the two files disagree and the one
you edit is the one that does nothing.

**Changing the font later.** `theme.css` has no say in it, and that is not an oversight:
`next/font` self-hosts the file at build time and emits the variable onto `<html>` with a
hashed URL, so there is no value to write down in CSS the way there is for a colour. The swap
is the two `next/font` calls in `layout.tsx` and nothing else — that is what the `-src` rename
buys, and `next/font/local` is the same shape for a file you ship yourself. What must not
happen is a `font-family` declaration landing in `theme.css` or a `body` rule: that is the
Arial line this slice deletes, and it costs you the self-hosting and preload the production
gate checks for.

## The theme contract, as a test

Two files that must agree can disagree, and every way they disagree here is invisible in
review: a token with no dark value silently renders its light one, a token misspelled under
`.dark` silently does nothing, a mapping pointing at a token nobody declared silently renders
no colour at all. None of that fails a build. So assert it:

```bash
cat > src/styles/theme.test.ts <<'EOF'
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// The theme is deliberately two files -- values here, the Tailwind mapping in
// app/globals.css -- so they can disagree, and every way they disagree is invisible in
// review: a token with no dark value silently renders its light one, a token misspelled
// under `.dark` silently does nothing at all. This is that seam's contract.
const read = (p: string) => readFileSync(join(import.meta.dirname, p), "utf8");
const theme = read("theme.css");
const globals = read("../app/globals.css");

/** The declarations inside a top-level `<selector> { ... }` block. */
function block(css: string, selector: string): string {
  const found = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(css);
  if (!found) throw new Error(`no \`${selector}\` block found`);
  return found[1];
}

/** Custom-property names declared in a chunk of CSS, without the leading `--`. */
const declared = (css: string) =>
  new Set([...css.matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]));

const light = declared(block(theme, ":root"));
const dark = declared(block(theme, "\\.dark"));

// Supplied by next/font in layout.tsx, so the theme is right not to define them.
const EXTERNAL = new Set(["font-sans-src", "font-mono-src"]);
// Not a colour: one corner radius serves both schemes.
const SCHEME_INDEPENDENT = new Set(["radius"]);

test("every token the Tailwind mapping references is defined in the theme", () => {
  const referenced = [
    ...block(globals, "@theme inline").matchAll(/var\(--([a-z0-9-]+)\)/g),
  ].map((m) => m[1]);
  expect(referenced.length).toBeGreaterThan(0);
  expect(referenced.filter((t) => !light.has(t) && !EXTERNAL.has(t))).toEqual(
    [],
  );
});

test("every colour token has a dark value", () => {
  expect(
    [...light].filter((t) => !dark.has(t) && !SCHEME_INDEPENDENT.has(t)),
  ).toEqual([]);
});

test("the dark block overrides nothing the light block never declared", () => {
  expect([...dark].filter((t) => !light.has(t))).toEqual([]);
});
EOF
```

Hermetic — it reads two files out of the repo and nothing else, so it behaves the same on every
machine and in CI. It needs no jsdom and no React plugin either, which is the note Slice 1 left
on `vitest.config.ts`: that wiring waits for a test that actually renders something.

This used to fail on its first run against the CLI's untouched output, naming
`destructive-foreground`. As of shadcn 4.19 it passes, because that mapping is gone. Expect
either outcome and read the failure rather than assuming it: a green first run means the
invariant currently holds, which is all an invariant check can ever tell you.

The two allowlists are the only places a token may legitimately be absent, and both are one
name long. Anything else added to them is a decision being hidden from the test rather than
made.

## The rule that keeps components colour-free

"No component names a colour" is the invariant the whole slice rests on, and an invariant
nothing checks is a preference. Make it a lint rule — appended in `apps/web`, because it is
genuinely app-specific — this is the only package with JSX:

```bash
cat > eslint.config.mjs <<'EOF'
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import base from "../../packages/config/eslint.base.mjs";

// Tailwind's palette utilities, the ones a semantic token is supposed to replace:
// `bg-zinc-50`, `text-red-600`, `border-white`. Matched inside className only, and
// only as a whole utility -- the `(?:^| |:)` prefix is what lets `dark:bg-black` match
// while leaving `bg-background` and a token named after a colour alone.
const PALETTE_UTILITY =
  "(?:^| |:)(?:bg|text|border|ring|fill|stroke|outline|decoration|divide|shadow|caret|accent|placeholder|from|via|to)-(?:black|white|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))(?:$| )";
const PALETTE_MESSAGE =
  "Raw palette colour in className. Use a semantic token (bg-background, text-muted-foreground, ...) so src/styles/theme.css stays the only place the look is decided.";

const eslintConfig = defineConfig([
  // The workspace base first, then Next's configs on top: eslint-config-next
  // carries the React/hooks/core-web-vitals rules the base cannot know about,
  // and later blocks win on any rule both set.
  ...base,
  ...nextVitals,
  ...nextTs,
  {
    // The theme contract, as a lint rule. Two selectors because a className is
    // written two ways: a plain string (or one inside a cn() call, which is still a
    // descendant of the attribute) and a template literal, whose text lives on
    // TemplateElement rather than Literal.
    files: ["src/**/*.tsx"],
    // src/components/ui is a vendored checkout of the shadcn registry, not code we
    // write. It does reach for a literal colour occasionally (`text-white` in the
    // destructive button variant), and re-running `shadcn add` must not turn into a
    // lint fight over the vendor's choices.
    ignores: ["src/components/ui/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: `JSXAttribute[name.name='className'] Literal[value=/${PALETTE_UTILITY}/]`,
          message: PALETTE_MESSAGE,
        },
        {
          selector: `JSXAttribute[name.name='className'] TemplateElement[value.raw=/${PALETTE_UTILITY}/]`,
          message: PALETTE_MESSAGE,
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
EOF
```

`no-restricted-syntax` takes an [esquery](https://github.com/estools/esquery) selector, and
`[value=/regex/]` is how it matches a node's text — which is what lets one rule cover
`className="bg-zinc-50"`, `className={cn("bg-zinc-50", x)}` (the string is still a descendant
of the attribute) and ``className={`bg-zinc-50 ${x}`}`` (a `TemplateElement`, which is why
there are two selectors and not one).

`pnpm lint` now fails, with eight errors, all of them in the Slice 2 `page.tsx` — which is
the next section, and the reason the rule lands before the rewrite rather than after it. A
guardrail added after the code it governs is already clean tends to be a guardrail that was
written to match the code; this one had to be satisfied.

The rule is deliberately narrow. It does not catch an arbitrary hex in an inline `style`, and it
does not stop anyone declaring a new token — it catches the one habit that actually erodes a
theme, which is spelling a palette colour where a token belongs.

## Dark mode

```bash
mkdir -p src/components
cat > src/components/theme-provider.tsx <<'EOF'
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

// next-themes serialises its pre-hydration function to a string and inlines it, so the
// browser evaluates whatever the *server* bundler emitted. That bundler runs esbuild
// with `keepNames`, which wraps nested declarations as `__name(fn, "fn")` -- a helper
// that exists in the bundle but not in the inline script. The script throws
// `ReferenceError: __name is not defined` before it can set the class, so <html> reaches
// the browser unthemed and the page paints light before React corrects it: the flash
// next-themes exists to prevent. Open upstream bug, no fix in 0.4.6:
// https://github.com/pacocoursey/next-themes/issues/370
//
// Invisible in `next dev`, which never runs the production bundler -- the production
// gate is what found it. A no-op shim is enough: `__name` only tags a function name for
// stack traces, so returning the function unchanged restores the exact behaviour.
// Declared before NextThemesProvider so it is in the document ahead of the script that
// needs it, and `??=` so a real helper, if one ever lands, wins.
const NAME_SHIM = "globalThis.__name??=(f)=>f;";

// The app's first client component. next-themes reads localStorage and sets the class
// on <html>, which is browser work by definition -- and the reason layout.tsx needs
// suppressHydrationWarning. Re-exported rather than used directly so the "use client"
// boundary is one file we own, not a vendored module's default.
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: NAME_SHIM }} />
      <NextThemesProvider {...props}>{children}</NextThemesProvider>
    </>
  );
}
EOF
cat > src/components/mode-toggle.tsx <<'EOF'
"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ModeToggle() {
  const { setTheme, resolvedTheme } = useTheme();

  return (
    <Button
      variant="outline"
      size="icon"
      aria-label="Toggle colour scheme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {/* Which icon shows is decided by CSS off the `.dark` class, not by
          `resolvedTheme` -- that value is undefined until the client mounts, so
          rendering from it would either mismatch on hydration or need a mounted
          guard. The class is already on <html> before React runs. */}
      <Sun className="hidden size-4 dark:block" />
      <Moon className="size-4 dark:hidden" />
    </Button>
  );
}
EOF
```

**The `__name` shim is the trap this slice's production gate exists to catch, and it is worth
carrying forward whether or not it is still needed.** next-themes prevents the flash of wrong
theme by serialising a function to a string and inlining it, so the browser runs whatever the
_server_ bundler emitted. That bundler runs esbuild with `keepNames`, which rewrites nested
declarations as `__name(fn, "fn")` — a helper that exists inside the bundle and nowhere near an
inline `<script>`. The script throws `ReferenceError: __name is not defined` before it can set
the class.

The failure mode is the point: nothing fails. Build green, tests green, toggle still works,
because React sets the class after hydration. The only symptom is the page painting the wrong
theme for a few frames — the exact flash next-themes was added to prevent, quietly
reintroduced. `next dev` cannot show it (it never runs the production bundler); `pnpm preview`
and a deploy both can, which is why the gate below checks the console rather than trusting the
eye.

Open upstream bug as of next-themes 0.4.6, no fix:
<https://github.com/pacocoursey/next-themes/issues/370>. **Check whether it is still open before
copying the shim** — if the inline script in the built HTML has no `__name(` in it, drop the
shim. It costs nothing when unnecessary, but an unexplained global is worse than none.

`attribute="class"` below is not a preference either: it is what makes next-themes write the
`.dark` class that `@custom-variant dark (&:is(.dark *))` is looking for. Set it to anything
else and every `dark:` utility in the app goes quiet, with no error anywhere.

```bash
cat > src/app/layout.tsx <<'EOF'
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// The font seam. next/font owns these values -- it self-hosts the file at build time
// and emits the variable onto <html> -- so unlike a colour they cannot live in
// theme.css. Both names are family-neutral on purpose: changing the site's font is
// swapping the two calls here, and nothing downstream says "geist".
const sans = Geist({
  variable: "--font-sans-src",
  subsets: ["latin"],
});

const mono = Geist_Mono({
  variable: "--font-mono-src",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "__PROJECT__",
  description: "A small store, built in thin slices.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning is required here, not cosmetic: next-themes sets the
    // class on this element from an inline script that runs before hydration, so the
    // server's markup and the client's first read of it legitimately differ. Scoped to
    // <html>, it does not silence mismatches anywhere else.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      {/* No colours here: `@layer base` in globals.css paints body from the tokens. */}
      <body className="flex min-h-full flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
EOF
```

The `metadata` block also stops saying `Create Next App`, which is the last piece of scaffold
text a visitor could read.

## The page

Same four values as Slice 2 — the SDL, the codegen, and `graphqlFetch` are untouched, because
this slice is not a vertical cut and has no business changing the contract. What changes is
that nothing in it names a colour:

```bash
cat > src/app/page.tsx <<'EOF'
import { graphqlFetch } from "@/lib/api";
import { graphql } from "@/generated";
import { ModeToggle } from "@/components/mode-toggle";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Codegen scans for these calls and types the document by its result shape, so the
// destructuring below is checked against the SDL. Rename a field there and this stops
// compiling -- where the old hand-written result type would have kept compiling and
// rendered `undefined`.
const HomeQuery = graphql(`
  query Home {
    version
    health
    appEnv
  }
`);

// Server component: this runs in the Worker, so the query goes over the service
// binding in production and to the local Worker in dev. Nothing reaches the browser.
export default async function Home() {
  const res = await graphqlFetch(HomeQuery);

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        {/* CardHeader is a grid, not a flex row: it switches to
            `grid-cols-[1fr_auto]` when it contains a CardAction, which is the
            slot a header-level control belongs in. Laying the toggle out with
            flex utilities here would be fighting the component. */}
        <CardHeader>
          <CardTitle>__PROJECT__</CardTitle>
          <CardAction>
            <ModeToggle />
          </CardAction>
        </CardHeader>
        <CardContent>
          {res.errors ? (
            <p className="text-destructive font-mono text-sm">
              {res.errors.map((e) => e.message).join(", ")}
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm">
              <dt className="text-muted-foreground">api version</dt>
              <dd>{res.data?.version}</dd>
              <dt className="text-muted-foreground">db health</dt>
              <dd>{res.data?.health}</dd>
              <dt className="text-muted-foreground">api env</dt>
              <dd>{res.data?.appEnv}</dd>
              {/* The build-time half of the same value: written as a literal member
                  expression because that is the only form next build inlines --
                  process.env[name] and destructuring are left untouched and arrive
                  undefined in the browser. */}
              <dt className="text-muted-foreground">web env</dt>
              <dd>{process.env.NEXT_PUBLIC_APP_ENV}</dd>
            </dl>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
EOF
```

`text-destructive` on the error path is the one place the page expresses intent about colour,
and it does it by naming the intent. Whatever `--destructive` becomes, that line is already
right.

**Local gate** — Docker up, both dev servers running, `pnpm turbo codegen` if you have not run
`pnpm install` since the `add`:

| Where                  | Check                          | Expect                                                                |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------- |
| browser                | `localhost:3000`               | the card, in Geist, with the four values from Slice 2 still correct   |
| browser                | the toggle                     | light ⇄ dark, no flash on reload, and the OS setting is the default   |
| `src/styles/theme.css` | change `--primary` to anything | the whole app follows; **no other file edited** — this is the slice   |
| `apps/web`             | `pnpm preview`                 | same page under workerd, styles and font intact                       |
| root                   | `pnpm typecheck`               | pass                                                                  |
| root                   | **`pnpm lint`**                | **`5 successful`** — unchanged; the new rule is satisfied, not absent |
| root                   | **`pnpm test:unit`**           | **`Tests 22 passed`** — 19 from Slice 2 + 3 (the theme contract)      |
| root                   | `pnpm test:integration`        | `Tests 2 passed` — unchanged                                          |

The third row is the only one that tests what this slice is _for_. Revert the token afterwards.

**Production gate** — nothing here touches the API, so web alone, from root:

```bash
pnpm --filter @__PROJECT__/web deploy:production
```

Then, on the deployed URL, four things `next dev` could not have told you:

- The page is **styled**. An unstyled page is what a CSS file that never made it into
  `.open-next/assets` looks like, and it is a build-output failure, not a code one.
- The font is **Geist**, not the fallback. `next/font` self-hosts the file at build time; it
  ships as an asset like any other and can go missing like one.
- The **toggle works**, and survives a reload. That is the client bundle hydrating under
  workerd — the first time this app has needed that to be true.
- **The console is clean, and there is no flash.** Check this in the console, not by eye — a
  flash is a few frames. `document.documentElement.style.colorScheme` is set by a line _after_
  the `__name(k2, "k2")` call, so a non-empty value proves the whole pre-hydration script ran;
  and `domInteractive` at or before `first-contentful-paint` is the class landing before paint.
- A **hard reload with the cache disabled** still gets both. Otherwise you are reading your own
  browser cache from the `pnpm preview` run.

Commit.

## The operating manual for this layer

The theme contract is the bulk of what there is to know about working in `apps/web`, which is
why the web skill is written here and not back at Slice 1: a shell has no rules worth writing
down, and a token system has several that are invisible until you break one.

Note what the skill does _not_ restate. The palette rule is enforced by
`no-restricted-syntax` and the token coverage by `theme.test.ts`, so the skill names the
enforcer and the failure message instead of repeating the rule. A rule with two sources drifts;
the linter is the one that wins, so it stays the only copy.

````bash
cd ../..   # to the repo root
cat > .claude/skills/web/SKILL.md <<'EOF'
---
name: web
description: Change the __PROJECT__ Next.js app in apps/web — pages, components, typed GraphQL operations, and theming. Use when a feature needs UI, a new query from the web side, or a re-theme. Covers typed documents from codegen, the graphqlFetch boundary, the theme token contract, and the vendored shadcn checkout.
---

# web layer — `apps/web`

## Owns / never touches

- **Owns:** `src/app/**` (routes), `src/components/**`, `src/lib/**`, `src/styles/theme.css`.
- **Never imports `@__PROJECT__/db`.** Web reaches data only through the GraphQL API. The
  dependency graph is what enforces the architecture.
- **Never edits `src/generated/**`** — regenerated from the API's merged SDL.
- **This is not the Next.js you know.** Next 16 has breaking changes against training data:
  read the relevant guide in `node_modules/next/dist/docs/` before reaching for an API from
  memory. `export const dynamic` is gone — `connection()` replaces it.

## Query mechanics

```bash
# 1. write the operation inside graphql`...` from @/generated
# 2. pnpm turbo codegen --filter @__PROJECT__/web    # types it off apps/graphql's merged SDL
# 3. call it with graphqlFetch from @/lib/api
```

```ts
const HomeQuery = graphql(`
  query Home {
    version
    health
    appEnv
  }
`);
const res = await graphqlFetch(HomeQuery);
```

- `documentMode: "string"` — the document is a **String subclass, not a DocumentNode**.
  Don't `print()` it and don't pull the graphql runtime into the Worker bundle to send it.
- `graphqlFetch` already calls `connection()` at the boundary, because reading Worker
  bindings needs a real request and `getCloudflareContext()` throws during prerender.
  **Don't add your own prerender opt-out in a page** — the helper is where it belongs so a
  new page cannot forget it.
- Variables are positional-by-type: the argument is required exactly when the operation
  declares variables.

## Theme

- **`src/styles/theme.css` holds every token _value_ and is the only file a re-theme
  touches.** No component changes, because no component names a colour.
- `src/app/globals.css` holds the `@theme inline` mapping and changes only when the token
  _vocabulary_ grows.
- **Every colour token needs both a `:root` and a `.dark` value.** A token missing its dark
  value silently renders its light one.
- **Dark mode is a `.dark` class, never `prefers-color-scheme`** — a media query cannot be
  toggled.
- **`src/components/ui/**` is a vendored checkout of the shadcn registry**, not code we
  write. The CLI owns it and `shadcn add` rewrites it, so an edit there is a fork you are
  choosing to maintain. Compose around these components rather than editing them — e.g.
  `CardHeader` becomes a `grid-cols-[1fr_auto]` when it contains a `CardAction`, so put a
  header control in that slot instead of fighting it with flex utilities.

## Judgment calls

- **No component ever names a colour.** Semantic tokens only: `bg-background`,
  `text-muted-foreground`, `text-destructive`.
- `NEXT_PUBLIC_*` must be written as a **literal member expression**
  (`process.env.NEXT_PUBLIC_APP_ENV`). `process.env[name]` and destructuring are not
  inlined by `next build` and arrive `undefined` in the browser. Nothing secret ever gets
  the `NEXT_PUBLIC_` prefix.
- New binding in `wrangler.jsonc` → `pnpm cf-typegen`.
- `next dev` rewrites the rules block in `AGENTS.md`. Committing that with your work keeps
  the tree clean; removing it just re-creates the uncommitted change.

## Enforced elsewhere

- The palette rule: `no-restricted-syntax` in `apps/web/eslint.config.mjs` fails lint with
  _"Raw palette colour in className. Use a semantic token…"_. It matches both string and
  template-literal `className`s, and skips `src/components/ui/**`.
- `src/styles/theme.test.ts` asserts the seam from the other side: every mapped token is
  declared, every colour token has a dark value, and the dark block overrides nothing the
  light block never declared.
- `--max-warnings 0` is part of `lint` — a warning that does not fail is a rule nobody obeys.

EOF
````

## Sources and findings

The documentation this slice's §3 research rests on, and what running it actually turned up —
kept here rather than in a shared bibliography so that reading the slice is reading its
evidence. **Every version and claim below is dated.** A pin is only as good as its date;
re-check rather than inherit, and add a dated entry when you do (SKILL.md §7).

### Sources

- [shadcn/ui Next.js installation](https://ui.shadcn.com/docs/installation/next)
- [shadcn/ui theming](https://ui.shadcn.com/docs/theming) (the token list and the base colours)
- [shadcn/ui `components.json`](https://ui.shadcn.com/docs/components-json)
- [shadcn CLI](https://ui.shadcn.com/docs/cli) (`init --base`, `apply --only theme`)
- [shadcn/ui dark mode, Next.js](https://ui.shadcn.com/docs/dark-mode/next)
- [shadcn/ui in a monorepo](https://ui.shadcn.com/docs/monorepo) (the shared-package layout Slice 4 declines)
- [Tailwind CSS theme variables](https://tailwindcss.com/docs/theme) (`@theme`, and what `inline` changes)
- [Next.js CSS](https://nextjs.org/docs/app/getting-started/css) and [font optimization](https://nextjs.org/docs/app/getting-started/fonts)
- [esquery selectors](https://github.com/estools/esquery) (what `no-restricted-syntax` takes)

### Slice 4 — Theming system (checked 2026-08-31)

Versions at time of writing: `shadcn` 4.19.0, `next-themes` 0.4.6, `lucide-react` 1.38.0,
`tailwindcss` 4.3.3, `tw-animate-css` 1.4.0, `tailwind-merge` 3.6.0,
`class-variance-authority` 0.7.1. Primitives for `--base base` install as **`@base-ui/react`**,
not `@base-ui-components/react` — read off the style registry's own dependency list.

- **`init --help` lies about `--preset`.** It documents `--defaults` as
  `--preset=base-nova`; passing that gets `Invalid preset: base-nova. Available presets: nova,
vega, maia, lyra, mira, luma, sera, rhea`. The preset is the style name alone. `base-nova` is
  the `components.json` `style` value (`<base>-<style>`), which is presumably where the stale
  help string came from.
- **`--preset` is also what makes the run non-interactive.** Without it the CLI prompts for the
  visual style and the command hangs — a two-minute timeout with no output was the first
  symptom. `-y` does not cover it. `--no-monorepo` is needed too, in a workspace.
- **There is no `--base-color` flag.** The preset carries the base colour; `components.json`
  still records `baseColor: "neutral"`.
- **`init` writes `src/components/ui/button.tsx` and `src/lib/utils.ts` itself** for
  `base-nova`. Only `card` needs `shadcn add`.
- **`components.json` gained fields the reference did not know:** `rtl`, `menuColor`,
  `menuAccent`, `registries`. Record the CLI's file rather than composing a shorter one.
- **`@import "shadcn/tailwind.css"` is real** — `shadcn` is now a runtime dependency shipping
  `dist/tailwind.css`. It carries custom variants, `@utility` blocks and keyframes but **no
  colour token mapping**, so the `@theme inline` block still lands in `globals.css` and the
  values/plumbing split this slice depends on still works.
- **The CLI's "Updating fonts" pass writes `--font-sans: var(--font-sans)`** — a token pointing
  at itself. `font-sans` silently stops resolving and the page falls back to the UA font. The
  `-src` rename fixes it; without the rename this is a live bug.
- **`--color-destructive-foreground` is no longer mapped**, so the `--destructive-foreground`
  token this slice used to add is obsolete, and the theme-contract test now passes on the CLI's
  untouched output. `base-nova`'s destructive button variant is `bg-destructive/10
text-destructive` — the literal `text-white` that motivated the old note is gone.
- **Radius scale widened** to `--radius-2xl` / `-3xl` / `-4xl`, and the CLI's `@layer base` now
  carries a third rule, `html { @apply font-sans }`.
- **next-themes 0.4.6 is broken on OpenNext/workerd: `ReferenceError: __name is not defined`.**
  next-themes serialises its pre-hydration function to a string; the server bundler runs esbuild
  with `keepNames`, which wraps nested declarations as `__name(fn, "fn")`, and that helper does
  not exist in an inline `<script>`. The script throws before setting the class, so the page
  paints the wrong theme until React corrects it — the flash the library exists to prevent.
  Nothing fails: build, tests and the toggle are all green.
  Open upstream, no fix: <https://github.com/pacocoursey/next-themes/issues/370> (filed
  2025-10-04, still triage). Workaround is a no-op shim, `globalThis.__name??=(f)=>f;`, emitted
  ahead of the provider. **Invisible in `next dev`** — found only by reading the console on a
  deployed page, which is the argument for this slice's production gate in one line.

## Leaves behind

Read by Slice 99 (the audit), which treats this as a **cross-check and never as the source of truth** —
the code is that. An entry here is a claim about the repo; where the two disagree, the code
wins and this table is the finding.

**Provisional** is something built to prove a mechanism, with the condition that retires it.
**Accepted** is a risk taken knowingly, with the reasoning written down so a later slice can
re-decide it rather than rediscover it.

### Provisional

| Artifact                                   | Why it exists                                                                                                       | Retired when                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| The `globalThis.__name ??= (f) => f;` shim | Works around next-themes serialising a function that esbuild's `keepNames` rewrote — an upstream bug, not a choice. | next-themes/issues/370 ships a fix. Until then removing it returns the theme flash. |

### Accepted

Nothing security-relevant. This slice adds no surface: no route, no field, no binding, no secret.
