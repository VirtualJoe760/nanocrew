# Never-Violate Rules

The hard rules of this repo. Breaking one **silently breaks commerce, builds, or tenant isolation** —
the failure usually shows up later, somewhere else. Read this before any change.

This is the **canonical home** for these rules; other docs (ARCHITECTURE, TECH_STACK, the unit
CLAUDE.md files) link here instead of restating them. The mechanical ones run **automatically before
each commit** (the auto-review in [`CODE_STANDARDS.md`](CODE_STANDARDS.md) "working loop") — marked
**🔴 blocks** below. The judgment ones are **🟡 checklist** items held by hand but not fully provable.

Sourced verbatim from the codebase's existing warnings (root `CLAUDE.md`, `TECH_STACK.md`,
`docs/README.md`, the RLS lockdown, and `forge-worker/forge-CLAUDE.md`).

---

## 1. Data & tenancy integrity

- **🔴 The schema is duplicated — sync both halves every migration.**
  `platform-api/db/schema.ts` is a hand-kept **copy** of `src/db/schema.ts`. A migration that
  changes one without the other drifts the public storefront API off the app's truth. Update both +
  [`DATABASE_PLAN.md`](../architecture/DATABASE_PLAN.md) in the same change.
- **🔴 Every new migration must `ENABLE ROW LEVEL SECURITY`.** RLS is deny-all on every public table
  (the fix for a critical anon-key hole). A new table without it re-opens that hole. Servers reach
  data via the service key; clients never read tables directly.
- **🟡 All per-creator data access goes through `src/lib/tenant.ts`.** Resolve-by-id, then enforce
  `creatorId === userId` **or** `store_collaborators`. Validating a *container* but trusting a
  client-supplied child id is the IDOR bug class (fixed in compositions/mockup/publish — don't
  reintroduce it).
- **🟡 Thin-client storefronts carry NO secrets and NO commerce backend.** Checkout proxies to
  platform-api's central POS. POD providers live ONLY in `src/lib/pod-policy.ts` (`POD_PROVIDERS`).
  Adding a provider or our own API is a **platform-api change, zero template edits**.
- **🟡 Authed routes: no `fetch()` before the first DB query.** The Cloud Run/postgres-js constraint —
  an outbound fetch before the first query kills the connection on the persistent Node host.
  (Auto-review scans changed `*+api.ts` for this, but can't fully prove ordering — a heuristic, not a hard block.)

## 2. Brand / site cascade integrity

- **🟡 Brand identity edits go through `src/lib/brand-identity.ts` `buildBrandPatch()` only.** It is
  the single source that syncs `stores` columns + `brand_profile` + `site_config.copy` + baked
  `brand.json`. Hand-editing one surface caused the "Alpha Master" SEO-drift bug.
- **🟡 Copy is data — never hardcode prose.** Site text lives in `site_config` (app) /
  `content/copy.json` (templates), read via the live-config layer. A hardcoded headline/subline/CTA
  *shadows* the data in the `o.x || prop || copy.x` fallback chain, so a later edit silently never
  renders (the build-quality bug we killed).
- **🟡 Respect live-read vs rebuild.** `site-config` (copy/colors/fonts/SEO) + `site-assets`
  (logo/hero/og) apply with **no rebuild** (`live ?? baked`). Anything baked into `brand.json`
  (header/SEO) needs a `brand.json` push + `revalidateStorefront`.

## 3. Build & deploy mechanics

- **🔴 Pre-push gate ("Joe's rule"): `tsc` + `npx expo export` + `expo lint` must pass.** Don't
  commit/push on a red typecheck, a failed export, or new lint errors.
- **🔴 The brand palette lives in THREE files — change them together.**
  `src/constants/theme.ts` (`Colors`), `src/lib/studio-palette.ts` (`makeStudioPalette`),
  `src/components/nc-screen.tsx` (`makePalette`). Editing one drifts the app chrome.
- **🟡 `forge-worker/worker.mjs` is a hand-kept mirror — re-scp it after edits.** It mirrors
  `revise.ts`/`provision.ts`; pushing the repo does NOT ship it to the droplet, and drift breaks
  builds silently.
- **🟡 Don't remove the Metro/Babel overrides.** `metro.config.js` forces `@google/genai` → its web
  build (the node build's `require('ws')` hangs the Gemini Live session in RN). `babel.config.js`
  adds `@babel/plugin-transform-class-static-block` (three.js won't parse on native without it).
- **🟡 Dev build only.** Expo Go is retired (build #12) — native modules (notifications, apple-auth,
  IAP, view-shot, audio-api) require an EAS dev/standalone build.

## 4. Screen safety (device chrome)

- **🟡 Nothing lives under the Dynamic Island, notch, or home indicator.** Every top-anchored element
  offsets from `useSafeAreaInsets().top` and every bottom-anchored one from `.bottom` — never a raw
  `top: 0` / `top: 14` / `paddingTop: 12` on a full-screen surface. On an Island device the top inset
  is ~59pt; content placed above that is physically covered by hardware, not merely tight. This
  applies to mocks and design comps too: if a comp shows chrome at the very top of the frame, the comp
  is wrong before the code is. Full rule + the values: [`UI_RULES.md`](UI_RULES.md) "Safe areas".

## 5. Account-surface parity

**The account page exists twice — the app (`src/app/account.tsx`) and the website
(`nanocrew-site/app/account/`). Never change one without the other.**

One creator identity, two front doors. A capability added to the app and not the web (or the
reverse) is a defect, not a backlog item: the creator who opens a laptop finds a different product.
Touching either side means touching the app, the website **and** the API in the same commit, then
updating the parity matrix in [`../accounts/ACCOUNT_SURFACE.md`](../accounts/ACCOUNT_SURFACE.md).

Intentional one-sided capabilities are allowed but must be **recorded there with the reason**
(today: email is never editable anywhere; account deletion stays in the app). An undocumented gap is
drift.

## 6. Process discipline

- **🟡 Reuse before you build. Audit first.** Most things already exist (one Supabase identity,
  orders-by-email, the design generator, go-live phases, the UI primitives). Search the code **and**
  the relevant `docs/` division before adding a table, model, endpoint, "system," or component. This
  is Joe's strongest, most-repeated correction — *stop rebuilding what exists.*
- **🟡 Every code change updates the docs it affects, in the same change.** Touch the schema →
  DATABASE_PLAN; an API shape → API.md (+ STOREFRONT_DATA_CONTRACT if public); a reusable component →
  [`UI_REGISTRY.md`](UI_REGISTRY.md). A PR that ships code with stale docs is incomplete.
- **🟡 Commit often + push at each logical milestone.** End every commit message with the
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

> **Editing this list?** It's verbatim-sourced — when a rule changes in the code's reality, update it
> here first, then run [`/imprint`](../../.claude/commands/imprint.md) so the rest of the context
> layer stays consistent.
