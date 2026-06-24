---
description: Regenerate CONTEXT_GUIDE.md — the plain-English onboarding guide for developers working with the AI agent.
---

Generate (or refresh) **[`docs/context/CONTEXT_GUIDE.md`](../../docs/context/CONTEXT_GUIDE.md)** — the
human onboarding guide so a new developer understands this system and how to work with the AI agent.
Generate it from the **current** state of the system, so it never drifts from reality.

Read first, so the guide reflects what's actually there:
- [`CLAUDE.md`](../../CLAUDE.md) (read-order + map), [`AGENTS.md`](../../AGENTS.md) (the core).
- The context docs: [`README.md`](../../docs/context/README.md), `NEVER_VIOLATE`, `CODE_STANDARDS`,
  `PROJECT_OVERVIEW`, `UI_TOKENS`/`UI_RULES`/`UI_REGISTRY`.
- The other skills in this folder (`architect`, `recover`, `imprint`) — so the "when to use each"
  section matches what they actually do.
- The "working loop" in `docs/context/CODE_STANDARDS.md` — memory + review + commit-often are
  **automatic behaviors, not commands**; the guide must present them that way, not as skills to run.

Write `CONTEXT_GUIDE.md` covering, in plain English (for a human, not the agent):
1. **What this system is & why** — the docs-are-the-product / reuse-the-primitives philosophy, briefly.
2. **The map & read-order** — where everything lives, and where to put new knowledge.
3. **Memory & review are automatic** — the agent keeps docs current in the same change, self-checks
   (`tsc` + lint + sync) before each commit, and commits often without a review gate. These are NOT commands.
4. **The skills (occasional, optional)** — `/architect` before a big feature, `/recover` after a long
   session, `/imprint` to refresh agent docs, `/instructions` to regenerate this guide.
5. **The golden rules in plain language** — the never-violate set, framed as "things that silently
   break commerce/builds if ignored."
6. **How to collaborate well** — let it audit/reuse first; point it at the task; let it commit often;
   it still confirms outward-facing actions.
7. **A 5-minute quickstart** — clone → read-order → (optionally /architect) → build → it self-checks + commits.

Keep it warm and concise (a guide, not a spec). After writing, report what changed and confirm every
link resolves. Re-run this whenever the context system changes.
