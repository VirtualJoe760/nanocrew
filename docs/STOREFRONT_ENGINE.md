# Nanocrew Storefront Engine

The system that turns a Studio interview into a live brand website — fast, cheap, and
without writing new code per store. This document is the source of truth for **how a site
gets built and revised**. For **how a built site reads its catalogue** (product/checkout
API shapes, ISR sync, custom-site cutover), see the companion doc:

> **➜ [docs/STOREFRONT_DATA_CONTRACT.md](./STOREFRONT_DATA_CONTRACT.md)** — the nested-variant
> product shape templates fetch from platform-api, the ISR + `revalidateStorefront()` sync
> rule, and the custom-site cutover (`stephenlawyer.clothing`). Don't duplicate it here; this
> doc stops at "the site is deployed", that doc owns "the site stays in sync".

## The core idea

**Templates + brand tokens, never generation from scratch.** We build a small set of
proven clothing-store templates in advance, structured around exactly the data Venus
collects in the interview. Setting up a brand site = pick a template, apply tokens, deploy.
Claude's per-store work is configuration and copywriting — not architecture — which keeps
token costs flat and quality guaranteed.

After setup, **there is no need for new code**. Products and the catalogue flow through the
platform API (the data contract); copy and blog posts flow through pre-wired content rails.

## Architecture at a glance — the queue-based pipeline

