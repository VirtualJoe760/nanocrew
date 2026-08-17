'use client';

import { createClient } from '@supabase/supabase-js';

// Browser-side Supabase for the SITE — auth only, exactly like the app (src/lib/supabase.ts).
// Data never comes from here: every read/write goes through platform-api over HTTP (lib/api.ts),
// which is the same contract the app has with its own backend. The site holds no DB credential.
//
// The publishable key is public by design — it ships in the app bundle too, and RLS is deny-all.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // OAuth returns as a full-page redirect with tokens in the URL hash; supabase-js picks them
    // up and clears them, so tokens never linger in the address bar or history.
    detectSessionInUrl: true,
  },
});
