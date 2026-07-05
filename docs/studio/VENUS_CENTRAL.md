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
