import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// Resolve an /api/* path to a full URL:
//  - web: a BARE path. The web bundle is always served same-origin with its API (prod: the Expo
//    server on Railway; dev: Metro on :8081), so a relative path hits the right backend and avoids
//    cross-origin CORS to EXPO_PUBLIC_API_URL (which targets the native build's remote backend).
//  - native production builds: EXPO_PUBLIC_API_URL (the deployed Expo Router server, set at build time)
//  - native dev on a device: the Metro dev-server host
// Without EXPO_PUBLIC_API_URL a native release build has no backend, so it must be set before `eas build`.
export function apiUrl(path: string): string {
  if (Platform.OS === 'web') return path;
  const base = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
  if (base) return `${base}${path}`;
  const host = Constants.expoConfig?.hostUri;
  return host ? `http://${host}${path}` : path;
}

// Authenticated fetch — attaches the current Supabase bearer token so server routes can
// scope to the signed-in creator. Use this for any /api/* call that touches creator data.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(apiUrl(path), { ...init, headers });
}
