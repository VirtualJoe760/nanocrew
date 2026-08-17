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

// The APP's backend (Cloud Run), for the few authed creator operations it alone owns — today just
// Stripe Connect payouts, whose account creation, onboarding links and refresh logic all live in
// src/lib/connect.ts. Reimplementing that in platform-api would mean two Connect integrations
// against one Stripe account, so the site calls the existing endpoint instead. It works from a
// browser because that backend answers `Allow-Origin: *` for GET and POST — which is also why
// anything needing DELETE or PATCH (collaborators, account) lives on platform-api instead.
export const APP_API_BASE = (process.env.NEXT_PUBLIC_APP_API_BASE ?? 'https://api.nanocrew.app').replace(/\/+$/, '');

export async function appApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${APP_API_BASE}${path.startsWith('/') ? path : `/${path}`}`, { ...init, headers });
}
