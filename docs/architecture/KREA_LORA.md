# Krea LoRAs — on-model shots of the actual garment (build plan, 2026-08-15)

**Goal (Joe):** use Krea to train LoRAs, and use those LoRAs to generate modeled shots of our
clothing — consistent, on-brand model photography of the real product, not generic lookalikes.

## What Krea offers (verified from docs, 2026-08-15)
- **LoRA training:** upload training images (zip/URLs), optional trigger word, auto-captioning,
  steps (min 100), 768 res → LoRA weights usable on the Krea-2 LoRA inference endpoint (weights
  also work across Flux/Wan-family models). **Cost: $0.003/step, min 100 steps — a standard
  1000-step fine-tune = $3.00.** Commercial use permitted.
- **Inference:** Krea 2 medium $0.030/img, large $0.060/img; Flux-Krea w/ LoRA ≈ $0.035/MP
  (≈ $0.035–0.07 per 1K-res shot). Failed jobs not charged.
- **Auth/billing:** Bearer API key; separate PREPAID USD API balance (not app credits) — ops
  must fund and monitor it. Upscaling to 22K and video models ($0.05–0.40/s) available later.

## Unit economics for us
- One-time per avatar: ~**$3.00** (1000-step LoRA on the person).
- Per model shot: ~**$0.04–0.07** → a 6-shot set ≈ $0.30.
- Compare today's `model_shots` (3 Nano Banana renders, ~$0.12, 25 credits): similar per-shot
  cost, but the LoRA gives a **consistent model identity across unlimited shots/scenes/angles**.
  Credits suggestion: `lora_train: 600` (≈2× cost
  margin, one-time per product) · `lora_shot: 10` per image. Comp accounts exempt as usual.

## The model: AVATAR LoRAs only (Joe, 2026-08-15)
**There will never be a garment LoRA.** Krea is used for exactly one thing: training **modeling
avatars** — persistent virtual models. The avatar is the durable brand asset; products are
matched onto avatars at shot time (the product render/design rides the generation as reference
imagery + prompt, and our existing composite pipeline owns garment fidelity — NOT Krea training).
- **Avatar LoRA** — a person, trained once (~$3):
  1. **Base models (house library)** — a curated, diverse set Nano Crew ships (licensed/generated
     photo sets, platform-owned, `store_id` NULL). Every creator shoots on them free — only the
     per-shot fee.
  2. **Creator models (user-uploaded)** — a creator uploads 10–20 photos of themselves (or their
     model, with consent affirmation) → personal avatar LoRA, scoped to their account, usable
     across all their brands. Billed via `lora_train`.
- A shot prompt reads: `<AVATAR_TRIGGER> wearing <product description>, <scene/pose from the
  diversity bank>` with the product image as reference — one avatar, any product, any scene.
- Schema: `loras` rows are avatars (`product_id` stays NULL / may be dropped), `creator_id` for
  personal avatars, `store_id` NULL for the house library. **(NOT YET MIGRATED — the shipped 0026
  table is the pre-pivot garment shape: `store_id` NOT NULL, no `creator_id`. A migration must
  relax `store_id` and add `creator_id`, and the "garment LoRA" comments in both schema copies,
  `src/lib/krea.ts`, and DATABASE_PLAN.md must be rewritten to the avatar model — see
  docs/ops/BUG_AUDIT_2026-08-20.md.)**
- **Consent/safety:** uploads gated by an explicit "I have rights to these photos / this is me or
  a model who consented" affirmation; avatar LoRAs are private to the uploading account, never
  shared or listed. No training on third-party/celebrity photos.

## Build phases
**STATUS 2026-08-20** — K1 shipped 2026-08-15 but is unwired; K2–K6 are not started.
`KREA_API_KEY` is already provisioned in the dev env (`.env.local`). Blocked pieces: the schema
avatar migration (see the NOT YET MIGRATED note above) and the FORGE_WATCHDOG cron.

- **K1 — Client lib** `src/lib/krea.ts` — **SHIPPED 2026-08-15, unwired:** the lib exists
  (`kreaTrainStyle` / `kreaGetJob` / `kreaAwaitJob` / `kreaGenerate`; auth via KREA_API_KEY env)
  and so does the `loras` table
  (id, storeId, productId, kreaJobId, styleId, triggerWord, status, steps, costCents, errorMsg,
  createdAt, completedAt — both schema copies + migration 0026, RLS enabled) — but nothing imports
  the lib or writes the table yet, and nothing polls non-terminal rows. Statuses WILL ride the
  SAME watchdog pattern as forge jobs (stalled/retry/abandoned) once the FORGE_WATCHDOG cron ships
  (docs/architecture/FORGE_WATCHDOG.md — not yet built).
- **K2 — Avatar training flow:** photo upload (Cloudinary) + consent affirmation → train the
  avatar LoRA (trigger word per avatar). House base models trained once by ops the same way.
- **K3 — Shot generation:** avatar LoRA + the product render as reference + scene/pose prompt
  bank (docs/studio/FORGE_DIVERSITY) → N shots per run → persist to the product's image gallery +
  site galleries (same fields model_shots feeds today), storefront revalidate on write. Garment
  fidelity = our composite pipeline + reference imagery, never Krea training.
- **K4 — Surfaces:** the existing post-publish "Generate model shots" button reroutes to the
  LoRA path once a product has a trained LoRA (else offers training first). Sell-tab video ads
  can later seed from LoRA stills. Eve intent ("shoot my hoodie on a model") in a later pass.
- **K5 — Credits + flag:** KREA_ENABLED env flag; credit keys above; API-balance low-water
  alert in the watchdog cron (Krea balance is prepaid — running dry silently kills the feature).
- **K6 — Avatar picker:** house grid + "your models" + upload-new in the shot flow;
  `creator_id` column on `loras` for personal avatars.

**Pilot:** train one avatar (~$3) from a real photo set, then shoot the Circuit Owl Tee on it
(product render as reference), review in the curation modal before anything lands on the site.
