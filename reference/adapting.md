# Maintaining the slices

The slice files under `slices/` are the substance of this skill. They came from a working
repo's build plan and were made project-agnostic and self-contained. This file records what
was changed, so the next person editing them knows which rules to keep.

## The `__PROJECT__` token

The project name appears in the slices as the literal token `__PROJECT__` and nowhere else.
It resolves at install time to the `--name` value, everywhere at once:

| In the slice                 | Becomes               |
| ---------------------------- | --------------------- |
| `@__PROJECT__/db`            | `@acme/db`            |
| `__PROJECT__-web`            | `acme-web`            |
| `__PROJECT__-graphql`        | `acme-graphql`        |
| `localhost:5434/__PROJECT__` | `localhost:5434/acme` |
| `# __PROJECT__` in CLAUDE.md | `# acme`              |

**Never write a project name into a slice file.** A hard-coded name survives the install
and then disagrees with every generated file around it. When adding text, use the token —
including in prose, where `docs:check` never looks but a reader does.

Substitution is a plain `replaceAll`, so the token needs no word boundaries. That is the
one thing it has over the alternative: the upstream repo renames by regex over the whole
tree, and had to special-case `pnpm-lock.yaml` because a real dependency's name started
with the project's own.

## What was removed, and why

Four references pointed outside the plan. Each was cut rather than followed, because a
plan that references a file it does not install is not self-contained.

- **`scripts/project.mjs` / `pnpm check:project`.** The upstream repo has a per-clone
  identity script that fills env files and validates `wrangler.jsonc` against a
  `project.json`. The plan referenced it from three scripts but never created it. Those
  references are gone: `verify` no longer starts with `pnpm check:project`, and neither
  `deploy:production` shells out to it. This skill resolves identity at install time
  instead, which is the same job done once rather than continuously. If you want the
  continuous version back, it belongs in a slice of its own — its contents depend on which
  slices are installed, since it enumerates every env file and Worker secret.
- **`brief-to-prd`, `design-db`, `mock-ui`.** Named in slice 06's `CLAUDE.md` heredoc as
  skills to reach for before writing code. They are not part of this plan and are not
  installed by it, so the paragraph naming them was dropped. The `diff` hunks that slices
  05–07 apply to `CLAUDE.md` anchor on the _following_ paragraph, so they still apply.
- **`design-db`,** again, in slice 02's `code-db` skill description. Trailing clause removed.
- **`code-ui`.** Slice 6 referenced it by relative path into the upstream repo's
  `.claude/skills/`. It now ships as `assets/code-ui-SKILL.md`, is installed into
  the plan's `assets/` alongside the slices whenever 06 is selected, and slice 06 copies it
  from there.

One path was parameterized: the upstream `docs/2026-08-08-setup` is the token `__DOCS__`,
resolved on install to `docs/<YYYY-MM-DD>-setup`. That includes the `DOC` constant inside
slice 00's `scripts/docs-check.mjs` heredoc, which is what makes the plan checkable at all —
so if you add a slice that names the plan directory, write `__DOCS__` and never the literal
path, or `docs:check` will compare against a directory that is not there.

## Rules the slices depend on

Break these and `pnpm docs:check` fails in the target repo, usually with a message about a
file rather than about the doc.

- **Every file the plan creates is a `cat > <path> <<'EOF'` heredoc**, and every script a
  `pnpm pkg set`. That is what makes the plan mechanically comparable to the repo. Prose
  describing a file is a file that will drift unread.
- **A later slice amending an earlier slice's file uses a ` ```diff ` block** headed
  `--- <repo-relative path>`, never a second whole-file heredoc. `docs-check` composes the
  last heredoc plus every later hunk in slice order; recopying the heredoc means only the
  last copy is ever compared. Hunks anchor on context, never line numbers, and a hunk that
  stops applying is a hard error naming the file.
