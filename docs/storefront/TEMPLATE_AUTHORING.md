# Creating a new storefront template — the runbook

> **If a future session says "let's create a template," start here.** This is the authoritative
> recipe. Following it keeps the infrastructure intact: templates stay **thin clients**, the commerce
> backend stays **central**, and a new template **plugs into** provisioning + the branding picker.
> We expect to author *many* templates (eventually hundreds), so the rules below are what make that
> safe at scale. Target end-state: [COMPONENT_SYSTEM.md](COMPONENT_SYSTEM.md) (`_shared` + a `base`
> seed). Until that lands, copy `templates/minimal` as the seed.

## The one invariant (never break this)
**Templates are THIN CLIENTS. They contain NO commerce backend and NO secrets.**
- Checkout → `POST ${brand.apiBase}/api/public/checkout` (the central **platform-api**). Never put
  Stripe/Printful keys, SDKs, or server commerce routes in a template.
- All money + fulfillment + POD providers live in **platform-api** (`/api/public/checkout`,
  `*-webhook`, `lib/fulfill.ts`, the `POD_PROVIDERS` registry in `lib/pod-policy.ts`). **Adding a POD
  provider or our own API is a platform-api change — zero template edits, for 5 templates or 50,000
  sites.** That's the whole point of the thin-client model: we never push commerce updates to the fleet.
- `brand.json` carries **public config only**: `apiBase`, `platform.{supabaseUrl,supabaseAnonKey}`,
  `commerce` fees, palette/typography/name/tagline/story/logoUrl. Secrets never leave platform-api.
- Public config is rotatable fleet-wide with **no rebuild** via `scripts/resync-brand-config.mjs`.

## What every template must ship (the contract)
Read [STOREFRONT_DATA_CONTRACT.md](STOREFRONT_DATA_CONTRACT.md) — these are non-negotiable so the
brand's data flows in:
1. **`brand.json`** — the token contract (above). The forge writes it per brand; your template reads it.
2. **Live-read data layer** (`lib/api.ts`, `lib/site-config.ts`, `lib/seo.ts`):
   - products / collections / posts / hero / **logo** (`getSiteLogo`) read the public platform-api so
     creator edits apply with no rebuild.
   - **SEO is live**: root `layout.tsx` uses `generateMetadata()` + `getSiteCopy()` for
     title/description/OG/Twitter; `organizationLd()` takes live `{description, slogan, logo}`. (Do NOT
     bake `brand.story`/tagline into a static `metadata` export — that's the stale-SEO bug.)
   - **Per-brand favicon**: derive the monogram from `brand.name` (never hardcode initials — the
     street "SL"/Stephen-Lawyer leak). Honor a creator-assigned OG image (`site_assets.og`).
3. **Pages/blocks**: home, `/shop`, `/about`, `/contact`, `/blog` (+ `/blog/[slug]`),
   `/product/[slug]`, `/policies/[policy]`, `/admin`, `opengraph-image`, `sitemap.ts`, `robots`.
   Static subpages must be **self-canonical**.
4. **`TEMPLATE.md`** (the block dictionary + hard rules the forge obeys) and **`VOCABULARY.md`**
   (creator-phrase → block map). The forge brands the site from these — no `TEMPLATE.md` = the forge
   guesses = drift.

## Steps to create one
1. **Seed**: `cp -R templates/minimal templates/<new>` (until `_shared`+`base` exist, minimal is the
   reference thin client). Restyle freely — components, Tailwind, layout are the template's job.
2. **Keep the contract** above intact (data layer, live SEO, favicon, pages, TEMPLATE.md/VOCABULARY.md).
3. **Register it** so the system can pick it (single source of truth = `src/lib/provision.ts`):
   - **New design style?** add the style to the `designStyle` union in `src/lib/interview.ts`, the
     Eve tool schema in `src/lib/live-voice.ts`, the `TEMPLATE_BY_STYLE` map in
     `src/lib/provision.ts`, **and** the branding picker in `src/components/brand-review.tsx` (add a
     wireframe + tag so it shows live during branding — that's how templates surface to the creator).
   - **Alternate for an existing style?** map it in `TEMPLATE_BY_STYLE` (a future multi-template-per-
     style selector will choose among them).
4. **Build-gate**: `pnpm run build` in the template MUST pass — the forge gates go-live on it; a
   failing build blocks the brand. (Don't commit `.next/` — it should be gitignored.)
5. **Commit** to `nanocrew-templates`. Future provisions of that style use it; **existing sites are
   unaffected** (each is a `cp -R` clone at provision time — see how the forge ships it below).

## How a template reaches a live site (so you know what propagates)
The forge worker provisions by `cp -R templates/<template>/.` into a fresh per-brand repo
([forge-worker/worker.mjs:145-148](../../forge-worker/worker.mjs)), writes `brand.json` + briefs, lets
Claude brand it, build-gates, and pushes → Vercel deploys. Consequences:
- A new/edited template only reaches **brands provisioned after** the change (or via an explicit
  rebuild/backfill of a brand's repo).
- To change something for **every existing site** at once: public config → `resync-brand-config.mjs`
  (live); template *code* → the `_shared` vendoring + a fleet re-vendor/rebuild (see
  [COMPONENT_SYSTEM.md](COMPONENT_SYSTEM.md)). This is the infra that keeps "push to thousands" tractable.

## Why this scales to hundreds of templates
- Commerce/secrets are central (platform-api) → new providers/APIs never touch templates.
- The data-layer + commerce client wiring will live once in `templates/_shared` (vendored by the
  forge), so a contract change is one edit, not N — see [COMPONENT_SYSTEM.md](COMPONENT_SYSTEM.md).
- A template is therefore just **theme + blocks** on top of a fixed contract; authoring one is styling
  + registration, never re-wiring the backend.
