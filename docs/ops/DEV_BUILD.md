# Dev Build Runbook (EAS)

Three features are built end-to-end **except** their native module, which can't run in Expo Go:
**Apple IAP**, **push notifications**, and **critique screenshots**. They all light up with one
dev build. Until you run this, keep using Expo Go (don't install the native deps below, or Expo
Go bundling breaks).

`eas.json` (build profiles) and the iOS `bundleIdentifier` (`com.nanocrew.app`) are already in.
Change the bundle id **before** your first build if you want a different one — it ties to the App
Store app and is painful to change later.

## 0. One-time
```bash
npm i -D eas-cli           # or: npm i -g eas-cli
npx eas login              # your Expo account
npx eas build:configure    # links the project (creates the EAS project id)
```

## 1. Install the native deps + config plugins
```bash
npx expo install expo-notifications react-native-iap react-native-view-shot
```
Add the notifications plugin to `app.json` → `expo.plugins`:
```json
["expo-notifications", { "icon": "./assets/images/notification-icon.png" }]
```
`react-native-iap` and `react-native-view-shot` are autolinked (no plugin entry needed).

## 2. Push notifications — wire the token
The server side is done (`device_tokens`, `/api/creator/push-token`, `notify.ts` delivery). In
`src/lib/push.ts`: set `PUSH_ENABLED = true` and fill `registerForPush()`:
```ts
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
const { status } = await Notifications.requestPermissionsAsync();
if (status !== 'granted') return;
const { data: token } = await Notifications.getExpoPushTokenAsync();   // needs the dev build
await registerPushToken(token, authToken, Platform.OS);
```
Call `registerForPush(session.access_token)` after sign-in (e.g. in `account.tsx`/`use-auth`).
**APNs:** in the Apple Developer portal enable Push Notifications for `com.nanocrew.app`; EAS
manages the key during `eas build`.

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
  `APPLE_IAP_KEY_ID / APPLE_IAP_ISSUER_ID / APPLE_IAP_PRIVATE_KEY / APPLE_BUNDLE_ID` on Railway. IAP
  stays dormant (web Stripe) until those exist.

## 4. Critique screenshots
In `src/components/site-preview.tsx` (critique `send()`): capture the WebView+overlay with
`captureRef` (react-native-view-shot) → upload via `/api/creator/upload` → pass the URL in the
`revise` call's `screenshots[]`. The forge already downloads those into `briefs/screenshots/` and
tells Claude to look at them.

## 5. Build + run
```bash
npx eas build --profile development --platform ios   # simulator build
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
- `eas init` to link the repo to an Expo project (writes `extra.eas.projectId`). Not linked yet.
- Apple Sign In enabled in Supabase Auth (the button exists).

### 1. Deploy the app's server routes → get a production API URL
The `src/app/**+api.ts` routes only run on Metro in dev. Deploy them to EAS Hosting:
```bash
npx eas deploy            # publishes the Expo Router server output → a https://…expo.app URL
```
Then set that URL as **`EXPO_PUBLIC_API_URL`** (an EAS env var / `.env`), so `apiUrl()` (src/lib/api.ts)
targets it in the build instead of the Metro host. The server also needs all the runtime env the app
uses (SUPABASE_*, STRIPE_*, PRINTFUL_*, GOOGLE_GENAI_API_KEY, FAL_KEY, VERCEL_TOKEN, DOMAIN_CONTACT_*,
GITHUB_*, PLATFORM_API_BASE, INTERNAL_API_KEY) configured on EAS Hosting.

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

Notes: **push** (`PUSH_ENABLED=true`) and **IAP** (StoreKit 2, `react-native-iap` v15) now ship in
the binary; IAP stays dormant until the `APPLE_IAP_*` env + App Store Connect products exist.
**view-shot** (critique screenshots) is still off and not installed.
