# Bug report — full-app test pass, 2026-08-14

Companion to [TEST_PLAN_2026-08-14.md](TEST_PLAN_2026-08-14.md). Env: iPhone 17 Pro sim (iOS 26.3),
Debug build @ main, Metro :8081 + `.env.local` (prod Supabase DB), account `claudetest@nanocrew.dev` (comp).

| ID | Sev | Area | Status | Summary |
|---|---|---|---|---|
| K1 | High | Account deletion | open | `DELETE /api/me` reads `SUPABASE_SERVICE_ROLE_KEY` (unset; env has `SUPABASE_SECRET_KEY`) → Supabase auth identity survives deletion; re-signup with the same email lands half-broken; data-deletion compliance incomplete. Fix: read `SUPABASE_SECRET_KEY` (or set both). |
| K2 | Med | Env/ops | open | Dev env runs LIVE Stripe keys; no test-mode environment exists. One dev-machine mistake = a real charge. Recommend a parallel Stripe test-mode env + test price ids. |
| K3 | Low | Tooling | open | `expo run:ios` mis-parses this Xcode's `devicectl` JSON → simulator targets misroute into the physical-device signing path ("No code signing certificates"). Workaround: `xcodebuild -destination 'platform=iOS Simulator,id=…'` + `simctl install`. |

## Details

*(entries appended as testing proceeds)*

### B1 · Med · Eve intent router — "we sold out at the market last weekend" → `digest` (false positive)
- **Repro (deterministic, 3/3):** `POST /api/eve/route` `{turn:"we sold out at the market last weekend", stores:[…2 stores…], interviewActive:false}` → `{"intent":"digest"}`.
- **Expected:** `none` — the creator is sharing news, not asking for stats. The router's own contract is PRECISION over recall ("when in doubt → none"); a false positive yanks them out of conversation into the digest.
- **Likely cause:** the SYSTEM prompt's digest examples ("any sales?") pull sales-adjacent *statements* in. Suggest a counter-example in the prompt ("statements ABOUT sales that don't ask for numbers → none").
- Test: EVE-router battery, [route+api.ts:19](../../src/app/api/eve/route+api.ts).

### B2 · Med · Eve intent router — interviewActive fails to suppress `new-design`
- **Repro (deterministic, 3/3):** `POST /api/eve/route` `{turn:"make me a design of a skull", interviewActive:true, recent:[Eve: "What products do you want to sell?"]}` → `{"intent":"new-design"}`.
- **Expected:** `none` — the prompt mandates that mid-interview, near-everything is interview content unless the utterance is an explicit redirect AWAY ("actually forget this…"). A design-shaped answer to "what products do you want to sell?" currently hijacks the interview into the design popup.
- **Suggest:** strengthen the interviewActive clause with this exact counter-example.
