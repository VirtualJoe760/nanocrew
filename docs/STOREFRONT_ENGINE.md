# Nanocrew Storefront Engine

The system that turns a Studio interview into a live brand website — fast, cheap, and
without writing new code per store. Decided 2026-06-12 with Joe; this document is the
source of truth.

## The core idea

**Templates + brand tokens, never generation from scratch.** We build a small set of
proven clothing-store templates in advance, structured around exactly the data Venus
collects in the interview. Setting up a brand site = pick a template, apply tokens, deploy.
Claude's per-store work is configuration and copywriting — not architecture — which keeps
token costs flat and quality guaranteed.

After setup, **there is no need for new code**. Products, content, and blog posts all flow
through pre-wired rails.

## Architecture at a glance

```
Studio interview (Venus)
  └─ brand profile + design system + transcript  →  stores row (Supabase)
       └─ store created  →  provisioning pipeline (src/lib/provision.ts)
            1. create empty private repo  store-<slug>  (GitHub API)
            2. ssh nanocrew-forge (DO droplet 64.23.147.121)
                 - clone nanocrew-templates monorepo (sparse)
                 - copy templates/<designStyle>/ → the new repo
                 - write brand.json + briefs/01-BRAND.md + briefs/02-TEST.md
                 - headless `claude` applies the brand per the briefs
                 - push
            3. create Vercel project linked to the repo (Vercel API)
                 → live at <slug>.vercel.app   (custom domains later)
            4. stores.deployment_url ← live URL
       └─ refinement loop: creator talks to Venus → constrained Claude edits on the forge
```

## The template monorepo — `nanocrew-templates`

One repo, four self-contained Next.js templates mapped 1:1 to the design-temperament
question Venus already asks:

| Template | designStyle | Character |
|---|---|---|
| `templates/minimal` | minimalist | whitespace, type-led, quiet product grid |
| `templates/bold` | bold | full-bleed imagery, heavy display type, loud CTAs |
| `templates/elegant` | elegant | serif-led, editorial layouts, generous spacing |
| `templates/extravagant` | extravagant | motion, texture, maximal hero, statement layouts |

**stephenlawyer.clothing is the model** — same proven page inventory per template:
home (hero + featured drops), shop (+ category), product detail, cart, checkout
(via platform API), about, blog index + post, contact/FAQ/sizing/shipping/terms/privacy.

Each template is **self-contained** (duplication over coupling — stability is the product).
Templates use placeholder images until a brand lands.

### The token contract — `brand.json`

The single file that makes a template become a brand. Written by the pipeline, refined by
Claude. The template consumes it everywhere; this IS the API between interview and website:

```jsonc
{
  "storeId": "uuid",            // ← links the site to the Nanocrew platform API
  "slug": "alpha-master",
  "name": "Alpha Master",
  "tagline": "…",
  "logoUrl": "https://res.cloudinary.com/…",
  "palette": { "primary": "#…", "secondary": "#…", "accent": "#…", "background": "#…", "text": "#…" },
  "typography": { "display": "…", "body": "…" },
  "designStyle": "bold",
  "voice": "…",                 // brand voice — guides all copy
  "story": "…",
  "vibeKeywords": ["…"],
  "products": ["…"],
  "social": {},                  // filled during refinement
  "apiBase": "https://api.nanocrew.app"   // platform API root
}
```

Copy lives in `content/` as MDX (hero, about, blog posts) — written by Claude in the
brand's voice, editable in refinement.

### What Claude may and may not touch

Allowed edit surface (enforced by the briefs and reviewed by the test brief):
- `brand.json`, `content/**` (copy + blog), `public/**` (brand assets), theme tokens
  (tailwind config colors/fonts)
- **Composing existing components**: adding a CTA band, an extra hero variant, an about
  section — only from the template's component library, only on-brand

Discouraged/forbidden:
- structural changes, new dependencies, new routes, touching commerce/checkout code,
  rewriting components. These templates are proven; stability is the feature.

## The brief protocol (what the forge's Claude receives)

Markdown files in `briefs/`, written by the pipeline from the interview:

