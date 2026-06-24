---
description: Refresh the context docs from the current code — catch and fix drift before it misleads.
argument-hint: (optional) a doc or area to focus the audit on
---

Keep the **agent context docs honest against the code.** Docs are the source of truth for how things
*should* work; code for how they *currently* work — when they disagree, that's a bug. Audit and fix.

Sweep for drift (focus: **$ARGUMENTS** if given, else the whole context layer):

1. **Versions:** `package.json` (×4) vs. [`TECH_STACK.md`](../../docs/architecture/TECH_STACK.md) and
   the Expo-SDK reference in [`AGENTS.md`](../../AGENTS.md) (must match the pinned SDK, not a newer one).
2. **AI model IDs:** the models named in `TECH_STACK.md` vs. what `src/lib/**` actually calls.
3. **Code references:** functions/files/flags named in [`NEVER_VIOLATE.md`](../../docs/context/NEVER_VIOLATE.md),
   [`CODE_STANDARDS.md`](../../docs/context/CODE_STANDARDS.md), and the UI docs still exist (e.g. the
   3 palette files, `buildBrandPatch`, `tenant.ts`, the primitives in
   [`UI_REGISTRY.md`](../../docs/context/UI_REGISTRY.md)).
4. **New since the docs:** new migrations (RLS?), new `*+api.ts` routes (in `API.md`?), new reusable
   components (in the registry?).
5. **Links:** every cross-link in the context docs + `docs/README.md` resolves.
6. **Stale status:** no changelog/“shipped this session” prose creeping back into always-loaded files.

For each drift: **fix it** if it's a clear doc correction; **report it** if it's a code/spec conflict
needing a human call. End with a short diff summary of what you changed and what needs a decision.
After fixing, if the human-facing guide is now out of date, suggest running `/instructions`.