- **`cd` state carries across slice files, in filename order.** The numeric prefixes are
  load-bearing. A block's `cd` is written from wherever the previous block left you.
- **Prettier owns formatting — of the slice file itself, not just its heredocs.** A heredoc
  that is not already prettier-formatted gets rewritten by the first `pnpm format` in the
  target repo and disagrees from then on. When `docs:check` reports drift, the doc is usually
  the side to fix.

  The installed plan is a markdown file inside the repo it describes, so `format:changed`
  reformats it the first time anyone edits it — and a slice file that ships unformatted hands
  every project built from it that pending diff. Run `prettier --check slices/` after editing
  one. Mis-padded prose tables are the usual culprit: harmless in the skill, but they surface
  in the target repo as a spontaneous diff on a file nobody touched. (Four reference files
  carried exactly that until it was found by running slice 0 for real.)

## One kind of file in `docs/setup/`

The installer writes slice files and nothing else. There is no index and no copied source
list, and that is a deliberate reversal: both used to be rendered on every run, which made
them the only files in the plan that could not be corrected — an edit survived exactly until
the next install. A file the installer rewrites is a file whose corrections vanish, which is
the opposite of a plan of record.

So cross-slice prose has no home in the installed plan, and does not need one. A convention
lives in the slice that establishes it, stated as a standing rule (the `:production` suffix
and the env-file convention are both slice 0's). The package map lives in `CLAUDE.md`, which
the project owns and every session reads. The build discipline — the two gates, the order,
where gates run — belongs to `SKILL.md`, because a session extending the product never runs
`/setup-project` and should not be paying to read its process. And `ls docs/setup/` is the
index: the numeric prefixes are the order, and a slice file is present only once that slice
was built.

The rule for anything new: **if it would have to be filtered per slice to stay true, it is in
the wrong file.** Put it where it is unconditionally true instead.

## Adding a slice

New infrastructure with an unproven deploy pipeline is a horizontal slice, added on the same
terms as 05–07: two gates, an operating manual for what it owns, and a `CLAUDE.md` hunk if a
session needs to know it exists.

1. Write `slices/NN-name.md`.
2. Add it to `CATALOG` and `REQUIRES` in `scripts/install-plan.mjs`, and to `ORDER`.
3. Add its entry to `reference/slices.md` — including the accounts table, if it needs one.

**A slice may cite any slice before it, never one after it.** Whether a later slice gets
built at all is the user's call at dispatch time (`SKILL.md` §0), not a fact this reference
gets to assume — a stopping point earlier than yours is legitimate, not a gap. A convention a
later slice will need belongs in the earlier slice that owns it, stated as a standing rule
without naming who reads it next; the later slice cites backward to where it was set. If you
catch yourself writing "Slice N handles this" for an N your slice precedes, the sentence
belongs in slice N's own prose, or nowhere yet.

## Re-verifying the stack

**Every slice carries its own sources and its own findings**, in a `Sources and findings`
section at its end: the docs its §3 research rests on, then a dated entry per execution. There
is no shared bibliography, and there was: `99-sources.md` held all of it in one file until it
proved to be the worst of both worlds — most findings were duplicated into the slice that
needed them and could then rot in two places, while at least one lived _only_ there, in a file
no step told you to open. Splitting it per slice also fixed a second thing: a project that
built two slices no longer receives the research trail of seven it has not.

Each slice therefore records the versions it was actually built against where the pin it
justifies is. There is no plan-wide "verified on" date, because slices are rendered and built
one at a time and one date would be wrong for all but the first. The pins, the `compatibility_date`, and the workarounds they explain are a
snapshot checked together — the TypeScript 6.x hold exists because typescript-eslint
hard-errors on 7.x, `skipLibCheck` in `apps/graphql` exists because Workers types collide
with `lib.dom`, and so on. Bumping one pin means re-reading the comment that pins it. When
a workaround stops being needed, delete it and its comment in the same edit; a stale
workaround reads as a live constraint.
