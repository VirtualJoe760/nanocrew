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
- API: auth battery 9/9; eve-route intent battery 17/17 post-fix; rate limiter 429s at 60/min; /api/idea, /api/say, /api/generate (design persisted for night-circuit); tenant scoping (non-member 404 vs owner 400-past-gate); K1 deletion e2e (auth identity 404 after DELETE /api/me).