> **KEY CORRECTION (2026-06-15):** provisioning no longer SSHes the forge from the app.
> SSH-from-server broke on the managed/serverless host (the Railway backend can't hold a
> 30-min SSH session, and the box's outbound SSH is unreliable). The app now only **enqueues
> a job row**; a persistent **worker on the droplet drains the queue** and runs the heavy
> pipeline locally. The `nanocrew-forge` SSH host still exists, but provisioning does not use it.

```
Studio interview (Venus)
  └─ brand profile + design system + transcript  →  stores row (Supabase, status='building')
       └─ provisionStorefront()  (src/lib/provision.ts — runs on the APP SERVER / Railway)
            1. create the per-brand GitHub repo  store-<slug>  (GitHub API, 422 = resumable)
            2. build brand.json + briefs/01-BRAND.md + briefs/02-TEST.md from the interview
            3. ENQUEUE a job: insert into store_revisions
                 branch = '__provision__'   status = 'building'
                 request_md = JSON { kind, slug, template, brandName, brandJson, brandBrief, testBrief }
            (NO SSH — the app server's job ends here)
                              │
                              ▼  (shared queue: store_revisions table)
       forge-worker  (forge-worker/worker.mjs — systemd `nanocrew-forge-worker` on the DO droplet)
            polls store_revisions every 5s, ONE job at a time, under a global ~/stores/.forge.lock
            for a '__provision__' job  →  buildProvisionScript():
              - sparse-clone nanocrew-templates, copy templates/<template>/  →  store-<slug>/
              - write brand.json + briefs/01-BRAND.md + briefs/02-TEST.md (from the payload)
              - git init -b main; pnpm install
              - headless `claude -p … --dangerously-skip-permissions` applies the brand per briefs
              - gate: `pnpm run build`  (logs BUILD_OK / BUILD_FAILED)
              - commit + push main; deployToVercel() creates the Vercel project + first deploy
              - flip stores row → status='ready', deployment_url ← https://store-<slug>.vercel.app
                (and store_revisions row → 'ready' with preview_url)
```

If the app server fails before it can enqueue, it un-sticks the store (`status` back to
`'ready'`, `deployment_url=null`) so a brand is never stranded in `'building'`.

## The two processes (who runs what)

| Concern | `src/lib/provision.ts` (app server, Railway) | `forge-worker/worker.mjs` (droplet, systemd) |
|---|---|---|
| Trigger | called fire-and-forget from the store-create route | polls `store_revisions` every 5s |
| Does | repo create + brand.json/briefs + **enqueue** | clone/brand/build/push/**deploy** |
| Talks to | GitHub API, Supabase (insert job) | git, pnpm, `claude` CLI, Vercel API, Supabase |
| Concurrency | n/a | single worker + `~/stores/.forge.lock` → never two forge jobs at once (RAM-safe) |
| Timeout | none (just an insert) | 45 min provision / 30 min revision |

The worker is intentionally **dependency-light** (only `postgres` + Node built-ins) and its
bash pipeline is a hand-kept **mirror of `src/lib/revise.ts`** — see the sync warning below.

## The template monorepo — `nanocrew-templates`

One repo, four self-contained Next.js templates mapped 1:1 to the design-temperament
question Venus already asks. The mapping lives in `TEMPLATE_BY_STYLE` in `src/lib/provision.ts`:

| Template dir | designStyle | Character |
|---|---|---|
| `templates/minimal` | `minimalist` | whitespace, type-led, quiet product grid |
| `templates/bold` | `bold` | full-bleed imagery, heavy display type, loud CTAs |
| `templates/elegant` | `elegant` | serif-led, editorial layouts, generous spacing |
| `templates/extravagant` | `extravagant` | motion, texture, maximal hero, statement layouts |

Unknown styles fall back to `minimal`. Each template is **self-contained** (duplication over
coupling — stability is the product) and uses placeholder images/copy until a brand lands.

Each template ships (verified in `templates/minimal/`):
- `app/` — `page.tsx` (home) + `shop`, `product`, `cart`, `about`, `blog`, `contact`,
  `policies`, and `/admin` (the creator dashboard) routes
- `lib/` — `api.ts` (platform-api client — **the data contract**), `cart.tsx`,
  `platform-auth.ts`, `brand.ts`, `content.ts`
- `content/` — `copy.json`, `blog/*.md`, `policies/*.md` (Claude's editable copy surface)
- `brand.json` — the token contract (placeholder values in the template)
- `TEMPLATE.md` — hard rules; `VOCABULARY.md` — maps a creator's everyday words → blocks/files

### The token contract — `brand.json`

The single file that makes a template become a brand. Written **deterministically by
`buildBrandJson()` in `provision.ts`** — Claude never invents tokens (the palette/typography
the creator chose are hard constraints). Shape (from the live code):

```jsonc
{
  "storeId": "uuid",            // ← links the site to platform-api
  "slug": "alpha-master",
  "name": "Alpha Master",
  "tagline": "…",
  "logoUrl": "https://res.cloudinary.com/…",
  "palette": { "primary": "#…", "secondary": "#…", "accent": "#…", "background": "#…", "text": "#…" },
  "typography": { "display": "…", "body": "…" },
  "designStyle": "bold",
  "voice": "…",  "story": "…",  "vibeKeywords": ["…"],  "products": ["…"],
  "social": {},
  "apiBase": "https://nanocrew-api.vercel.app",   // PLATFORM_API_BASE — empty ⇒ placeholder products
  "platform": { "supabaseUrl": "…", "supabaseAnonKey": "…" },  // so the site's /admin login works
  "commerce": { "feeWaiveCents": 20000, "feePct": 0.029 }       // mirrors what checkout actually charges
}
```

`palette` is derived by matching `brand.designSystem.palette[].role` against keyword sets
(primary/secondary/accent/background/text) with sensible fallbacks. `apiBase`,
`platform.*`, and `commerce.*` come from env (`PLATFORM_API_BASE`,
`EXPO_PUBLIC_SUPABASE_*`, `PROCESSING_FEE_*`). Copy lives in `content/` — written by Claude
in the brand's voice, editable during revisions.

### What Claude may and may not touch

Allowed edit surface (stated in `briefs/01-BRAND.md` + `02-TEST.md`, and re-stated per revision):
- `brand.json` **tokens** (but never substitute the pipeline-written palette/typography),
  `content/**` (copy + blog), `app/globals.css` fallback vars, page metadata, and
  **composing existing blocks** inside `app/*/page.tsx` (per `VOCABULARY.md`).

Forbidden (enforced by `02-TEST.md` acceptance + the per-revision brief):
- new dependencies, new routes, or touching `lib/api.ts`, `lib/cart.tsx`,
  `lib/platform-auth.ts`, `components/blocks/beacon.tsx`, or the `/admin` pages — these are
  the commerce/data rails. If a request maps to no existing block, Claude notes it instead
  of inventing one.

## The brief protocol (what the forge's Claude receives)

Markdown in `briefs/`, generated by `provision.ts` from the interview and shipped in the queue payload:

1. **`01-BRAND.md`** (`buildBrandBrief`) — which template was chosen and why; identity
   (name, tagline, mission, audience, voice, story, vibe, products, logo, texture/motion
   cues); the creator's own site wishes (translated via `VOCABULARY.md`); and the last ~24
   turns of the transcript to mine for copy. Directives: treat `brand.json` as hard
   constraints, rewrite `content/copy.json` in the brand voice, write one launch blog post,
   refresh policy tone, align `globals.css` fallbacks, set page metadata.
2. **`02-TEST.md`** (`buildTestBrief`) — acceptance gate the session must satisfy before
   finishing: `pnpm run build` clean; no new deps / no new routes; the commerce/data rails
   untouched; `brand.json` still valid JSON with the exact pipeline palette/typography; no
   placeholder text anywhere visible; every page reads like the brand wrote it.

Revisions append numbered briefs (`briefs/03-REVISION-<n>.md`) generated from what the
creator told Venus — same constraints, "apply ONLY the requested change" framing.

## Revisions — the same queue, a working branch

When a creator asks Venus to edit a live site, the change rides the **same `store_revisions`
queue** (this is why the worker and `provision.ts` share it). The worker's revision path is a
mirror of `src/lib/revise.ts`:

- A revision row carries `branch = 'revision/<id>'` (anything ≠ `'__provision__'`), the
  `request_md` (creator's words), and optional circled `screenshots` (annotations rendered
  into `briefs/screenshots/` on the forge via `~/critique-shot/render.mjs`).
- The worker reuses the persistent per-store clone, cuts the `revision/<id>` branch, lets a
  constrained `claude` session apply ONLY that change, gates on `pnpm run build`, and pushes
  the **branch** (never `main`).
- Vercel deploys the branch as a **preview**; `resolvePreviewUrl()` polls the Vercel API for
  the READY deployment matching `githubCommitRef`; the row flips to `'ready'` with `preview_url`.
- The creator reviews the preview and approves → `approveRevision()` (in `revise.ts`) merges
  the branch into `main` (production deploy) and deletes the branch. Approve/merge still runs
  from the app server.

> ⚠️ **Sync warning:** the worker's `buildScript()` / `buildProvisionScript()` bash is a
> hand-kept copy of `src/lib/revise.ts` (persistent-clone + pnpm + render + global-lock
> recipe). Change one, change the other.

## The forge env contract

The worker (`nanocrew-forge-worker.service`, run as the `forge` user) needs:

| Var | Used for |
|---|---|
| `DATABASE_URL` | poll `store_revisions`, write back store/revision status (postgres-js) |
| `GITHUB_TOKEN` / `GITHUB_OWNER` | clone templates + brand repos, push `main`/branches |
| `VERCEL_TOKEN` | create the Vercel project + trigger deploys + resolve preview URLs (skips deploy if absent) |
| `TEMPLATES_REPO` | optional; default `<owner>/nanocrew-templates` |
| `claude` CLI + `~/.claude-env` | auth for headless Claude (`ANTHROPIC_API_KEY` is explicitly *unset*; OAuth/key comes from `~/.claude-env`) |

The app-server side (`provision.ts`) needs `GITHUB_TOKEN`/`GITHUB_OWNER` (required, else it
silently skips), plus `PLATFORM_API_BASE`, `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `PROCESSING_FEE_*` baked into `brand.json`.
(`provision.ts`'s `config()` also reads `VPS_HOST`/`VPS_USER` for legacy reasons, but the
provision path no longer dials them — the worker owns all forge execution.)

## Commerce & data — see the data contract

Brand sites are **headless storefronts on the Nanocrew platform API**. Everything about how a
deployed template reads its catalogue (the nested-variant product shape, collections,
checkout with the platform application fee), how it stays in sync (ISR `revalidate: 300` +
`revalidateStorefront(slug)` on-demand rebuild), and how a bespoke site like
`stephenlawyer.clothing` was cut over to read the same contract lives in:

> **➜ [docs/STOREFRONT_DATA_CONTRACT.md](./STOREFRONT_DATA_CONTRACT.md)** — read it before
> touching any storefront's data layer.

The engine in *this* doc stops at deploy; the contract doc owns the live data flow.

## Blog & media

- **Blog posts** live in the platform DB (`store_posts`), served by the public API — so
  authoring from Studio or the site's `/admin` is instant and free (no forge session, no
  redeploy). Templates fetch posts dynamically and fall back to `content/blog/*.md` when
  offline. (The launch post written during provisioning seeds `content/blog/`.)
- **Images / short video**: uploaded in Studio → Cloudinary (existing plumbing) → URLs
  referenced in copy/products. **Long video**: YouTube embed component (no upload OAuth).

## Cost & billing model

- Initial generation: one bounded `claude` session on the forge (template + tokens keep it
  small). Interview cost ≈ $0.15–0.20 (TTS-dominated).
- Revisions: per-token-billed Claude sessions — the metered product; "small edits only"
  constraints keep sessions short.

## Dashboards

**Creator dashboard — `/admin` on every brand site.** Same Supabase login as the app
(`platform.supabaseUrl`/`supabaseAnonKey` in `brand.json`). Thin: it calls platform
`/api/creator/*` with the creator's token; the API verifies store ownership. Surface:
revenue + order count + 30-day traffic, order list. Traffic comes from a public beacon —
brand sites POST `/api/public/beacon` per pageview into a `page_views` daily counter.

**Platform admin — inside the Nanocrew app.** Role-gated section on Account backed by
`/api/admin/platform`: all stores w/ status, platform-wide orders/revenue, and adjustment
actions (suspend store, re-provision).
