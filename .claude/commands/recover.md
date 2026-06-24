---
description: Rebuild working context after a long or compacted session — reload the read-order and restate state.
---

Context may be thin (a compacted or long session). Rebuild it before continuing — don't guess.

1. **Reload the read-order** ([`docs/context/README.md`](../../docs/context/README.md)):
   [`AGENTS.md`](../../AGENTS.md) → [`NEVER_VIOLATE.md`](../../docs/context/NEVER_VIOLATE.md) →
   [`CODE_STANDARDS.md`](../../docs/context/CODE_STANDARDS.md) →
   [`TECH_STACK.md`](../../docs/architecture/TECH_STACK.md). Skim, don't dump.
2. **Read the current state:** `git status` + `git log --oneline -10` + the current branch, and the
   progress-tracker [`REMAINING_FEATURES.md`](../../docs/roadmap/REMAINING_FEATURES.md).
3. **Locate the task:** what was in flight? Open the relevant division doc per the map in
   [`CLAUDE.md`](../../CLAUDE.md).
4. **Restate, briefly:** (a) what we're doing, (b) the never-violate rules in play for it, (c) the
   next concrete step, (d) anything uncommitted that's mid-flight.

Keep the summary tight — a working brief, not a transcript. Then ask whether to continue or re-scope.
