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
- One-time per product: ~**$3.00** (1000-step LoRA on the garment).
- Per model shot: ~**$0.04–0.07** → a 6-shot set ≈ $0.30.
- Compare today's `model_shots` (3 Nano Banana renders, ~$0.12, 25 credits): similar per-shot
  cost, but the LoRA gives **garment fidelity across unlimited shots/scenes/angles** — the
  product looks like ITSELF in every photo. Credits suggestion: `lora_train: 600` (≈2× cost
  margin, one-time per product) · `lora_shot: 10` per image. Comp accounts exempt as usual.

## Build phases
- **K1 — Client lib** `src/lib/krea.ts`: auth (KREA_API_KEY env), submit training job, poll to
  completion, run LoRA inference. All jobs recorded in a new `loras` table
  (id, storeId, productId, kreaJobId, weightsRef, status, steps, costCents) — statuses ride the
  SAME watchdog pattern as forge jobs (stalled/retry/abandoned) via the FORGE_WATCHDOG cron.
- **K2 — Training-set builder:** per product, assemble the set automatically: composition
  renders (front/back), Printful mockups, the flat design on the garment, existing model_shots
  if any (8–20 images), zip → train. Trigger word = the product slug. Store the LoRA ref on the
  product.
- **K3 — Shot generation:** scene/pose/diversity prompt bank (reuse docs/studio/FORGE_DIVERSITY
  guidance for model diversity) → N shots per run via the LoRA endpoint → persist to the
  product's image gallery + site galleries (same fields model_shots feeds today), storefront
  revalidate on write.
- **K4 — Surfaces:** the existing post-publish "Generate model shots" button reroutes to the
  LoRA path once a product has a trained LoRA (else offers training first). Sell-tab video ads
  can later seed from LoRA stills. Eve intent ("shoot my hoodie on a model") in a later pass.
- **K5 — Credits + flag:** KREA_ENABLED env flag; credit keys above; API-balance low-water
  alert in the watchdog cron (Krea balance is prepaid — running dry silently kills the feature).

**Pilot:** Night Circuit's Circuit Owl Tee — train one LoRA (~$3), generate a 6-shot set, review
in the same curation modal before anything lands on the site.
