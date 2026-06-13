import { apiUrl } from '@/lib/api';

// Client push-registration seam. expo-notifications is NOT installed yet, and minting a
// remote Expo push token requires a dev/production build (Expo Go can't as of SDK 53+) —
// so registration is deferred, exactly like the IAP seam. The server side (the
// device_tokens table, /api/creator/push-token, and notify.ts delivery) is already live.
//
// To turn this on:
//   1. `npx expo install expo-notifications` (+ the config plugin) and make a dev build,
//   2. flip PUSH_ENABLED and fill registerForPush() with the StoreKit-style permission +
//      getExpoPushTokenAsync() calls — we deliberately don't `require('expo-notifications')`
//      here so a missing module can't break Metro.
const PUSH_ENABLED = false;

/** Register an already-minted Expo push token with the backend. */
export async function registerPushToken(token: string, authToken: string, platform?: string): Promise<boolean> {
  try {
    const res = await fetch(apiUrl('/api/creator/push-token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ token, platform }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Ask for permission, mint a token, and register it. No-op until the dev build wiring. */
export async function registerForPush(authToken: string): Promise<void> {
  if (!PUSH_ENABLED) return;
  void authToken;
  // TODO (needs expo-notifications + dev build):
  //   const Notifications = require('expo-notifications');
  //   const { status } = await Notifications.requestPermissionsAsync();
  //   if (status !== 'granted') return;
  //   const { data: token } = await Notifications.getExpoPushTokenAsync();
  //   await registerPushToken(token, authToken, Platform.OS);
}