1. **`01-BRAND.md`** — identity + instructions: which template was chosen and why, the
   exact palette (hard constraint — creator's words win), typography, voice, story,
   products, logo URL, and the creator's own transcript excerpts to mine for copy.
   Directives: apply tokens, write all copy in the brand voice, populate placeholders.
2. **`02-TEST.md`** — acceptance: `npm run build` must pass; typecheck clean; every route
   renders; only allowed paths changed (`git diff --stat` review); palette audit (no
   colors outside brand.json); no new dependencies. Claude runs these before committing.

Refinement sessions append numbered briefs (`03-REVISION-….md`) generated from what the
creator tells Venus — same constraints, plus "small edits only" framing.

## Commerce: sell through the platform

Brand sites are **headless storefronts on the Nanocrew API**. Money and fulfillment run
through us (application fee per order — schema already supports `application_fee_cents`);
Stripe Connect per-creator comes later.

Public API the templates consume (to build in the nanocrew app):
- `GET /api/public/stores/<slug>` — brand profile (for SSR metadata)
- `GET /api/public/stores/<slug>/products` (+ `/products/<productSlug>`) — published
  products w/ variants, prices, images (from Printful publish pipeline)
- `POST /api/public/checkout` — line items → Stripe Checkout session (platform account,
  application fee), webhook → order row → Printful submission (pipeline already exists
  for the house store; generalize per store)

## Blog & media

- Creator asks Venus for a blog post → revision brief → Claude writes `content/blog/*.mdx`
  in the brand voice → push → Vercel deploys.
- **Images/short video**: uploaded in the Studio → Cloudinary (existing plumbing) → URLs
  referenced in the MDX.
- **Long video**: creator pastes a YouTube link; templates ship a YouTube embed component.
  (No YouTube upload OAuth — deliberately out of scope.)

## Deployment

- Each brand repo → a **Vercel project** created via API (`VERCEL_TOKEN` required),
  linked to the GitHub repo, auto-deploys on push. Live at `<slug>.vercel.app`.
- Custom domains + `*.nanocrew.app` wildcard: later, with the portal/billing phase.

## Cost & billing model

- Initial generation: one bounded Claude session on the forge (template + tokens keeps it
  small). Interview costs ≈ $0.15–0.20 (TTS-dominated).
- Refinement: per-token billed Claude sessions — the metered product. Small-edit
  constraints keep sessions short and margins healthy.

## Game plan

**Phase T — templates (the prerequisite for everything)**
1. Create `nanocrew-templates` monorepo; port stephen-lawyer into `templates/minimal`
   as the reference implementation: tokenized (brand.json), placeholder images, platform
   API client instead of direct DB, content/ MDX layer, blog + YouTube embed.
2. Derive `bold`, `elegant`, `extravagant` from it (restyle, not rearchitect).
3. Each template: build passes + a `TEMPLATE.md` documenting its components (Claude's
   composition menu during refinement).

**Phase A — platform API**
4. Public store/product/checkout endpoints in nanocrew (read model exists; generalize
   checkout per store with application fee).

**Phase F — forge integration v2**
5. provision.ts v2: template choice from designStyle, sparse-clone + copy on the forge,
   briefs 01/02 generation, push, Vercel project creation, deployment_url + status.
6. Auth on the forge: ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN (pending from Joe),
   plus GITHUB_TOKEN and VERCEL_TOKEN in .env.local (pending from Joe).
7. Provision Alpha Master end-to-end as the pilot.

**Phase R — refinement loop**
8. Venus post-launch mode: revision requests → numbered briefs → constrained forge
   sessions; blog creation flow; Studio media upload → Cloudinary.
9. Token metering per revision session (billing hooks come with the portal).
```

## Dashboards (added 2026-06-12)

**Creator dashboard — `/admin` on every brand site.** Same Supabase login as the app
(magic-link via REST for Google-auth creators, password as alternative; a single
`https://*.vercel.app/**` entry in the Supabase redirect allow-list covers all sites).
The dashboard is thin: it calls platform `/api/creator/*` endpoints with the creator's
token; the API verifies store ownership. V1 surface: revenue + order count + 30-day
traffic (overview cards), order list with status. Traffic comes from a public beacon —
brand sites POST `/api/public/beacon` per pageview into a `page_views` daily counter.

**Platform admin — inside the Nanocrew app.** Role-gated (platform admin emails) section
on the Account tab backed by `/api/admin/platform`: all stores w/ status, platform-wide
orders/revenue, and adjustment actions (suspend store, re-provision) as they're needed.
