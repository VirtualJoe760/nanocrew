# VENUS CENTRAL — the game plan (2026-07-05)

> Joe: "Venus should complement the app at whole… she should become a general AI assistant —
> building the brand and editing the sites are just versions of how she helps… swipe down for
> Venus… read stats… ideas for drops… control the design section… memes and video content…
> upsell plans and credits."
> Produced by a 4-inventory + design workflow; every path verified against the repos.

# VENUS AS THE OPERATING SYSTEM — Game Plan

## 1. Product Vision

From any screen in Nano Crew, you pull down from the top edge and Venus is there — the same constellation orb, the same Kore voice, one continuous relationship. She already knows your brand (`stores.brandProfile`), your numbers (stats/orders/margins), your credit balance, and what screen you were just on. You can type or talk: "how'd the store do this week?" gets real units-per-day numbers; "I want a Halloween drop" becomes an ideation session that ends with generated designs and a new catalogue; "make that a meme" fires the meme pipeline; and when you run out of credits mid-idea, she's the one who tells you what a pack costs and opens the paywall — as a consultant closing a deal, not a popup. The brand interview and the site critique stop being separate apps-within-the-app and become two of the many things the one Venus does.

---

## 2. Architecture

### 2a. THE VENUS SHEET (global swipe-down surface)

**Mount point.** `src/app/_layout.tsx` already wraps everything in `GestureHandlerRootView` (line 44) above `AppTabs` (`src/components/app-tabs.tsx:25-30`). Mount two new components there, as siblings above the tab navigator:

- `<VenusProvider>` (new, `src/state/venus-provider.tsx`) — owns the session, memory, context packs, tool executor.
- `<VenusSheet>` (new, `src/components/venus-sheet.tsx`) — a reanimated sheet driven by a `Gesture.Pan()` activated from a ~24px top-edge hit zone (plus a persistent small `VenusGlyph` affordance in the header, reusing the one from `studio-dashboard.tsx:86`). Top-edge activation avoids fighting vertical ScrollViews and the `PanResponder` circling in `site-preview.tsx`.

