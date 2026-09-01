#!/usr/bin/env node
// Install the setup plan into a target repo, for one project name and one slice selection.
//
//   node scripts/install-plan.mjs --repo <dir> --name <project> --slices 00,01,02
//   node scripts/install-plan.mjs --repo <dir> --name <project> --through 05
//   node scripts/install-plan.mjs --repo <dir> --list
//   node scripts/install-plan.mjs --repo <dir> --name <project> --through 05 --date 2026-08-30
//
// It writes <repo>/docs/setup/: the selected slice files, and nothing else, with __PROJECT__
// and __DOCS__ resolved. Slice 6 also gets assets/code-ui-SKILL.md, which it copies into
// .claude/skills/.
//
// One kind of file, one lifecycle. Every file here is seeded once and then owned by the
// project — edited before it is run, corrected after it is, and compared against the repo by
// docs:check forever after. There is deliberately no generated index and no copied source
// list: a file this script rewrites on every run is a file whose corrections vanish, which is
// the opposite of what a plan of record is for. `ls docs/setup/` is the index, and the
// numeric prefixes are the order.
//
// The slices are then executed by hand (or by the setup-project skill) in numeric order.
// Nothing here runs pnpm, touches git, or creates a package — installing the plan and
// building it are separate steps on purpose, so the plan can be read before it is run.
//
// Re-runnable. A slice file that already exists is overwritten only with --force, because a
// slice you have started building may carry local amendments — and docs:check compares the
// plan against the repo, so an overwrite that loses them is drift you would then have to
// rediscover.

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL = join(dirname(fileURLToPath(import.meta.url)), "..");
const SLICES = join(SKILL, "slices");

// id → [filename stem, short title, one-line summary]
const CATALOG = {
  "00": [
    "00-workspace-foundation",
    "Workspace foundation",
    "pnpm workspace, turbo, the quality harness, docs:check",
  ],
  "01": [
    "01-web-shell",
    "Web shell",
    "Next.js on Workers via OpenNext, deployed",
  ],
  "02": [
    "02-graphql",
    "GraphQL",
    "the Yoga Worker and its contract: typed resolvers, a typed client, deployed",
  ],
  "03": [
    "03-database",
    "Database",
    "Drizzle + Postgres: Docker locally, Neon via Hyperdrive",
  ],
  "04": [
    "04-theming-system",
    "Theming system",
    "tokens, Tailwind, shadcn, one themeable file",
  ],
  "05": ["05-email", "Email", "React Email templates through Resend"],
  "06": [
    "06-authentication",
    "Authentication",
    "Better Auth, magic-link sign-in, session cookie",
  ],
  "07": [
    "07-payments",
    "Payments",
    "Stripe embedded Checkout and a signed webhook",
  ],
  99: [
    "99-security-audit",
    "Security audit",
    "read the code for setup-era exposure; report, do not fix",
  ],
};

// Hard prerequisites: a slice's heredocs or diff hunks do not apply without these.
const REQUIRES = {
  "00": [],
  "01": ["00"],
  "02": ["01"],
  "03": ["02"],
  "04": ["03"],
  "05": ["04"],
  "06": ["05"],
  "07": ["06"],
  // 99 requires only a workspace, deliberately. It audits whatever has been built rather
  // than a fixed end state, so it is re-run after any slice — pinning it to 07 would make
  // the one slice you most want to repeat the one you can only run last. The number is 99
  // and not 08 for the same reason: 08 reads as "the rung after 07", which is the one thing
  // it is not.
  99: ["00"],
};

// Explicit, not Object.keys: an integer-like key would be hoisted to the front of a JS
// object's own-key order, which would put a later slice first — every id is quoted for it.
const ORDER = ["00", "01", "02", "03", "04", "05", "06", "07", "99"];

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i !== -1) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
};
const has = (name) => argv.includes(`--${name}`);

const die = (msg) => {
  console.error(`\n${msg}\n`);
  process.exit(1);
};

