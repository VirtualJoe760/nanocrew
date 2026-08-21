import { useSyncExternalStore } from 'react';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import { registerForPush } from '@/lib/push';

// ONE session, shared by every caller.
//
// This used to be a plain hook with its own useState, so each of the ~10 components that call it
// got an INDEPENDENT copy: 10 × getSession(), 10 × onAuthStateChange subscriptions, and — because
// the push effect lived here too — 10 × registerForPush() on sign-in, each of which can raise the
// OS notification prompt and POST a token. Worse for the creator: each copy resolved on its own
// tick, so at launch and at sign-in the screens flipped from signed-out to signed-in at slightly
// different moments — the flicker Joe reported (2026-08-20).
//
// Now a module-level store does the work once and every subscriber re-renders on the SAME tick
// (useSyncExternalStore), so the whole app changes state together. The hook's shape is unchanged.

type AuthState = { session: Session | null; loading: boolean };

let state: AuthState = { session: null, loading: true };
const listeners = new Set<() => void>();
let started = false;
/** The user id we last registered a push token for — the registration is per identity, not per
 *  component, and re-registering on every token refresh is pure noise. */
let pushedFor: string | null = null;

function emit() {
  for (const l of listeners) l();
}

function set(next: AuthState) {
  // Referential stability matters: useSyncExternalStore re-renders whenever the snapshot changes
  // identity, so only publish a genuinely new state.
  if (next.session === state.session && next.loading === state.loading) return;
  state = next;
  emit();
}

function syncPush(session: Session | null) {
  const uid = session?.user?.id ?? null;
  if (!uid || uid === pushedFor || !session?.access_token) return;
  pushedFor = uid;
  void registerForPush(session.access_token);
}

/** Start the single session subscription. Idempotent — the first hook call wins. */
function start() {
  if (started) return;
  started = true;
  supabase.auth
    .getSession()
    .then(({ data }) => {
      set({ session: data.session, loading: false });
      syncPush(data.session);
    })
    .catch(() => set({ session: null, loading: false }));
  supabase.auth.onAuthStateChange((_event, s) => {
    set({ session: s, loading: false });
    if (!s) pushedFor = null; // signed out — the next sign-in registers again
    else syncPush(s);
  });
}

function subscribe(onChange: () => void): () => void {
  start();
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

const getSnapshot = () => state;

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
