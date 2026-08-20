# Dev Build Runbook (EAS)

Several features need a native module that can't run in Expo Go: **Apple IAP**, **push
notifications**, and **critique screenshots** (`react-native-view-shot`). All the native deps are
now **installed** (so the project requires a dev/standalone build, not Expo Go); each light up once
you ship a build that bundles them. The critique-screenshot capture is guarded — without the module
it falls back to the forge's server-side stroke re-render, so it degrades rather than crashing.

`eas.json` (build profiles) and the iOS `bundleIdentifier` (`com.nanocrew.app`) are already in.
Change the bundle id **before** your first build if you want a different one — it ties to the App
Store app and is painful to change later.

## 0. One-time
```bash
npx expo install expo-dev-client   # REQUIRED — eas build refuses a dev-client build without it
npm i -D eas-cli           # or: npm i -g eas-cli
npx eas login              # your Expo account
npx eas build:configure    # links the project (creates the EAS project id)
```

## 1. Install the native deps + config plugins
```bash
npx expo install expo-notifications react-native-iap react-native-view-shot
```
The notifications plugin is in `app.json` → `expo.plugins` as a bare `"expo-notifications"` entry —
no icon config (Android falls back to the default notification icon; add
`["expo-notifications", { "icon": … }]` later if we ship a dedicated notification glyph).
`react-native-iap` and `react-native-view-shot` are autolinked (no plugin entry needed).

## 2. Push notifications — WIRED
The server side is done (`device_tokens`, `/api/creator/push-token`, `notify.ts` delivery) and so is
the client: `src/lib/push.ts` ships `PUSH_ENABLED = true` and a full `registerForPush()` (permission
request + `getExpoPushTokenAsync` with the EAS `projectId`), and `use-auth` calls
`registerForPush(session.access_token)` on every session (best-effort; no-op on web / Expo Go).
**APNs:** Push Notifications is enabled for `com.nanocrew.app`; EAS manages the key during
`eas build`.

## 3. Apple IAP — StoreKit 2 (shipped)
**`react-native-iap` (v15) is now installed** and the IAP path is wired end-to-end on **StoreKit 2**:
- **Server:** `/api/creator/billing/iap-verify` verifies via the **App Store Server API**
  (`src/lib/app-store.ts` signs an ES256 JWT with `node:crypto` and pulls the signed transaction
  from Apple — prod→sandbox fallback for pre-release apps). **Not legacy verifyReceipt.** The client
  sends a `transactionId` (with `appAccountToken` = creator id); credit packs grant credits, plan
  products activate the subscription + first month, idempotent on the transactionId.
- **Client:** `src/lib/iap.ios.ts` (react-native-iap) + the paywall prefer IAP on iOS, with web
  Stripe as the fallback. Products are in `src/lib/iap-products.ts` — credit-pack **consumables**
  `com.nanocrew.credits.{500,1500,5000}` **and** plan **subscriptions**
  `com.nanocrew.plan.{starter,pro,advanced}`.
- **Config:** create those products in App Store Connect (IAP prices ~43% over web — or 15% on the
  Small Business Program — to absorb Apple's cut) + an In-App Purchase API key, then set
  `APPLE_IAP_KEY_ID / APPLE_IAP_ISSUER_ID / APPLE_IAP_PRIVATE_KEY / APPLE_BUNDLE_ID` on Cloud Run. IAP
  stays dormant (web Stripe) until those exist.

## 4. Critique screenshots — WIRED (needs a build with the native module)
In `src/components/site-preview.tsx` the critique editor captures the WebView+overlay (page + the
creator's mark) with `captureRef` (`react-native-view-shot` 4.0.3) the instant a mark lands, sends the
data-URIs in the `revise` call's `annotations[].shots`; `/api/creator/revise` hosts them on Cloudinary
→ `annotations[].shotUrls`; the droplet worker downloads those into `briefs/screenshots/` and Claude
reads the real marked-up image. `captureRef` is guarded — on a build WITHOUT the native module it
throws synchronously and we fall back to the worker's stroke re-render, so circling never crashes.
See `docs/storefront/IMAGE_TARGETS.md`.

## 5. Build + run
```bash
npx eas build --profile development --platform ios          # SIMULATOR build
npx eas build --profile development-device --platform ios   # a real DEVICE (ad-hoc; needs the
                                                            # device registered on the Apple team)
# install the resulting build, then:
npm start            # Metro serves JS into the dev client (not Expo Go)
```
For TestFlight/App Store: `--profile production` then `npx eas submit -p ios`.

## App Store submission also needs
App icon (✅ done — `assets/images/icon.png`, NC mark) + screenshots + privacy nutrition labels + age
rating; **Apple Sign In** provider in Supabase (button is built); Privacy Policy + Terms URLs (live at
nanocrew.app/privacy + /terms); the account-deletion path (built); iOS usage strings (✅ added to
app.json: mic + photo library).

---

# Production / TestFlight runbook

Goal: a real iOS build testers install via TestFlight. **The app talks to its own `+api.ts` server
routes**, so those must be DEPLOYED and the build pointed at them — otherwise the app has no backend.

### 0. One-time prerequisites (Joe)
- **Apple Developer Program** ($99/yr) + an App Store Connect app record for `com.nanocrew.app`.
- `eas init` to link the repo to an Expo project — ✅ done (`extra.eas.projectId` is in `app.json`;
  builds/submits ship routinely through it).
- Apple Sign In enabled in Supabase Auth (the button exists).

### 1. Deploy the app's server routes → get a production API URL
The `src/app/**+api.ts` routes only run on Metro in dev. In production they run on **Google Cloud
Run** (persistent Node via `expo serve` — **NOT** EAS Hosting; a persistent server is required for
the postgres-js pool):
```bash
./scripts/deploy-cloudrun.sh nanocrew-api us-west1 backend   # Cloud Build from source; no local Docker
```
Then set that URL as **`EXPO_PUBLIC_API_URL`** (an EAS env var / `.env`), so `apiUrl()` (src/lib/api.ts)
targets it in the build instead of the Metro host — the service answers at `api.nanocrew.app`. The
server also needs all the runtime env the app uses (SUPABASE_*, STRIPE_*, PRINTFUL_*,
GOOGLE_GENAI_API_KEY, FAL_KEY, VERCEL_TOKEN, DOMAIN_CONTACT_*, GITHUB_*, PLATFORM_API_BASE,
INTERNAL_API_KEY) — the deploy script uploads them from `.env.local` as runtime env vars.

### 2. Build
```bash
npx eas build --profile preview --platform ios     # internal-distribution .ipa (or --profile production)
```

### 3. Submit to App Store Connect
```bash
npx eas submit --platform ios --profile production  # uploads the build to App Store Connect
```

### 4. TestFlight
- **Internal testing** (≤100 testers, no review, instant): add testers in App Store Connect →
  TestFlight → Internal Group. Fastest for feedback.
- **External testing** (≤10,000, needs a brief Beta App Review): add a public link or emails.
- Testers install the **TestFlight** app + accept the invite.

Notes: **push** (`PUSH_ENABLED=true`), **IAP** (StoreKit 2, `react-native-iap` v15), and
**view-shot** (critique screenshots, `react-native-view-shot` 4.0.3) now all ship in the binary; IAP
stays dormant until the `APPLE_IAP_*` env + App Store Connect products exist, and view-shot capture
falls back to the forge stroke-render if a given build predates the module.
