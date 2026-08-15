# Bug report — full-app test pass, 2026-08-14

Companion to [TEST_PLAN_2026-08-14.md](TEST_PLAN_2026-08-14.md). Env: iPhone 17 Pro sim (iOS 26.3),
Debug build @ main, Metro :8081 + `.env.local` (prod Supabase DB), account `claudetest@nanocrew.dev` (comp).

| ID | Sev | Area | Status | Summary |
|---|---|---|---|---|
| K1 | High | Account deletion | fixed + verified e2e | `DELETE /api/me` reads `SUPABASE_SERVICE_ROLE_KEY` (unset; env has `SUPABASE_SECRET_KEY`) → Supabase auth identity survives deletion; re-signup with the same email lands half-broken; data-deletion compliance incomplete. Fix: read `SUPABASE_SECRET_KEY` (or set both). |
| K2 | Med | Env/ops | open | Dev env runs LIVE Stripe keys; no test-mode environment exists. One dev-machine mistake = a real charge. Recommend a parallel Stripe test-mode env + test price ids. |
| K3 | Low | Tooling | open | `expo run:ios` mis-parses this Xcode's `devicectl` JSON → simulator targets misroute into the physical-device signing path ("No code signing certificates"). Workaround: `xcodebuild -destination 'platform=iOS Simulator,id=…'` + `simctl install` — do NOT pass `CODE_SIGNING_ALLOWED=NO` (it strips the keychain entitlement → `[expo-notifications] Keychain access failed` red toast at boot + broken session persistence; sim builds self-sign fine). |

## Details

*(entries appended as testing proceeds)*

### B1 · Med · FIXED · Eve intent router — "we sold out at the market last weekend" → `digest` (false positive)
- **Repro (deterministic, 3/3):** `POST /api/eve/route` `{turn:"we sold out at the market last weekend", stores:[…2 stores…], interviewActive:false}` → `{"intent":"digest"}`.
- **Expected:** `none` — the creator is sharing news, not asking for stats. The router's own contract is PRECISION over recall ("when in doubt → none"); a false positive yanks them out of conversation into the digest.
- **Likely cause:** the SYSTEM prompt's digest examples ("any sales?") pull sales-adjacent *statements* in. Suggest a counter-example in the prompt ("statements ABOUT sales that don't ask for numbers → none").
- Test: EVE-router battery, [route+api.ts:19](../../src/app/api/eve/route+api.ts).

### B2 · Med · FIXED · Eve intent router — interviewActive fails to suppress `new-design`
- **Repro (deterministic, 3/3):** `POST /api/eve/route` `{turn:"make me a design of a skull", interviewActive:true, recent:[Eve: "What products do you want to sell?"]}` → `{"intent":"new-design"}`.
- **Expected:** `none` — the prompt mandates that mid-interview, near-everything is interview content unless the utterance is an explicit redirect AWAY ("actually forget this…"). A design-shaped answer to "what products do you want to sell?" currently hijacks the interview into the design popup.
- **Suggest:** strengthen the interviewActive clause with this exact counter-example.

### B3 · Low · Web accessibility — interactive elements have no roles
- The welcome carousel's Next button, pager dots, plan cards, and Eve's send button render as bare `<div tabindex="0">` on web — no `role="button"`, no accessible names (`read_page` shows only `generic` nodes). Screen readers cannot operate the app on web. Fix: `accessibilityRole="button"` (+ labels) on Pressables — RN-web then emits proper roles.

### B4 · High (web) · FIXED · Eve could never connect in a browser — typed chat included
- **Symptom:** "Eve couldn't connect — tap to try again"; log stops at `B: createBufferQueueSource`; watchdog fails the session at 15s. Token minted fine.
- **Root cause:** `react-native-audio-api`'s web build has NO `createBufferQueueSource`/`AudioBufferQueueSourceNode` (native-only extension; zero references in `lib/module/web-core/` or `api.web.js`). `live.start()` threw before `ai.live.connect()` ever ran, so the socket never opened — web Eve was dead for voice AND keyboard mode.
- **Fix (shipped):** [live-voice.ts](../../src/lib/live-voice.ts) wraps the audio-out graph in try/catch → no queue = captions-only replies (all downstream uses were already null-guarded); `startMic` similarly armored so a missing/denied recorder can't kill the session. Verified in-browser: session connects, greeting streams, typed turns get streamed replies.
- **Residual (deferred to device testing):** her VOICE on web still needs a real playback path (web impl of the queue or a standard WebAudio fallback); current behavior on web is intentionally captions-only.

## Verified-pass log (browser + API pass, running)
- Welcome carousel WELC-1/2/4/5/8 (web); plan pricing math correct in the web/Stripe branch (monthly + annual).
- Auth: wrong-password error path; Apple button correctly absent on web; localStorage session restore.
- Account: comp → ADVANCED surfacing; fresh-account empty states; Eve Lab hidden for non-admin.
- Eve (web, post-B4-fix): connect → greeting → 3-turn typed interview → ✓ Build latch → extraction (on-brief palette/story) → template picker → store created `night-circuit` → forge site READY in ~3 min → storefront live at store-night-circuit.vercel.app (on-brand hero/logo/OG).
- Digest: real numbers (0 orders / $0 / 1 view — the view being my own storefront visit); status-aware suggestion; guide greeting is store-aware ("isn't live yet — shall we finalize?").
- Market (browser pass): Discover/Shop/Brands render real data; brand sheets theme per-brand (SL dark, Aether Run light); product detail (colors/sizes/desc/Buy) works in-sheet; checkout session creation verified to the boundary — 200 + checkout.stripe.com URL returned for a real variant, never opened (live keys). Buy-button synthetic press didn't fire in the pane (API path proven; re-verify tap on Simulator).
- API: auth battery 9/9; eve-route intent battery 17/17 post-fix; rate limiter 429s at 60/min; /api/idea, /api/say, /api/generate (design persisted for night-circuit); tenant scoping (non-member 404 vs owner 400-past-gate); K1 deletion e2e (auth identity 404 after DELETE /api/me).

