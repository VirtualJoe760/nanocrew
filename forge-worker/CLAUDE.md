# forge-worker — local rules

Thin per-unit file. **Read the root [`../CLAUDE.md`](../CLAUDE.md) + [`../docs/context/`](../docs/context/README.md) first.**

**What this is:** the persistent worker on the forge droplet that drains the `store_revisions` queue
one job at a time (`worker.mjs`, Node ESM, systemd `nanocrew-forge-worker`).

## Two CLAUDE files live here — don't confuse them
- **This file** = rules for the **dev agent** editing the worker.
- **`forge-CLAUDE.md`** = the standing brief that conditions the storefront-building **robot** (it
  deploys to `/home/forge/.claude/CLAUDE.md` on the droplet). **Leave it as the robot's file** — it's
  about building brand sites, not about working in this repo.

## Local rules
- 🟡 **`worker.mjs` is a hand-kept mirror of `../src/lib/revise.ts` + `provision.ts`.** Editing it and
  pushing the repo does **NOT** ship it — you must **re-scp it to the droplet** (see `README.md` for
  the line). Drift breaks builds silently. (See [`../docs/context/NEVER_VIOLATE.md`](../docs/context/NEVER_VIOLATE.md) §3.)
- After editing `forge-CLAUDE.md`, re-scp **it** too (same deal — it lives on the droplet).
- Stack: Node ESM · `postgres` only. `npm start` runs the drain loop.