**Avatar.** The sheet uses `VenusBubble` (`src/components/venus-bubble.tsx`, 96px disc — already proven in `site-preview.tsx:670`) by default; escalate to the full-bleed `VenusAvatar` orb (`src/components/venus-avatar.tsx`, `VenusStage` mapping copied from `venusStageFor()` in `studio.tsx:73`) only when a live voice session is active and the sheet is fully expanded. Never mount the heavy R3F scene while collapsed (inventory constraint #9). Lip-sync comes free: `pushSpeechChunk` → `venus-speech-level.ts` → `venus-lipsync.ts` already feeds any mounted avatar.

**Text + voice duality.** Two lanes, one transcript:
- **Text lane (default, cheap):** a new server route `POST /api/venus/chat` (new file `src/app/api/venus/chat+api.ts`) running `gemini-2.5-flash` **with real function-calling** — text models call tools reliably; only native-audio Live doesn't (documented in `live-voice.ts:5`, `extract-brand+api.ts:8-10`). This is where most tool execution lives.
- **Voice lane (on mic tap):** the existing `LiveVoiceSession` (`src/lib/live-voice.ts:197`) via `useLiveVoice`, with data injected through `sendContext()` (line 521) and actions extracted by the proven distill-then-execute pattern (`/api/extract-brand`, `/api/creator/plan-site-edits`).

**Coexistence with today's in-tab embeds.** The module-level singleton `activeLiveSession` (`live-voice.ts:190`) already guarantees one Venus talking app-wide, and `isVenusLive()` (line 193) exists with zero consumers — the sheet becomes its first consumer. Rule: if the studio interview (`studio.tsx:736`) or critique view (`site-preview.tsx:203`) owns a live session, the sheet opens in **text-only companion mode** and does not start voice (Phase 1); in Phase 2 both embeds are re-pointed at the provider's shared session. The sheet must also own audio-mode arbitration — generalize the `setAudioModeAsync` switching from `studio.tsx:804-806` into the provider so `/api/say` playback and the Live mic never fight.

### 2b. ONE VENUS (session/persona unification + memory)

**Persona.** `systemInstruction` is frozen at connect (`live-voice.ts:360`), so mode-switching by reconnect is dead on arrival. Instead: one `generalInstruction(userName, brandName?)` added to `src/lib/live-voice.ts` beside `liveSystemInstruction` (line 26) and `critiqueInstruction` (line 57) — same voice identity ("refined female British AI, crisp RP, subtly robotic"), covering all modes, with per-mode **briefs pushed via `sendContext()`** on screen entry (the exact mechanism the critique view already uses for circled elements via `venusContextForHit`, `site-vocabulary.ts:147`). Delete the dead `editSiteInstruction`/`EDIT_SITE_GREETING` exports (line 44-52) while in there.

**Modes become contexts, not sessions:**
- *interview* → context: "creator has no store; run the brand interview; cue 'ready to build your brand'" (preserve the exact cue phrase — the `buildReady` regex latch at `studio.tsx:758-766` depends on it).
- *edit-site* → context: `VOCABULARY_BRIEF` (`site-vocabulary.ts:156`) + current slug + circle-hit injections, unchanged.
- *general* → context pack: stats digest + credits + brand profile + current screen.

**Session ownership** moves from the two screen-lifecycle hooks (`studio.tsx:770-787`, `site-preview.tsx:203-233`) into `VenusProvider`; the screens keep their UI but call `venus.pushMode('interview' | 'critique', payload)`. The 30-min session cap and `uses:2` ephemeral token (`voice-live-token+api.ts`) require re-mint + reconnect handling in the provider — the TODO already flagged in `docs/studio/GEMINI_LIVE.md`.

**Memory (what to persist, where).** Today `stop()` discards the transcript; only `store_revisions.transcript` (schema.ts:552) persists anything. Add:
- `venus_conversations` table (creatorId, storeId?, mode, transcript jsonb, startedAt/endedAt) — write on `stop()`/sheet-close via new `POST /api/venus/conversations`.
- `venus_memory` table (creatorId, facts jsonb, updatedAt) — distilled by a text-model post-pass (same pattern as `extract-brand`): preferences, ideas discussed, open threads ("she was sketching a Halloween drop last Tuesday"). Injected as the first `sendContext`/system block of every session. `stores.brandProfile` + `designSystem` + `catalogues(season='drop')` + `products` are the brand-vocabulary half of memory and need no new storage.

### 2c. THE TOOL REGISTRY (Venus's hands)

Executed by the text-lane function-calling route or the client executor after voice distillation. Every route inherits auth (`getUserFromRequest` + `accessibleStoreIds`), rate limits, and credit gating for free.

| Tool | Maps to | Status |
|---|---|---|
| `get_store_stats` | `GET /api/creator/stats` (`stats+api.ts:69-92`) | **exists-today** |
| `get_recent_orders` | `GET /api/creator/orders` | **exists-today** |
| `get_margins` | `GET /api/creator/margins` | **exists-today** |
| `get_sales_series` (units/day/wk/mo, best-sellers) | new `GET /api/creator/sales-series` over `order_items.quantity` × `orders.createdAt` (schema.ts:325-382) | **needs-building** |
| `get_billing_state` | compose `GET /api/creator/credits` + `GET /api/creator/subscription` | **thin-wrapper** |
| `open_paywall(reason)` | `<Paywall>` props (`paywall.tsx`), `onFreeSlot` for brand_limit | **thin-wrapper** (client action) |
| `generate_design` / `make_meme` | `POST /api/generate` (meme flag + `buildMemePrompt`/`buildMemePromptForProduct`, `src/lib/meme.ts`) → `POST /api/designs` | **exists-today** (entry point is the gap) |
| `roll_idea` / `enhance_prompt` | `GET /api/idea`, `POST /api/enhance` (design.tsx:2427/2443) | **exists-today** |
| `edit_design` / `merge_designs` | `POST /api/edit` (EditMode, edit+api.ts:20), `POST /api/merge` | **exists-today** |
| `create_drop` | `POST /api/catalogues {name, season:'drop'}` | **exists-today** |
| `create_product` (compose→mockup→publish) | `POST /api/compositions` → `/api/mockup` → `/api/publish` | routes **exist**; conversational orchestration **needs-building** |
| `edit_site` | existing pipeline: `plan-site-edits` → `/api/generate` → `/api/creator/site-assets` → `/api/creator/revise` (site-preview.tsx:412-530) | **exists-today** |
| `set_site_asset(slot,url)` | `POST /api/creator/site-assets` (slots at site-assets+api.ts:13-20) | **exists-today** |
| `make_video` | `POST /api/video` (voiceover 25cr / veo 400cr), `/api/creator/scene-video`, `/api/creator/model-videos`, `/api/creator/model-shots` | **exists-today** |
| `write_post` | `POST /api/creator/posts` (+PATCH/DELETE) | **exists-today** |
| `navigate(target)` | `router.navigate('/design?panel=…&slot=…')` (studio.tsx:1209 pattern) | **thin-wrapper**; extending to `?prompt=&action=generate` (design.tsx:399-405, GenerateModal prefill) **needs-building** |
| `speak_line` | `POST /api/say` (one-shot Kore TTS) | **exists-today** |
| `get_brand_context` | `GET /api/creator/stores/:slug` (brandProfile/designSystem) | **exists-today** |
| `save_brand` | existing `SAVE_BRAND` declaration (live-voice.ts:112-140) / `/api/extract-brand` | **exists-today** |

For voice-lane actions, build **`POST /api/venus/plan`** — a generalized clone of `plan-site-edits+api.ts` that distills a transcript into `{actions:[{tool, args}], upsell?, confirmations?}` for the client executor (`src/lib/venus-tools.ts`, new).

### 2d. GUARDRAILS

- **Cost control / when to go live:** text lane is the default (one flash call per turn); Live voice only on explicit mic tap or inside interview/critique. Auto-stop live sessions after ~90s of idle (no mic input, `Date.now() > playEndsAt + idle`) — persist transcript, drop the socket, keep the sheet in text mode. Respect token limits (uses:2, start-within-2-min, 20/user/min).
- **Spend confirmation:** any tool that debits (`CREDIT_COSTS`, `src/lib/credits.ts:12-26`) requires Venus to state the cost and get a **tap** confirmation in the sheet — spoken "yes" is not enough above a threshold (e.g. anything ≥ 60cr: revision, video_veo 400). Destructive ops (`DELETE /api/designs/:id`, store delete/publish toggles) always tap-confirm. The 402 debit-then-refund semantics protect the backend regardless.
- **Upsell taste:** never for comp accounts (`isCompCreator`, `src/lib/comp.ts`; entitlements `status==='comp'`); at most one pitch per session; always lead with an alternative (cheaper video tier from `VIDEO_MODEL_OPTIONS`, free brand slot via `onFreeSlot`, "wait for your monthly grant"); never quote web Stripe prices inside the iOS app (Apple IAP pricing differs — `paywall.tsx:50-51`).
- **Voice hygiene:** keep `LIVE_VOICE`/`VENUS_VOICE` = 'Kore' in sync (studio.tsx:55, say+api.ts:15); never set languageCode; half-duplex means she can't hear you while speaking (+250ms, live-voice.ts:381) — UI should show listening state honestly. `AudioSessionBusyError` modal generalizes to the sheet.

---

## 3. The Upsell System

**Where gate moments surface today (exact dead-ends):**
- Inline "not enough credits" notes, no paywall: `studio-composer.tsx:220, 245, 274` (video/model-shots/model-video), `:472/489` (shop-open plan gate); `scene-short-composer.tsx:135`; `go-live-composer.tsx:150` (domain); `design.tsx:292` and `components/designer/DesignEditor.tsx:75` ("Top up in Account").
- Already-routed-to-paywall: `studio.tsx:984-988` (createStore 402 → `setPaywall`), `account.tsx:592` (manage).
- Two distinct 402 shapes: `{error:'insufficient_credits', needed, balance}` from every debit route vs `{error:'subscription_required'|'brand_limit'|'upgrade_required', …}` from `store+api.ts:87-99`, `build-site+api.ts:21`, `go-live+api.ts:27`, `publish+api.ts:34`, `domain/buy+api.ts:28`. **Branch on `error`, not status.**

**Venus interception design:** add a central handler in `src/lib/api.ts` (where `ApiError` is thrown, lines 44-52): on 402, emit `venusEvents.gate402(body, attemptedAction)`. `VenusProvider` catches it, injects `sendContext`/chat-context ("creator just tried X, needs N, has B, tiers: …" from `/api/creator/subscription` + last-20 `credit_ledger` so she can say *where* credits went — "your Veo videos ate 800 this week"), opens the sheet half-height, and Venus makes the pitch conversationally, ending with the `open_paywall` tool → existing `<Paywall>` with the right `reason`. Pre-emptive version: since `CREDIT_COSTS` is client-served, Venus checks balance vs. intended cost *before* firing a tool (the pattern `studio-composer.tsx:262-265` already does locally). Purchase confirmation is asynchronous (activation happens in the platform-api webhook) — after browser/IAP return, re-fetch `/api/creator/credits` + `/api/creator/subscription` and let Venus acknowledge ("500 credits landed — shall we render that video?").

---

## 4. Stats Briefings

**Queryable today:** all-time orders count + revenueCents and views30d per store (`/api/creator/stats`), last-100 orders with `createdAt/totalCents/status` (`/api/creator/orders`), per-product margins (`/api/creator/margins`). **No units anywhere** — units live in `order_items.quantity` (schema.ts:372-382) and no endpoint touches them.

**Build:** `GET /api/creator/sales-series?bucket=day|week|month&storeSlug=&productId=` (new `src/app/api/creator/sales-series+api.ts`) — `date_trunc` over `orders.createdAt` (timestamptz) joined to `order_items`, filtered to paid+ statuses, returning `[{period, units, orders, revenueCents}]` plus a best-sellers rollup (`order_items → variants → products` — also missing today). Treat `shipped` as terminal (Printful v1 emits no delivery event — printful-webhook note); conversion is only derivable at day granularity (orders/day vs `page_views` daily counters).

**Conversation design:** on sheet open, the client fetches the earnings-cockpit trio (`earnings-cockpit.tsx:49-52` — whose line-12 comment literally says "Venus can speak a summary") + sales-series, compacts to a ~10-line digest, and injects it (sendContext or chat system block). "How's my store doing?" → she answers with the week-over-week delta, top seller, traffic vs conversion, and one actionable suggestion that maps to a tool ("the hoodie converts 3× the tee — want a scene video for it? 60 credits."). Proactive tier: a daily `/api/say` one-liner + push through `device_tokens` (schema.ts:516, built "for future order/sale alerts") — "you sold 3 units yesterday."

---

## 5. Phased Game Plan

**Phase 1 — The Sheet + Stats Venus (shippable MVP) — size M**
Build: `src/state/venus-provider.tsx`, `src/components/venus-sheet.tsx` (mount in `src/app/_layout.tsx` inside GestureHandlerRootView), new `src/app/api/venus/chat+api.ts` (gemini-2.5-flash, function-calling, read-only tools: stats/orders/margins/credits/subscription/sales-series + `navigate`), new `src/app/api/creator/sales-series+api.ts`, `src/lib/venus-tools.ts` (client executor for `navigate`/`open_paywall`). Avatar: `VenusBubble`. Voice: replies optionally spoken via existing `POST /api/say` (no Live session). Sheet defers to in-tab Venus via `isVenusLive()`.
**Demoable:** swipe down on any tab, type "how's my store doing this week," get real units/revenue numbers spoken in her voice, and "take me to the design tab" works.

**Phase 2 — One Venus (voice + memory unification) — size L**
Add `generalInstruction()` to `src/lib/live-voice.ts`; lift `useLiveVoice` into `VenusProvider`; mic button in the sheet starts Live with context packs via `sendContext`; re-point `studio.tsx:736` and `site-preview.tsx:203` at the shared session (modes as context pushes; preserve the buildReady cue and `venusContextForHit` flow); re-mint/reconnect for the 30-min cap; `venus_conversations` + `venus_memory` tables (both schema.ts mirrors) + `POST /api/venus/conversations`; centralize audio-mode arbitration (from studio.tsx:804-806).
**Demoable:** talk to Venus from anywhere; she remembers Tuesday's drop idea; walking into the console mid-conversation doesn't kill her.

**Phase 3 — Hands (ideation → creation) — size L**
Build `POST /api/venus/plan` (generalized `plan-site-edits`); wire action tools: `make_meme`/`generate_design` (`/api/generate` + `lib/meme.ts` → `/api/designs`), `create_drop` (`/api/catalogues`), `write_post`, the compose→mockup→publish chain with tap-confirmations; extend design deep-links (`/design?panel=&prompt=&action=generate`, touching `design.tsx:399-405` + GenerateModal prefill or lifting its state into a store).
**Demoable:** "let's do a Halloween drop" → three generated concepts in the sheet → "make the second one a meme" → design lands on the canvas in a new catalogue.
**In-flight intersection:** the site-diversity fonts and placeholder-image work both land in `designSystem` jsonb / `siteAssets` slots and the forge pipeline — keep the slot vocabulary in `src/lib/site-vocabulary.ts` and `site-assets+api.ts:13-20` as the single source Venus teaches from; placeholder-image improvements reduce how often critique-Venus must offer hero/logo generation, so re-check `critiqueInstruction`'s image-offer logic (live-voice.ts:57-70) after that lands.

**Phase 4 — Money (upsell + proactive) — size M**
Central 402 interceptor in `src/lib/api.ts`; replace the seven inline dead-ends (studio-composer.tsx:220/245/274/472/489, scene-short-composer.tsx:135, go-live-composer.tsx:150, design.tsx:292, DesignEditor.tsx:75) with the event; Venus pitch flows + `open_paywall`; pre-emptive cost checks; post-purchase re-fetch acknowledgment; daily `/api/say` + push briefings via `device_tokens`; Venus announces `revision_ready` pushes conversationally.
**Demoable:** run out of credits making a Veo video → Venus explains the ledger, offers the wan tier or a pack, opens the paywall, and thanks you when it lands.

**Phase 5 — Video + design-section control — size L**
Conversational video (`/api/video`, `/api/creator/scene-video` with model-tier cost talk, `model-shots`/`model-videos`); Venus-driven canvas operations (`canvas_nodes` — expose addNode/focusNode/group actions from `design.tsx:548-1046` through a store the executor can call); multi-step "content campaign" plans (design → product → post → promo video).
**Demoable:** "promote the best seller" → she checks sales-series, proposes a 9:16 scene video + announcement post, confirms 60cr, and runs it.

---

## 6. Risks

1. **Live-session economics & limits** — native-audio is the expensive path; 30-min cap, token uses:2, 20/user/min. Mitigation: text-lane default, idle auto-stop, reconnect handling before making voice ambient.
2. **Persona regression in the interview** — the buildReady latch (`studio.tsx:758-766`) keys on a regex over her cue phrase; a merged persona that phrases it differently silently breaks store creation. Keep the cue verbatim in `generalInstruction` and keep the 6-turn safety net.
3. **Native-audio tool flakiness** — resist the temptation to add functionDeclarations to Live; keep distill-then-execute (`/api/venus/plan`) as the voice action path or actions will randomly not fire.
4. **Audio-session and GL contention** — expo-audio vs react-native-audio-api arbitration must be centralized or the sheet + `/api/say` + Live mic will deadlock (`AudioSessionBusyError`); full R3F avatar in a persistent overlay risks GL context churn — VenusBubble only while collapsed.
5. **Gesture conflicts** — top-edge pan vs. iOS notification shade, ScrollViews, and the critique `PanResponder`; needs an activation offset and per-screen disable hooks.
6. **Two API stacks drifting** — stats/orders/beacon exist in both nanocrew and platform-api; Venus tooling must canonicalize on the Expo routes (`apiUrl()`), and `sales-series` should exist once.
7. **Upsell trust** — a consultant who pitches every session becomes a popup with a voice; the taste rules (one pitch/session, alternatives first, comp skip, iOS price rules) are product-critical, and Apple review will scrutinize any AI steering purchases outside IAP.
8. **Spend-by-conversation** — Venus triggering debits from voice mishears is a refund-and-trust problem; tap-confirm on every debit is non-negotiable, and the existing debit-refund-on-failure semantics must be verified for every tool she gets (note: `revision` cost is defined but never debited today — charging it later changes her critique-flow pitch).
9. **Memory privacy** — persisting general transcripts (not just brand interviews) stores personal chatter; scope `venus_memory` to brand-relevant facts and make conversations deletable.
10. **Transition-period double-Venus** — until Phase 2, the sheet and the in-tab embeds coexist; `isVenusLive()` gating must be airtight or two sessions will fight over the mic (the `activeLiveSession` teardown makes the failure mode "the interview dies mid-sentence," which looks like a crash to users).

---

## PIVOT + PHASE 1 SHIPPED (2026-07-05, same day)

Joe sharpened the vision: **Studio becomes the viewing space** (brand/site details, stats);
**Venus's steady state becomes the doing space** — the interview and site editing MOVE into her.
Interaction contract: **slide down from the top edge to ACTIVATE Venus, slide up to PAUSE her.**
Her tools: build brand · edit site · create designs · memes · **blog posts (+ scheduling — the
posts API has no scheduledAt yet; needs a column + a publisher tick)**.

SHIPPED (the steady-state MVP):
- `src/lib/venus-guide.ts` — her guidance brain: greeting + next-best-action from /api/me
  (no store → build; store not live → finalize; live → edit/create), max 4 chips.
- `src/components/venus-sheet.tsx` — the global top sheet (mounted in `_layout.tsx`):
  slide-down zone (RNGH pan) + `openVenusSheet()` + `__venusSheet(bool)` dev hook; VenusBubble
  avatar; tool chips route into the real flows — interview (`/studio?mode=interview`, new param
  handled in studio.tsx), console, and the DESIGN COMMAND BUS (`src/lib/design-bus.ts`:
  open-generate / ingest-design / show-design / open-editor — deep links `?action=generate
  &prompt=&meme=1`, `?edit=<id>` share the same path Venus will use).
- Verified live: personalized greeting from real store data; chips navigate and the generator
  opens prefilled. NEXT here: the chat lane (`/api/venus/chat`, function-calling) speaks
  through this same surface; then the interview/critique sessions re-point to the provider.


════════════════════════════════════════════════════════════════════════════════
# VENUS CENTRAL — REVISED: THE STATEFUL SURFACE (2026-07-05)

Supersedes the sheet-with-chips MVP in `docs/studio/VENUS_CENTRAL.md` (§2a + Phase 1 appendix). Everything below is grounded in the current code; line refs verified this session.

---

## 1. THE VENUS OVERLAY

**Mount tree** (`src/app/_layout.tsx` — today: `GestureHandlerRootView > AnimatedSplashOverlay + AppTabs + VenusSheet`):

```
GestureHandlerRootView
  <VenusProvider>            ← new, src/state/venus-provider.tsx — owns the ONE session + machine
    <AnimatedSplashOverlay/>
    <AppTabs/>               ← untouched; stays mounted BENEATH the overlay (tab state preserved)
    <VenusOverlay/>          ← refactor of src/components/venus-sheet.tsx → src/components/venus/venus-overlay.tsx
  </VenusProvider>
```

The overlay **covers, never replaces**: an absolute-fill `Animated.View`, opaque `#06080f` (the Lab bed, `venus-lab-screen.tsx` `styles.root`), `translateY` from `-winH` (hidden) → `0` (present). Reuse the sheet's proven bones verbatim: `ty` sharedValue + `withTiming(340ms, Easing.out(cubic))`, the `mounted` gate that unmounts content after slide-out (`venus-sheet.tsx:44-58`), `SHEET_EVENTS`/`openVenusSheet()` (rename `openVenus(state?, payload?)`), and the `__venusSheet` dev hook (rename `__venus`). Dismissing returns the user exactly where they were.

**GL context lifecycle** (the constellation is heavy — `venus-orb-scene.tsx`: ~880 somas + ~34k dendrite verts, R3F `<Canvas>` with no frameloop throttling, renders every frame while mounted):
- The R3F scene mounts **only while `mounted && stage needs it`** — the `mounted` gate already guarantees nothing GL exists while hidden. Never animate the Canvas itself during the slide; animate the flat backdrop.
- **Summon sequencing:** slide the opaque backdrop in immediately (cheap), then mount `<VenusAvatar stage="morphing">` from the `withTiming` completion callback (`runOnJS`) — her ~4.2s materialize (the `venusIntro` pattern, `studio.tsx:1049-1054`) visually absorbs expo-gl context-creation latency so the gesture never hitches. Dismiss: unmount the avatar first, then slide out.
- **One Venus GL context at a time, app-wide:** after the migration `studio.tsx` no longer mounts `VenusAvatar`; in *developing* state the overlay's full-bleed avatar unmounts and `VenusBubble` (site-preview panel, its own small GL disc) is her only embodiment; *home*/*design* mount the full avatar only. Enforce in `VenusOverlay` render logic, not by convention.
- Lip-sync is free everywhere: `pushSpeechChunk` (`live-voice.ts:446`) → `venus-speech-level.ts` → any mounted avatar.

**Handles — always visible** (new `src/components/venus/venus-handle.tsx`, one component, two placements):
- **Hidden → top handle:** a visible 44×5 pill + faint glow just under `insets.top`, rendered by `VenusOverlay` when un-mounted. Gesture: keep the sheet's `openPan` (`Gesture.Pan().activeOffsetY(12)`, fire on `translationY > 30 || velocityY > 500`, `venus-sheet.tsx:95-99`) attached to a strip containing the pill (`insets.top + 26`); the pill is the affordance, the strip the target. Hide the handle when `!session` (live voice needs a token) and while a legacy in-tab session owns the mic (`isVenusLive()` — `live-voice.ts:193`, still zero consumers; this is its first).
- **Present → bottom handle:** same pill above `insets.bottom` in a ~56px strip with `closePan` (`activeOffsetY(-12)`, `venus-sheet.tsx:100-104`) attached **to the strip only — not the whole overlay** (the sheet's whole-surface closePan would fight the WebView scroll in developing state and any future scrollables). Swipe up = pause + hide (see machine).

**Subtitles** (new `src/components/venus/venus-captions.tsx`): the caption text already exists in the live stack — `LiveVoiceSession` emits full per-turn utterances via `onUserTranscript`/`onVenusTranscript` (`live-voice.ts:104-105`, segmentation at 455-474), surfaced by `useLiveVoice` as `userText`/`venusText` (`use-live-voice.ts:85-87`). Render exactly the studio caption block (`studio.tsx:1318-1329`): dim `you > {userText}` (2 lines) over ink `{venusText}` (3 lines), sitting above the bottom handle. One component reused by every state so captions never jump.

**Chrome:** top = a thin `VENUS` wordmark + pause glyph (the Lab's top-bar idiom, `venus-lab-screen.tsx:159-170`). No chips, no buttons beyond contextual pills (Build, draft-post confirm). It looks like the Lab because it is the Lab's layout with captions instead of controls.

---

## 2. THE STATE MACHINE

```ts
// src/state/venus-provider.tsx
type VenusState = 'hidden' | 'home' | 'developing' | 'design';
// + paused: boolean inside present states (mic/audio muted via session.setMuted — live-voice.ts:225)
venusGo(next: VenusState, payload?: { storeSlug?; designId?; idea? })
```

The provider hosts the **one** `useLiveVoice` instance and exposes it via context; `hidden` **retains** machine state (`state`, payload, transcript), so re-summoning returns to the same state. Swipe-up = "pause": stop the socket (30-min cap + cost say don't idle it), keep the transcript; on re-summon reconnect and re-inject a distilled recap via `sendContext()` (`live-voice.ts:521` — silent, `turnComplete:false`). To the user it feels like pause; to the meter it's honest.

| State | Renders | Existing vs new |
|---|---|---|
| **home** | full-bleed `VenusAvatar` + captions + contextual pills (`InterviewTopics`, Pause, `✓ Build my brand`) → on brand: `BrandReview` | `src/components/venus/venus-home.tsx` — **the interview MOVED here** (see below) |
| **developing** | the existing critique UI full-screen under overlay chrome: WebView + pen + `VenusBubble` panel | **re-homed** `PreviewContent` (`site-preview.tsx:171`) — exported, given an injected-session prop |
| **design** | design image center-stage + `VenusBubble` + captions; voice edit loop | **new** `src/components/venus/venus-design.tsx` (§4) |

**Move vs. embed-by-navigation for the interview — weighed, decided: MOVE.**
- *Navigate* (what the sheet MVP does — `router.push('/studio?mode=interview')`, handled at `studio.tsx:611-619`): zero studio risk, but yields two Venus surfaces, two GL mounts, no handle inside studio, and it makes the overlay a launcher — precisely the "interface with buttons" Joe rejected.
- *Move*: one surface, one session, the handle contract holds everywhere; cost is studio surgery. **Chosen.** What moves into `venus-home.tsx` + the provider: the live wiring + state mirror (`studio.tsx:745-806`), the `buildReady` latch **with the cue regex verbatim** (`:767-775`, regex at `:773`), captions (`:1318-1329`), pause/finalize pills + `InterviewTopics` (`:1289-1316`), `ChatInterview` keyboard overlay (`:1349-1364` — keyboard mode survives, rendered inside the overlay), `BrandReview` + `createStore` + the `/api/say` fanfare (`:983-1026`, `:1221-1232`), `venusStageFor()` (`:73`) and the `venusIntro` timer. Mic permission request (`startVoice`, `:899-907`) fires on first summon instead of the primer. `Paywall` is an RN `Modal` — it renders above the overlay natively, so the 402 path (`:994-997`) works unchanged from inside home.
- **Lifecycle rule transplant:** the interview's "her view is on screen" rule (`studio.tsx:779-786`) becomes the overlay's: `state !== 'hidden' && appActive && (keyboardMode || !paused) → live.start()` else `stop()`. `AppState` tracking (`:792-796`) moves to the provider.

**studio.tsx afterwards — the details dashboard.** Keeps: signed-out "Meet Venus" CTA, `Welcome` modal + onboarding intents, `StudioDashboard`, `StudioComposer` console (posts/sell/settings + Review & Approve), `Paywall('manage')`, the `reviewSlug` push deep link (`:601-610`). Deletes: `mode==='interview'|'primer'`, the Nucleus/EntityState orb code, all live wiring, `ChatInterview`. Redirects: `?mode=interview` → `openVenus('home')`; the dashboard's "New brand" (`onNewBrand`) → `openVenus('home')` (the primer's checklist content becomes `InterviewTopics` inside home + one opening line from Venus).

**site-preview entry points after migration:** the composer's "tap to explore your live site" (`studio-composer.tsx:682`, sets `critiquePreview`) becomes `openVenus('developing', { slug })`; the `SitePreview` **Modal stays for review mode only** (`reviewRev` — Review & Approve deliberately has no Venus, `site-preview.tsx:610-624`). `PreviewContent` gets `venus?: UseLiveVoice` — when provided it skips its internal `useLiveVoice` + start/stop effect (`site-preview.tsx:203-233`) and uses the shared session; the circle-hit `sendContext` (`:312`) and the messages→`commitEdit` capture (`:369-378`) work unchanged against the injected session. `submit()` success → `onClose` → `venusGo('home')` + a `sendContext` nudge ("changes submitted — tell them the preview will be ready in Studio, ask what's next").

**Transitions:** voice intent (§3) moves home→developing/design; done/submit/keep returns home; "that's all for now" or swipe-up hides.

---

## 3. VOICE-INTENT ROUTING

**Mechanism: distill-then-execute, per committed user turn — never Live tool-calling** (native-audio can't, `live-voice.ts:5`, `extract-brand+api.ts:8-10`). Both lanes are used: a small classification call decides the transition; `sendContext` steers what she *says* after it.

- **New `src/app/api/venus/route+api.ts`** — clone the `extract-brand+api.ts` scaffold (`MODELS = ['gemini-2.5-flash','gemini-2.0-flash']` + `TRANSIENT` retry). Input: `{ turn, recent: last 6 messages, stores: [{name, slug, status, hasSite}], state, interviewActive }`. Output: `{ intent, storeSlug?, idea?, topic?, ask? }`.
- **Intent set:** `create-brand` · `edit-site{storeSlug?}` · `new-design{idea?}` · `write-post{storeSlug?, topic?}` · `done` · `none`. System prompt is **precision-biased**: "return `none` unless the utterance is clearly a task command."
- **Client wiring:** a provider effect watches `live.messages` growth (the `committedUsers` ref idiom, `site-preview.tsx:369-378`) and POSTs each new user turn — ~300ms flash call, non-blocking, home state only. On a hit: `venusGo(...)` + a `sendContext` steering parenthetical in the exact `CRITIQUE_GREETING` style (`live-voice.ts:73-74`) so her next line matches the new surface.
- **Disambiguation:** multiple matching stores → route returns `ask` ("which brand?"); client just `sendContext`s "(Ask whether they mean X or Y.)" — no client state; the follow-up turn re-routes with the answer present in `recent`.
- **Interview coexistence:** while `interviewActive` (no store yet / mid-interview), the router is instructed to switch only on explicit redirects ("actually, I want to edit my site instead"). The `buildReady` cue latch (`studio.tsx:773`) is untouched — it reads the same `live.messages`.
- **Critique coexistence:** in developing, per-turn routing is **off** — `isCloser()` (`site-preview.tsx:68-73`) plus a new local exit regex ("go home", "stop editing", "never mind") handle exits for free; `plan-site-edits` still distills at submit. In design state, turns go to the design-turn distiller (§4), not the router.
- **Persona:** systemInstruction is frozen at connect (`live-voice.ts:360`), so Phase B adds `venusCentralInstruction(userName, brands)` in `live-voice.ts` beside `liveSystemInstruction` — identical DELIVERY paragraph (Kore × british-robot), the interview module copied **verbatim including the "ready to build your brand" cue sentence**, plus a short task-switching section. Phase A ships with `liveSystemInstruction` untouched (home = interview only → zero regression risk). Escape hatch if one merged persona muddies her: reconnect-per-state with a distilled recap (token mint tolerates it; ~1.5s) behind a flag. Delete the dead `editSiteInstruction`/`EDIT_SITE_GREETING` (`live-voice.ts:44-53`) during this pass.

---

## 4. THE DESIGN STATE (new UI — hands-free iteration)

`src/components/venus/venus-design.tsx`: the current design large on the `#06080f` bed (expo-image `contain`, the `DesignEditor` stage look), `VenusBubble` beside the captions, busy shimmer + her "working on it" line during edits. **Not** the `DesignEditor` modal (that's the hands-on tool) — but the **same endpoint**, so behavior is identical.

- **Entry:** intent `new-design{idea}` → resolve catalogue: `GET /api/catalogues?store=<slug>` (the call design.tsx makes at `:1376`; POST creates one if none, `:1398`) → `POST /api/generate {prompt}` → `POST /api/designs {catalogueId, dataUrl|url, name}` (exact ingest contract from the bus handler, `design.tsx:1292-1331`) → display. No idea given → she asks one question first (still home), then transitions.
- **The voice edit loop:** each committed user turn → local closer check → **new `POST /api/venus/design-turn+api.ts`** (flash distill) → `{op:'edit', instruction, mode:'inpaint'|'text'|'remix'|'custom'} | {op:'new', prompt} | {op:'keep'} | {op:'discard'} | {op:'back'} | {op:'chat'}`.
  - `edit` → `POST /api/edit {designId: current, catalogueId, instruction, mode}` (the `DesignEditor.tsx:73-77` contract; 8cr, non-destructive new row per apply) → returned `{id, image}` becomes current; prior ids pushed on a local stack for `back`.
  - `keep` → `sendDesignCommand({kind:'show-design', designId})` — the bus **queues until the Design tab mounts** (`design-bus.ts:47-58`, flush at `design.tsx:1337-1346`), so the canvas/collection handoff is free — then `venusGo('home')`.
  - `discard` → `DELETE /api/designs/:id` (`design.tsx:772`) for each rejected iteration, revert to the prior stack entry.
- Every iteration is already persisted in the collection (that's what `/api/edit` does), so crash-safety is free and "it's in your collection" is always true. 402 on an edit → she states balance and points to Account (full paywall interception stays in the later money phase). Cost hygiene: she states "each tweak is 8 credits" once on entry.
- Deep links and the composer keep working unchanged — `?action=generate&prompt=&meme=1` / `?edit=<id>` and the overlay converge on the same bus + endpoints; one code path.

---

## 5. POSTS AT HOME

- **Voice drafting (home state, no new surface):** intent `write-post{storeSlug, topic}` → she gathers angle/points conversationally → exit cue ("write it up") → **new `POST /api/venus/draft-post+api.ts`** `{messages, storeSlug}` → `{title, excerpt, bodyMd}` (extract-brand scaffold) → a compact draft card in the overlay (title + excerpt + opening lines) with **tap** actions Publish / Save draft / Schedule — publishing is a tap-confirm, never a spoken "yes" → `POST /api/creator/posts {storeSlug, title, excerpt, bodyMd, publish}` (`posts+api.ts:25-58`).
- **Scheduling gap (scoped):** `store_posts` has only `isPublished`/`publishedAt`. Add `scheduledAt: timestamp` (schema + migration); accept it in POST/PATCH posts routes (stored with `publish:false`); new `src/app/api/internal/publish-due-posts+api.ts` (the `api/internal/` dir exists) guarded by an internal secret — flips `isPublished`+`publishedAt` for due rows, then fires `src/lib/storefront-revalidate.ts`. Trigger: external cron hitting the route (check whether platform-api already runs a scheduler before adding infra). That's the whole feature — no queue, no worker.

---

## 6. REVISED PHASES (sheet bones refactored, not discarded)

**Phase A — The Overlay + Home (interview inside) — L.** *The Phase-1 deliverable.*
Files: `src/state/venus-provider.tsx` (new — session, machine, AppState, lifecycle rule); `src/components/venus/venus-overlay.tsx` (refactor of `venus-sheet.tsx`: keep gestures/`mounted`/`openVenusSheet`→`openVenus`/dev hook; Lab-look full screen; GL mount sequencing); `venus-handle.tsx`, `venus-captions.tsx`, `venus-home.tsx` (new — interview moved from studio); `studio.tsx` surgery (dashboard-only + redirects); `venus-guide.ts` kept as her opening-context brain (greeting goes into the `sendContext` nudge, chips die).
**Demoable:** from any tab, pull the visible top handle — the constellation materializes full-screen exactly like the Lab; Kore speaks, live subtitles; run the whole interview → `✓ Build my brand` → `BrandReview` → store created, all inside the overlay; swipe the bottom handle mid-sentence — she pauses; pull down — she resumes where you were.

**Phase B — Intent router + Developing — M.**
Files: `api/venus/route+api.ts`; provider routing effect; `site-preview.tsx` (export `PreviewContent`, add injected `venus` prop, exit wiring); `studio-composer.tsx` entry swap (critique → `openVenus('developing')`; review-only Modal stays); `venusCentralInstruction()` in `live-voice.ts` (+ delete dead edit-site exports).
**Demoable:** "Venus, I want to edit this site" → her surface becomes the live storefront; circle + talk; Submit → she's home again announcing the preview.

**Phase C — Design state — M.**
Files: `venus-design.tsx`; `api/venus/design-turn+api.ts`; catalogue/generate/designs wiring; `show-design` bus + DELETE discard.
**Demoable:** hands-free end-to-end: "new design — a chrome skull tee" → image appears → "make the background a night sky" → iteration lands → "keep it" → home; open the Design tab, it's on the canvas.

**Phase D — Posts + scheduling — S/M.**
Files: `api/venus/draft-post+api.ts`; draft card in `venus-home.tsx`; schema `scheduledAt` + posts-route changes + `api/internal/publish-due-posts+api.ts`.
**Demoable:** draft a post by voice, schedule it for tomorrow 9am, it publishes and the site revalidates.

**Phase E — Money + stats (re-based, content unchanged from VENUS_CENTRAL §3-4).** The 402 interceptor now surfaces **through the overlay** (`openVenus('home')` + gate context); the stats digest becomes home-state opening context; `sales-series` as planned.

---

## 7. RISKS (this architecture)

1. **GL context churn** — summon/dismiss thrash creates/destroys expo-gl contexts; mitigations: `mounted` gate + mount-after-slide, debounce re-summon (<400ms), and consider keeping the context alive during brief pauses later. Never mount full avatar + `VenusBubble` simultaneously (developing = bubble only). The orb scene has **no frameloop throttling** — a hidden-but-mounted Canvas would burn GPU forever; the unmount rule is load-bearing.
2. **Gesture conflicts** — top handle vs. iOS notification-shade edge swipe (visible pill sits *below* `insets.top`; `activeOffsetY(12)` + velocity threshold already tuned); bottom handle vs. home-indicator swipe (strip sits above `insets.bottom`); closePan restricted to the strip or it steals WebView scroll and the pen `PanResponder` (`site-preview.tsx:255-297` claims at capture phase — untouched since it lives inside the web wrap).
3. **Session lifecycle across state switches** — one session must survive home→developing→design: the injected-`venus` prop must fully bypass `PreviewContent`'s internal start/stop or the `activeLiveSession` singleton teardown (`live-voice.ts:291-294`) kills her mid-sentence ("looks like a crash"). 30-min cap + `uses:2` token can expire mid-state → provider needs re-mint+reconnect with transcript recap. Frozen `systemInstruction` means state briefs ride `sendContext` only — if steering proves weak, the reconnect-per-state fallback exists.
4. **buildReady cue regression** — `venusCentralInstruction` must carry the "ready to build your brand" phrasing verbatim or the `studio.tsx:773` regex (now in venus-home) silently never unlocks Build; the 6-turn safety net stays.
5. **Studio migration blast radius** — `?mode=interview` deep link, Welcome/onboarding intents that previously `setMode('primer')`, `onFinishedBrand` dashboard refresh (`dashKey`), mic-permission prompt timing (now on first summon), and the signed-out flow (overlay handle hidden without a session) all need explicit re-wires; grep for `setMode(` before deleting modes.
6. **Double-Venus during transition** — until Phase B, the composer critique path still self-hosts a session; `isVenusLive()` gating on the top handle must be airtight or two sessions fight the mic.
7. **Audio-session arbitration** — the fanfare `setAudioModeAsync` switch (`studio.tsx:815`) and Live's `AudioManager` config (`live-voice.ts:315-320`) now both live behind the provider; keep the existing retry/`AudioSessionBusyError` path (busy modal moves into the overlay).
8. **Voice-triggered spend** — design edits (8cr) fire from distilled speech; mishears burn credits. Keep edits cheap-tier only by voice, tap-confirm anything ≥ 60cr, and keep the discard path (DELETE) one utterance away.

**Verify-before-build:** whether platform-api has a scheduler (Phase D trigger); the exact `siteUrl` source for `venusGo('developing')` (composer derives it — expose via `/api/me` or `stores/:slug`); web behavior (live voice is native-only — overlay should fall back to text lane or hide on web, as `site-preview` does with `IS_WEB`).
