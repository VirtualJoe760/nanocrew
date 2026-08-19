# End-to-end scenarios

Four flows a tester should be able to run start to finish. Each one lists the **voice/UI path**
(what a creator actually does — this is what you're testing), the **API path** (deterministic setup
or a fast route to the same state), and **how to verify** it truly happened rather than appeared to.

Read [`ui-driving.md`](ui-driving.md) first for taps, deep links and screenshots.

Conventions: `CID` = the internal creator id (`c60f23f8-f804-4ecb-8018-36e90433a96e`),
`H` = `-H "x-internal-key: $INTERNAL_API_KEY" -H "x-internal-creator: $CID"`.

---

## S1 · Build a brand from a conversation

**Voice/UI path**

```bash
xcrun simctl openurl booted "nanocrew://studio?talk=1"
npm run eve:talk -- "I want to build a new brand about dogs. Streetwear for dog people — hoodies and tees for the dog park, skate-culture energy, not cutesy pet-store stuff. Call it Mutt Society."
npm run eve:talk -- "Black and cream with one hit of safety orange. Heavyweight hoodies, boxy tees, dad caps."
npm run eve:talk -- "That's everything — build it."
```

She should riff, not interrogate; when she has the essentials she offers the choice rather than
deciding. Saying "build it" ends the interview (`save_brand`), and the **Brand Compiled** review
screen appears — name, tagline, palette, story, template picker. Tap **Create my store**.

**Watch for:** does she ever demand a colour or a style word? She shouldn't — palette and style are
derived. Does she keep gathering after you say build it? She shouldn't.

**Verify**

```bash
curl -s http://localhost:8081/api/me $H | python3 -m json.tool | grep -A3 '"slug"'
curl -s https://api.nanocrew.app/api/store/<slug> | head -c 300     # once the site is live
```

---

## S2 · Design a design for that brand

**Voice/UI path**

```bash
npm run eve:talk -- "Let's make a tee with a bulldog in shades, gold chain, neon sunset behind him."
```

Expected sequence: she says the idea back, announces the catalogue **and gives one suggestion in the
same line**, then the picker opens (it must never open mid-sentence). Tap a product → she asks
enhance-or-as-is → tap one → she generates → review tools (Clean up · Tell Eve · Redo · Feather ·
Remove background) → "Put it on the tee" → placement editor (drag on the garment, tool tabs) →
Move on to pricing → colour photo cards → **Publish**.

**API path** (free, deterministic — good for setting up a product to test the UI against)

```bash
curl -s -X POST http://localhost:8081/api/generate $H -d '{"prompt":"bulldog in shades, gold chain","catalogueId":"<id>","background":"transparent","aspectRatio":"1:1"}'
curl -s -X POST http://localhost:8081/api/compositions $H -d '{"catalogueId":"<id>","designId":"<designId>","templateKey":"71","placement":"front"}'
curl -s -X POST http://localhost:8081/api/publish $H -d '{"compositionId":"<cid>","name":"Bulldog tee","variants":[{"printfulVariantId":4012,"retailPriceCents":3900,"size":"M","color":"White"}]}'
```

**Verify**

```bash
curl -s https://api.nanocrew.app/api/store/<slug> | python3 -c "
import sys,json; d=json.load(sys.stdin)
rows=[(p['name'],p['imageUrl']) for c in d['collections'] for p in c['products']]
print('blank images:', sum(1 for _,i in rows if not i), 'of', len(rows))"
```

Blank images must be **0** — a product with a null image is the regression fixed on 2026-08-18.

---

## S3 · Edit the website through the UI

**UI path.** Wheel → **SITE** opens the brand deck → pick the brand → **✦ Site Options** → the live
preview. In the critique view she is listening: circle a part of the page and say the change
("make this headline bigger", "swap this photo for something moodier"). Each edit is logged; submit
builds a revision on a branch — never on the brand's `main`.

**Watch for:** she should *name* the part you circled (that's `VOCABULARY_BRIEF` doing its job), keep
each confirmation to one line, and invite the next edit. She must not ask brand questions here.

**API path**

```bash
curl -s -X POST http://localhost:8081/api/creator/revise $H \
  -d '{"storeSlug":"<slug>","requestMd":"Make the hero headline bigger and swap the hero photo for something moodier."}'
curl -s "http://localhost:8081/api/creator/revisions?storeSlug=<slug>" $H | head -c 400   # building → ready
```

**Verify:** the deck shows the revision row (building → ready), and approving it publishes; declining
discards. The live site only changes on approval.

---

## S4 · Website graphics (the ASSETS spoke)

```bash
xcrun simctl openurl booted "nanocrew://studio?talk=1"
npm run eve:talk -- "Make me a new hero image for the site — muddy dogs at golden hour, shot like a zine."
```

She asks which spot (hero · wordmark · app icon · favicon · social), riffs, generates, then **Set as
hero** writes it straight to the site.

**Verify**

```bash
curl -s "http://localhost:8081/api/creator/site-assets?storeSlug=<slug>" $H | python3 -m json.tool
```

`hero` should be a fresh Cloudinary URL; the Design tab's Site-assets strip should show it as
**● Hero** within a refresh.

---

## What "passing" means

A scenario passes when the flow completes **and** her conversation through it holds up:

- she never funnels an off-topic remark back to the brand,
- she offers choices at process forks instead of deciding,
- she proposes on taste instead of polling,
- she never speaks over you (a cue queued mid-sentence waits),
- turns stay around 30 words unless she asked for room,
- nothing she agrees to gets refused by the generator (guardrails match `lib/content-safety.ts`).

Log failures with the transcript excerpt from `local-logs/` and the `[live] …` lines from Metro —
those two together are enough to find any of the bugs we've hit so far.
