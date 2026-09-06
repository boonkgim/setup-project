# Slice 0 — what you need to do yourself

Nothing here is an account. Two runtimes have to exist before the workspace can be
installed, and both are one command.

Unblocks: **everything**. The slice cannot start without them.

## 1. Node 24 or newer

```bash
node -v          # want v24.x or higher
```

If it is older or missing:

```bash
fnm install 24 && fnm use 24     # or: nvm install 24 && nvm use 24
```

No version manager? [nodejs.org](https://nodejs.org) — take the LTS installer.

## 2. pnpm, via corepack

```bash
pnpm -v          # want 11.x
```

If it is missing, there is nothing to download — corepack ships inside Node:

```bash
corepack enable pnpm
```

Install pnpm any other way and the root `packageManager` pin stops meaning anything, because
two pnpms are then on `PATH` and the one that runs is whichever comes first.
