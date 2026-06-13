import Constants from 'expo-constants';

import { supabase } from '@/lib/supabase';

// On a physical device, relative /api/* URLs don't resolve — point them at the Metro
// dev server host. On web they pass through unchanged.
export function apiUrl(path: string): string {
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
