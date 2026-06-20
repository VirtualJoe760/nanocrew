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

// Thrown by readJson() on any non-2xx response. `message` carries the server's `error`
// field when present (or `Request failed (<status>)`), `status` the HTTP code, `body` the
// parsed payload (or the raw text when the body wasn't JSON, e.g. a 502 HTML page).
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

// Read a Response as JSON, guarding `res.ok`. The bare `await res.json()` pattern is a
// silent-failure trap: on a 5xx that returns a JSON error body it parses as "success"
// (so the caller sees an object with all fields undefined and quietly wipes its state),
// and on a 502 that returns an HTML page it throws a raw SyntaxError. This reads the body
// once as text, parses it safely, and throws an ApiError on any non-2xx — so callers'
// existing try/catch surfaces a real failure instead of swallowing it. Use this for the
// load/read path; keep manual `res.ok`/status handling where a route returns a meaningful
// non-2xx body the caller must inspect (402 credit gates, 409 conflicts, etc.).
export async function readJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, message, body);
  }
  return body as T;
}