if (has("list") || argv.length === 0) {
  console.log(
    "\nSlices, in build order. Each one ends at a green local gate and a green",
  );
  console.log("production gate, and every slice needs the ones before it.\n");
  for (const id of ORDER) {
    const [, title, summary] = CATALOG[id];
    console.log(`  ${id}  ${title.padEnd(28)} ${summary}`);
  }
  console.log(
    "\n  00–04 is the scaffold. 05, 06 and 07 are optional infrastructure on top,",
  );
  console.log(
    "  in that order: auth mails its sign-in links through email, and payments",
  );
  console.log("  patches auth's config and tests.\n");
  process.exit(0);
}

const repo = flag("repo");
const name = flag("name");
if (!repo)
  die("--repo <dir> is required (the repo the plan is installed into).");
if (!name)
  die(
    "--name <project> is required (lowercase; becomes the npm scope and Worker prefix).",
  );
if (!/^[a-z][a-z0-9-]*$/.test(name))
  die(
    `Project name ${JSON.stringify(name)} will not work: it becomes an npm scope and a\n` +
      "Worker name, so it must be lowercase letters, digits and hyphens.",
  );
if (!existsSync(repo)) die(`--repo ${repo} does not exist.`);

let selected;
if (flag("through")) {
  const end = flag("through").padStart(2, "0");
  if (!CATALOG[end]) die(`--through ${end} is not a slice. Try --list.`);
  if (end === "99")
    die("--through 99 makes no sense: 99 audits what exists. Use --slices 99.");
  // 99 is excluded from any range. It is not a rung of the build chain — it is re-run
  // against whatever the chain has reached, so sweeping it in with `--through 07` would
  // install an audit of slices that are not built yet.
  selected = ORDER.slice(0, ORDER.indexOf(end) + 1).filter((id) => id !== "99");
} else if (flag("slices")) {
  selected = flag("slices")
    .split(",")
    .map((s) => s.trim().padStart(2, "0"))
    .filter(Boolean);
  for (const id of selected)
    if (!CATALOG[id]) die(`${id} is not a slice. Try --list.`);
} else {
  die(
    "Pass --slices 00,01,… or --through 07. 99 is the audit; name it explicitly.",
  );
}

// Close over hard prerequisites, and say which ones were added rather than adding them
// quietly: a slice pulled in by another is a slice with its own gates and its own accounts
// to open, which is a decision the caller is entitled to see.
const wanted = new Set(selected);
const added = new Set();
let grew = true;
while (grew) {
  grew = false;
  for (const id of [...wanted])
    for (const dep of REQUIRES[id])
      if (!wanted.has(dep)) {
        wanted.add(dep);
        added.add(dep);
        grew = true;
      }
}
// Everything already recorded in the plan directory counts as installed too, even when this
// run only asked for one slice. Nothing rendered depends on it any more, but the report,
// the stale-file check and "next: build …" all describe the plan as a whole — and a
// single-slice selection would otherwise report every slice already built as a stray.
// Resolved after DOC_REL is known, below.
let install = ORDER.filter((id) => wanted.has(id));

// ---------------------------------------------------------------- where it goes

// The plan lives in docs/setup/, undated. It used to be docs/<YYYY-MM-DD>-setup/, stamping
// the day the whole plan was installed — which only made sense while every slice was
// rendered at once. Slices are now rendered one at a time, as each is built, so a single
// directory date would be wrong for every slice but the first. Each slice file records the
// versions it was actually built against instead.
//
// A --date is still honoured, and an existing dated directory is still reused, so a repo
// laid down by the old installer keeps working.
const DATED = /^\d{4}-\d{2}-\d{2}-setup$/;

const explicitDate = flag("date");
if (explicitDate && !/^\d{4}-\d{2}-\d{2}$/.test(explicitDate))
  die(`--date ${explicitDate} is not a date. Use YYYY-MM-DD.`);

const existingPlans = existsSync(join(repo, "docs"))
  ? readdirSync(join(repo, "docs"), { withFileTypes: true })
      .filter(
        (e) => e.isDirectory() && (DATED.test(e.name) || e.name === "setup"),
      )
      .map((e) => e.name)
      .sort()
  : [];

