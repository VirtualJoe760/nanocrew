import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';

import { apiUrl } from '@/lib/api';

// Client push-registration. expo-notifications is installed; minting a remote Expo push
// token needs a dev/production build (not Expo Go) — fine, since we ship via EAS now. The
// server side (device_tokens, /api/creator/push-token, notify.ts delivery) is live.
// expo-notifications has a web shim, so it's web/server-export safe.
const PUSH_ENABLED = true;

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

/** Ask for permission, mint an Expo push token, and register it with the backend.
 *  Best-effort: silently no-ops on web, in Expo Go, or if the user declines. */
export async function registerForPush(authToken: string): Promise<void> {
  if (!PUSH_ENABLED || Platform.OS === 'web') return;
  try {
    const Notifications = await import('expo-notifications');
    const existing = await Notifications.getPermissionsAsync();
    const status =
      existing.status === 'granted' ? 'granted' : (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    const projectId =
      (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ??
      (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    if (token) await registerPushToken(token, authToken, Platform.OS);
  } catch {
    /* push is best-effort — never block the app on it */
  }
}

/** Deep-link a tapped "changes ready" push straight to that store's Edit/review in Studio.
 *  Handles both a cold start (app launched from the tap) and warm taps. Returns a cleanup. */
export function attachReviewDeepLink(): () => void {
  if (Platform.OS === 'web') return () => {};
  let sub: { remove: () => void } | undefined;
  let cancelled = false;
  (async () => {
    try {
      const Notifications = await import('expo-notifications');
      const route = (data: unknown) => {
        const d = data as { kind?: string; slug?: string; name?: string } | null;
        if (d?.kind === 'revision_ready' && d.slug) {
          router.navigate({ pathname: '/studio', params: { reviewSlug: String(d.slug), reviewName: String(d.name ?? '') } });
        }
      };
      const last = await Notifications.getLastNotificationResponseAsync();
      if (!cancelled && last) route(last.notification.request.content.data);
      sub = Notifications.addNotificationResponseReceivedListener((resp) => route(resp.notification.request.content.data));
    } catch {
      /* best-effort */
    }
  })();
  return () => { cancelled = true; sub?.remove(); };
}
