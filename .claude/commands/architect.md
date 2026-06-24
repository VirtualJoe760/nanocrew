---
description: Plan a feature against the context docs BEFORE coding — reuse-first, rules-aware, sequenced.
argument-hint: <what you want to build>
---

You are planning a change in the Nano Crew repo. **Do not write code yet** — produce a plan.

Feature to plan: **$ARGUMENTS**

Work through this, then deliver the plan:

1. **Load the rules.** Read [`docs/context/NEVER_VIOLATE.md`](../../docs/context/NEVER_VIOLATE.md) and
   [`docs/context/CODE_STANDARDS.md`](../../docs/context/CODE_STANDARDS.md). Note which never-violate
   rules this change touches (schema sync? RLS? tenancy? cascade? palette ×3? thin-client?).
2. **Reuse before you build.** Search the code **and** the relevant `docs/` division — does this (or
   most of it) already exist? Check [`docs/context/UI_REGISTRY.md`](../../docs/context/UI_REGISTRY.md)
   for an existing primitive before proposing any new component. Call out what you'll reuse.
3. **Open the entry doc** for the area (storefront / studio / accounts / app / architecture) per the
   map in [`CLAUDE.md`](../../CLAUDE.md).
4. **Check scope.** Is this in-flight, deferred, or parked
   ([`PROJECT_OVERVIEW.md`](../../docs/context/PROJECT_OVERVIEW.md))? If parked/deferred, flag it and
   ask before planning further.

**Deliver:** a sequenced plan with — files to create/edit (exact paths), what's reused vs new, the
never-violate rules in play, the **docs that must be updated in the same change**, and any open
question for the human. For a large or ambiguous change, use your harness's planning / subagent mode
(if available) for the architecture pass. End by asking for go before implementing.
