# Edit pipeline — the expected flow + how to trace a failure

When a creator edits a **live site** by talking to Venus in the preview critique editor
([`src/components/site-preview.tsx`](../../src/components/site-preview.tsx)), the request flows
through five hops. Each hop has a **checkpoint** you can inspect when something goes wrong. This doc
is the contract: if a request produces the wrong result, walk these checkpoints in order and the
failure localizes to exactly one hop.

## The expected pipeline

```
  CREATOR SPEAKS              PLAN                 GENERATE              PLACE                 FORGE
  (voice → transcript)   plan-site-edits      /api/generate     /api/creator/site-assets   /api/creator/revise
        │                      │                    │                    │                      │
   venus.messages    ─► {images[],edits[]} ─► image url (Cloudinary) ─► stores.site_assets ─► store_revisions → droplet worker
        │                      │                    │                    │                      │
   CP1 transcript        CP2 [pipeline:plan]   CP3 [pipeline:        CP4 [pipeline:         CP5 [pipeline:revise]
   persisted on the      logs lastSaid →       generate] logs       site-assets] logs      logs turns + requestMd;
   revision row          images/edits          prompt → url         slot + url             transcript persisted
```

- **images** (hero / logo / og) are generated and placed **directly** — the forge can't make images.
- **edits** (text, color, layout, structure) go to the **forge** on a working branch.
- The two run independently in one `submit()`; either side can be empty.

## Checkpoints — what to look at, in order

| CP | Where | What it tells you |
|----|-------|-------------------|
| **CP1 — said vs captured** | `store_revisions.transcript` (jsonb, raw turns) vs `request_md` (distilled) | Did the creator's words even reach the backend intact? If the transcript is missing the subject the creator spoke (e.g. "american flag"), the loss was in **voice capture/transcription** — upstream of everything else. |
| **CP1b — what was attempted** | `store_revisions.edit_plan` (jsonb) | The structured outcome of the **whole submit**: `counts.{images,edits,total}` (how many requests), plus per-image `{slot, prompt, generated, placed, error}`. A `hero: gen-only (placement failed …)` here tells you the image generated but didn't get written; `FAILED` with an `error` tells you generation itself failed (content-safety, quota, empty prompt). |
| **CP2 — classification** | Railway log `[pipeline:plan] … lastSaid=… → images=N[…] edits=M` | Did the plan turn the request into the right shape? A hero-image ask that yields `images=0` means the subject was vague/missing (often a CP1 loss) or misclassified. |
| **CP3 — generation** | Railway log `[pipeline:generate] ok prompt=… → <url>` (or absence + an error) | Did the image actually generate? No line = generate never ran (no image in the plan) or it failed (content-safety, quota). |
| **CP4 — placement** | Railway log `[pipeline:site-assets] slug=… slot=… url=… (revalidating)` + `stores.site_assets` in DB + public API `/api/public/stores/:slug/site-assets` | Did the new asset get written and the storefront revalidated? |
| **CP5 — submit + forge** | Railway log `[pipeline:submit] slug=… requests=N images=[hero:placed,…] edits=M forge=building(…)`, then the droplet worker journal (`journalctl -u nanocrew-forge-worker`) | The one-line summary of the whole submit: how many requests, what happened to each image, and whether a forge job was enqueued. **Every submit writes exactly one `store_revisions` row** — forge edits → `status=building` (worker drains it); image-only → `status=approved` (applied straight to the live site, worker skips it). Either way the transcript + edit_plan are persisted. |

## Worked example — the "american flag" hero that reverted to placeholder (2026-06-19)

- **Symptom:** creator asked for the hero to be "an american flag blowing in the wind"; review showed the **placeholder**.
- **CP1:** `store_revisions.transcript`/`request_md` for the revision contained only *"change the background color of the hero. Actually, make it an image."* — **"american flag" was never captured.** Root cause is here: voice capture dropped the image subject.
- **CP2:** with no subject, the plan returned no image → client fell back to `rawMd()` and forged the vague note.
- **CP3:** never ran (no image in the plan).
- **CP5:** the forge got "make the hero an image" with no image → placeholder.

Before this instrumentation we had **only** `request_md` and had to reconstruct the rest. CP1
(persisted transcript) now makes "said vs captured" a one-query answer.

## Grep recipe

```
# one store's whole pipeline, newest last
railway logs | grep -E "\[pipeline:(plan|generate|site-assets|submit)\]" | grep alpha-master
# said vs captured + what was attempted, for the latest submit
select status, request_md, transcript, edit_plan
  from store_revisions
  where store_id = (select id from stores where slug='<slug>') order by created_at desc limit 1;
```

## Related

- [BUILD_FLOW.md](BUILD_FLOW.md) — the build→refine→publish arc this edit loop sits inside.
- [FORGE_AI.md](FORGE_AI.md) — how the forge robot is conditioned + the quality gate.
- [DESIGN_GENERATOR.md](DESIGN_GENERATOR.md) — the asset pipeline (CP3/CP4 share `/api/generate` + Cloudinary).
