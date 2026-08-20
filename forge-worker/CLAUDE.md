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
- 🟡 **`worker.mjs` is the ONLY copy of the forge bash pipelines.** `../src/lib/provision.ts` authors
  `brand.json` + the briefs and **enqueues**; `../src/lib/revise.ts` only approves/declines via the
  GitHub API. Keep the worker's prompt/edit-surface text in step with the briefs `provision.ts`
  writes. Editing it and pushing the repo does **NOT** ship it — you must **re-scp it to the
  droplet** (see `README.md` for the line). Drift breaks builds silently. (See [`../docs/context/NEVER_VIOLATE.md`](../docs/context/NEVER_VIOLATE.md) §3.)
- After editing `forge-CLAUDE.md`, re-scp **it** too (same deal — it lives on the droplet).
- 🔴 **A revision that changed NOTHING is a failure, not a ready preview (2026-08-19).** The scripts
  emit `CLAUDE_OK`/`CLAUDE_FAILED` and, after staging, `NO_EDITS` when the brief is the only changed
  file; the worker fails the revision on either and notifies the creator. Before this, `claude -p …
  || true` swallowed everything — including a revoked `CLAUDE_CODE_OAUTH_TOKEN` — so revisions
  deployed previews identical to live and reported ready, and provisioning shipped unbranded
  templates. Check `/tmp/<repo>-revise.log` and `/tmp/<repo>-claude.log` on the box first.
- 🔴 **No backticks anywhere in the generated shell.** Both scripts are JS template literals, so a
  backtick — even inside a `#` comment — closes the template and silently truncates the emitted
  script. `node --check` still passes. Verify by rendering the script with stub inputs and asserting
  every marker (`CLAUDE_OK`, `NO_EDITS`, `REVISE_DONE`, …) survives into the output.
- Auth lives in `~/.claude-env` on the droplet (`CLAUDE_CODE_OAUTH_TOKEN`, sourced by both scripts).
  It expires/gets revoked — re-mint with `claude setup-token`. Beware: macOS masked-input dialogs
  clip long pastes; a truncated token reports as `invalid`, a dead one as `revoked`.
- Stack: Node ESM · `postgres` only. `npm start` runs the drain loop.