### B5 · Med · Generated brand logo renders the name TWICE (+ transparency not applied)
- **Evidence:** night-circuit's logo (stores.logoUrl) reads "NIGHT" stacked over "Night Circuit" on a solid black tile with a stray white frame — this is the brand's face in the site header, OG card, and app.
- **Causes (verified):** (1) the prompt self-contradicted for dark brands — "Use ONLY these brand colors" (incl. black) vs "PURE MAGENTA background"; the model resolved it with a black backdrop, so `keyOutMagenta` correctly no-oped and the opaque tile shipped. Systematic for every dark-palette brand. (2) Image-model typesetting: "mostly wordmarks" makes it draw type, and it laid the name out twice with wobbly glyphs (the direction does NOT restate the name — earlier attribution corrected). (3) No quality gate before the image becomes the brand's face.
- **Fix (shipped + verified):** [store+api.ts](../../src/app/api/store+api.ts) prompt now scopes the palette to THE MARK, mandates the magenta backdrop "even if the brand palette is dark", name EXACTLY ONCE, no frame. Regenerated night-circuit's logo with the new prompt: clean single wordmark on true magenta → keyed to a 735×163 transparent PNG → uploaded → stores.logo_url updated.
- **Residuals for the report:** glyph precision (image models typeset imperfectly — recommend composing wordmark-style logos deterministically, as the OG card already does with Cloudinary text); add a cheap post-generation check (name-once + magenta-border) with one retry.

### B8 · Med · Logo changes don't propagate to the deployed site
- After updating `stores.logo_url`, store-night-circuit.vercel.app still serves the old Cloudinary asset — the logo is baked at forge build time, not read from the store API at runtime. A creator updating their logo sees no change on their site until some unrelated revision rebuilds it. Either read the logo live from the public store payload or trigger a site revision on logo change.

### B6 · Med · FIXED · Product picker collapses to a single column on 375pt screens
- **Evidence:** category + search grids rendered one card per row with a dead right half (web mobile viewport; would reproduce natively on iPhone SE/mini-class).
- **Cause:** `CARD = Math.round((width−2·16−16)/2)` → at width=375: round(163.5)=164 → row 344px > 343px available → every 2nd card wraps. 390pt+ devices don't hit it.
- **Fix (shipped, verified live):** `Math.floor` in [ProductPicker.tsx](../../src/components/designer/ProductPicker.tsx) — two columns confirmed in the browser at 375pt.

### B7 · Low · Notice toasts anchor over primary CTAs and swallow taps
- The "No microphone access" toast rendered on top of BrandReview's "Create my store" button; the CTA was untappable until the toast was dismissed. Anchor toasts above the CTA zone (or make them non-blocking / auto-dismiss).

### Cosmetic
- Product picker breadcrumb renders a trailing "›" after the last crumb.

### B9 · High · Storefront CTAs are invisible for dark-palette brands
- **Evidence:** night-circuit's hero "Shop the collection": computed `background: rgb(0,0,0)`, `color: rgb(18,18,18)` — ~1.02:1 contrast. Mechanism: the template button is `bg-primary text-background`, which assumes background contrasts with primary; every dark brand breaks it.
- **Fix (shipped, both repos):** brand.json now carries derived WCAG-AA `palette.onPrimary`/`onAccent` ([provision.ts](../../src/lib/provision.ts) + new [contrast.ts](../../src/lib/contrast.ts); STOREFRONT_ENGINE.md updated); all 5 templates consume them (`text-on-primary`) with a local luminance fallback for existing sites. Live sites pick colors up via the mini-CMS live-read once templates redeploy; night-circuit needs the template redeploy + revision.

### B5 addendum — recurrence evidence (4 most-recent brands before the fix)
- splift + quiet-grace: magenta INSIDE the mark (the key color — keying roulette); retro-dynasty: residual grey disc backdrop shipped; night-circuit: doubled name + black tile. Confirms single-shot generation with an unenforced contract. Shipped: backdrop validation gate + one retry in generateLogo ([store+api.ts](../../src/app/api/store+api.ts), `borderLooksMagenta` exported from [transparency.ts](../../src/lib/transparency.ts)). Recommended (report): compose wordmark logos deterministically with real fonts; add a cheap vision check (name-once) before shipping.

### B10 · Med · FIXED · Product search fails natural queries
- "oversized tee" → 0 results; "oversized" → 10. Cause: whole-phrase `name.includes(query)` — no tokenization, no synonyms ([ProductPicker.tsx](../../src/components/designer/ProductPicker.tsx)). Fixed with tokenized AND-matching + a small synonym map (tee→t-shirt, hoody→hoodie, …). Verified: "oversized tee" now returns 5. (Nit left as-is: "1 RESULTS" pluralization.)

### B11 · Med · Market product tiles open the BRAND sheet, not the product
- Every press handler in [market.tsx](../../src/app/market.tsx) calls `onOpen(item.storeSlug)` — product cards ("New this week" rows with name+price, hero product cards) discard the product id, so tapping "Quiet Horizon · $28.99" lands on Aether Run's landing sheet and the shopper must find the product again. `brand-store.tsx` already renders `ProductDetail`, so the fix is threading an optional productId through onOpen → sheet initial state.
