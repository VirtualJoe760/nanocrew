'use client';

import { supabase } from './supabase';

// apiFetch for the WEB — the sibling of the app's src/lib/api.ts.
//
// The architecture is deliberate and identical on both clients: the site/app renders, platform-api
// owns the database, Stripe, Resend and auth. Neither client holds a server secret; both attach a
// Supabase bearer and talk to the API over HTTP. Until now the site only ever made ANONYMOUS calls
// (public catalogue, guest checkout) — this is the piece that lets a signed-in creator act on the
// web, and every future authenticated web surface (billing, payouts, account) should use it.
//
// NEXT_PUBLIC_API_BASE points at platform.nanocrew.app (the API on our own domain). The legacy
// vercel.app host still works, so the fallback is harmless if the env is ever missing.
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? 'https://platform.nanocrew.app').replace(/\/+$/, '');

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`, { ...init, headers });
}