if (existingPlans.length > 1 && !explicitDate)
  die(
    `${repo}/docs/ holds more than one plan directory:\n` +
      existingPlans.map((d) => `  · docs/${d}`).join("\n") +
      "\n\ndocs:check reads whichever one its DOC constant names, so two plans means one of\n" +
      "them is unchecked. Merge them, or name the one you meant with --date YYYY-MM-DD.",
  );

const today = () => {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};

const DOC_REL = explicitDate
  ? `docs/${explicitDate}-setup`
  : existingPlans.length === 1
    ? `docs/${existingPlans[0]}`
    : "docs/setup";

const reused = existingPlans.includes(DOC_REL.slice("docs/".length));

// Fold in the slices the plan directory already holds.
const planDir = join(repo, DOC_REL);
const already = existsSync(planDir)
  ? ORDER.filter((id) => existsSync(join(planDir, `${CATALOG[id][0]}.md`)))
  : [];
for (const id of already) wanted.add(id);
install = ORDER.filter((id) => wanted.has(id));

// ---------------------------------------------------------------- render

const outDir = join(repo, DOC_REL);
mkdirSync(outDir, { recursive: true });

// __DOCS__ is where this plan ended up. It is resolved rather than hardcoded because the
// path is load-bearing in two places that must agree: the DOC constant inside slice 00's
// docs-check.mjs heredoc, and the file docs:check then compares that heredoc against.
const resolve = (text) =>
  text.replaceAll("__PROJECT__", name).replaceAll("__DOCS__", DOC_REL);

const force = has("force");
const written = [];
const kept = [];

const put = (rel, text) => {
  const path = join(outDir, rel);
  if (existsSync(path) && !force) {
    kept.push(rel);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  written.push(rel);
};

for (const id of install) {
  const stem = CATALOG[id][0];
  put(`${stem}.md`, resolve(readFileSync(join(SLICES, `${stem}.md`), "utf8")));
}

if (wanted.has("06"))
  put(
    "assets/code-ui-SKILL.md",
    readFileSync(join(SKILL, "assets/code-ui-SKILL.md"), "utf8"),
  );

// ---------------------------------------------------------------- report

console.log(
  `\n${name} — plan installed at ${DOC_REL}/${reused ? " (existing plan directory)" : ""}\n`,
);
console.log(`Slices (${install.length}):`);
for (const id of install)
  console.log(
    `  ${added.has(id) ? "+" : "·"} ${id}  ${CATALOG[id][1]} — ${CATALOG[id][2]}`,
  );
if (added.size)
  console.log(`\n  + = added as a prerequisite of a slice you asked for.`);

if (written.length) console.log(`\nWrote ${written.length} files.`);
if (kept.length) {
  console.log(`\nLeft alone (already present — pass --force to overwrite):`);
  for (const k of kept) console.log(`  · ${k}`);
}
// Any .md here that is not a slice in this selection — the filter is deliberately every
// markdown file, not just numeric-prefixed ones, because docs:check reads the directory the
// same way. That catches a slice built earlier (still part of the plan, correctly) and also
// the README.md an older installer used to write, which no longer belongs.
const stale = readdirSync(outDir)
  .filter((f) => f.endsWith(".md"))
  .filter((f) => !install.some((id) => f === `${CATALOG[id][0]}.md`));
if (stale.length) {
  console.log(
    `\nAlready in ${DOC_REL}/ but not in this selection — docs:check reads every`,
  );
  console.log(
    `.md in that directory, so these still count as part of the plan:`,
  );
  for (const s of stale) console.log(`  · ${s}`);
}

// Name the slice this run actually added, not the first in the plan — on a repo that has
// already built 00, "next: build 00" is the one thing that is certainly not next.
const target =
  ORDER.filter((id) => wanted.has(id) && !already.includes(id))[0] ??
  install.at(-1);
console.log(
  `\nNext: build ${CATALOG[target][0]}.md — research, plan, execute, gates, reconcile.\n`,
);
