# Nanocrew Designer — Feature Roadmap

Porting the stephen-lawyer designer (`docs/DESIGN_GENERATOR.md` in that repo) to the native
app. This tracks what's done, what's left, how each is implemented, and how I verify it.

## Verification reality (why some things need Joe)
- **I can self-verify:** API routes (call them), non-gesture UI (sim screenshot), typecheck,
  Printful/Cloudinary results.
- **Needs Joe's device:** anything gesture-driven (pan, tap, pinch, drag, resize, select) —
  synthetic events don't reach react-native-gesture-handler on the sim. These get **batched**
  into one device test, not one-at-a-time.

---

## ✅ Done this session
- Real composite render (`/api/composite` → `composeOnGarment`) — design shows on the garment.
- Node controls: ×-remove, **color picker** (`/api/blank/[id]/colors`), selection model.
- Selection: tap=select (highlight ring), tap-empty=deselect, pinch-selected=resize node,
  pinch-empty=zoom canvas.
- Canvas pan/pinch fixed on device (zero-size-view transform bug).

---

## Track A — Designer parity (NO database needed; build + mostly self-verify)

### A1. Quick wins (self-verifiable)
- **Wire gen controls to the API** — the Transparent/Background + aspect-ratio chips exist in
  the Generate sheet but aren't sent to `/api/generate`. Pass them through; build the
  transparent-vs-filled + aspect system prompt server-side (mirror stephen-lawyer's `gemini.ts`).
  *Verify: curl `/api/generate` with the params.*
- **Aa Text** — a "Text" button in the Generate sheet → builds a lettering prompt → same
  generate pipeline (always transparent). *Verify: curl.*
- **Templates search** — a search box in the dock that filters blanks by name across the gender
  bucket. *Verify: sim screenshot.*

### A2. Combine → placement (medium)
- **`/api/blank/[id]/placements`** — available print placements (front/back/sleeves) for a product.
- **CombineDialog** — on drop design→product, show placements; chosen one creates the composite.
- **AddPlacementDialog** — drag a design onto an existing composite → append a placement.
  *Verify: curl the route + sim screenshots of the dialogs (they're Pressable sheets, sim-clickable).*

### A3. PlacementEditor — the centerpiece (large)
- **`/api/blank/[id]/printareas`** (per-placement pixel dims + render variant) and **`/api/mockup`**
  (Printful mockup generator for placements[]).
- UI: placement chips (Front/Back + "Add design"), an interactive print-area box (drag-to-move,
  corner-resize, **size slider**, Fill-width, Center, clamped to the area), **Generate Printful
  mockup** → shows the real mockup. Persist position per placement.
  *Verify: routes by curl + the real mockup image; the drag/resize box is gesture → device batch.*

### A4. Group containers (medium)
- On combine, lay out `[design][product][composite]` and wrap them in a draggable group box
  (header drag moves all; × ungroups). *Gesture (group drag) → device batch.*

### A5. Publish flow (large — makes products REAL)
- **Finalize screen**: product variants grouped by color, a retail price, markdown description.
- **`/api/publish`** → upscale the raw design PNG (`c_scale` ~4500px) → `createSyncProduct` to the
  **Nanocrew Printful store** (store 18313070) → returns the live sync product.
  *Verify: I can confirm the sync product exists via the Printful API.*

---

## Track B — Foundation (needs Joe to provision a DB)

### B1. Database (per `docs/DATABASE_PLAN.md`)
- Provision **Neon Postgres** → `DATABASE_URL` in `.env.local` *(needs Joe — account/credentials)*.
- Add Drizzle + postgres-js + the multi-tenant schema; generate + migrate.

### B2. Catalogues / collections
- **Interim (no DB, build now):** a catalogue selector chip in the Design header (in-memory) so
  the concept is visible and nodes/designs are scoped to the active catalogue in state.
- **Full (with DB):** real `catalogues` rows, switching, creation, scoping.

### B3. Canvas persistence
- Persist designs / nodes / compositions per catalogue (replace-all save) once the DB is up.

---

## ~~Old execution order~~ → GAMEPLAN v2 (locked with Joe 2026-06-10)

**Decisions:** Supabase (DB+Auth) · billing = subscription AND Connect commission (via web
portal) · Studio = shared layout skeleton + generated brand design systems · seed content =
our products + Stephen Lawyer brand + AI demo brands. Details in `DATABASE_PLAN.md` §6.

**Done so far:** A1 ✓ (gen controls, Aa Text, search) · catalogue selector ✓ (in-memory) ·
node controls ✓ (select/ring, pinch-resize, ×, color picker) · real composite render ✓.

### Phase 1 — Foundation (Supabase)
- Joe creates the Supabase project → `DATABASE_URL` (pooled + direct) + anon/service keys.
- Drizzle + multi-tenant schema (DATABASE_PLAN §3) → migrate.
- Persist the designer: catalogues, designs, compositions, canvas nodes.
- Supabase Auth in the app (creator sign-in); Account tab gets real settings + web-portal
  redirect for billing.

### Phase 2 — Finish the designer (the content factory)
- **Grouping** (combine layout `COL=175`, `GROUP_PAD=16`, group box + reflow, header-drag,
  ungroup) + selection tools (canCombine on selection).
- **A2** placements route + CombineDialog/AddPlacementDialog.
- **A3 PlacementEditor** (`fitClamp` math, size slider, multi-placement chips, server clamp,
  `/api/mockup` via `renderMockups`).
- **A5 Publish**: FinalizeForm (variants by color, 2× base price default) → upscale →
  `createSyncProduct` (idempotency = composition id) → mirror into `products`/`variants`.
- End state: prompt → SELLABLE product from the phone. Populates the catalog for Phase 3.

### Phase 3 — Market + the Nanocrew feed
- **Nanocrew tab → TikTok-style vertical pager** (full-screen FlatList paging) fed by
  published products/designs/stores.
- **Market tab** → trending products, brand search, brand catalogue pages (reads the same
  `stores`/`products`/`variants` tables).
- Seed: import Stephen Lawyer catalogue as flagship brand; publish our own products.

### Phase 4 — Studio + web portal
- **Studio**: Claude (Anthropic API, server-side) brand interview → `brand_profile` jsonb
  (identity + character data) → Nano Banana logo/OG/favicon → `design_system` jsonb →
  store goes live on the shared storefront engine (skeleton = stephenlawyer layout; skin =
  generated design system incl. motion). AI demo brands made with this exact pipeline.
- **Web portal** (Next.js): Stripe Billing (subscriptions) first, Connect onboarding second;
  hosts the storefront engine + marketplace web views.
</content>
