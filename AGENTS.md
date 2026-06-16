# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Documentation discipline (read before writing any code)

This app's whole job is **generating brand websites from templates**, so the architecture is the
product. When the architecture lives only in people's heads, brand sites drift from the catalogue,
features ship inconsistently across templates, and every fix is archaeology. We document as we
build — not after.

**The division lives in `docs/`.** Start at [`docs/README.md`](docs/README.md) — it maps every doc
and marks which are current vs. stale. The core system specs are the source of truth for *how
things are supposed to work*; the code is the source of truth for *how they currently work*. When
those disagree, that's a bug in one of them — surface it.

**The rule: every code change updates the docs it affects, in the same change.**
- Touch the schema → update [`docs/DATABASE_PLAN.md`](docs/architecture/DATABASE_PLAN.md) **and** sync
  `platform-api/db/schema.ts`.
- Touch an API route or its response shape → update [`docs/API.md`](docs/architecture/API.md) and, if a
  storefront reads it, [`docs/STOREFRONT_DATA_CONTRACT.md`](docs/storefront/STOREFRONT_DATA_CONTRACT.md).
- Touch how storefronts get/render data, the provisioning pipeline, or the sync →
  [`docs/STOREFRONT_ENGINE.md`](docs/storefront/STOREFRONT_ENGINE.md) +
  [`docs/STOREFRONT_DATA_CONTRACT.md`](docs/storefront/STOREFRONT_DATA_CONTRACT.md).
- Build a storefront-facing feature → it must be wired at the **template level**
  (`nanocrew-templates`) so every generated brand site gets it, and its spec in `docs/` must say so.
- Add/finish a feature → move it in [`docs/REMAINING_FEATURES.md`](docs/roadmap/REMAINING_FEATURES.md) and
  update its spec.

**If you change behavior and the doc still describes the old behavior, you are not done.** A PR
that ships code without the matching doc update is incomplete. When you notice a doc is already
stale, fix it as part of your change rather than leaving the trap for the next person.
