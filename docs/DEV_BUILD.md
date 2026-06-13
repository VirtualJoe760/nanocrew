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

## 3. Apple IAP — wire StoreKit
Server verify is done (`/api/creator/billing/iap-verify`, set `APPLE_IAP_SHARED_SECRET`). In
`src/lib/iap.ts`: set `IAP_ENABLED = true` and implement `buyCreditsIap` with `react-native-iap`
(`initConnection` → `requestPurchase({ sku })` → `getReceiptIOS()` → POST to the verify endpoint →
`finishTransaction`). Create the **consumable** products in App Store Connect matching the ids in
`src/lib/iap-products.ts` (`com.nanocrew.credits.500/1500/5000`). Route the Paywall's credit packs
through IAP when `iapAvailable()` (iOS), Stripe on web.

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
App icon + screenshots + privacy nutrition labels + age rating; **Apple Sign In** provider in
Supabase (button is built); Privacy Policy + Terms URLs; the account-deletion path (built).
