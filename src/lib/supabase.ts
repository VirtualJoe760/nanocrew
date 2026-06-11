import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

// Client-side Supabase (auth only — data goes through our API routes). The publishable
// key is safe to ship in the bundle.
//
// SSR guard: the web build server-renders pages (web.output: "server"), where `window`
// doesn't exist — AsyncStorage must only load on an actual client (native or browser).
const isServer = typeof window === 'undefined';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const storage = isServer
  ? undefined
  : (require('@react-native-async-storage/async-storage').default as never);

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

export const supabase = createClient(url, key, {
  auth: {
    storage,
    autoRefreshToken: !isServer,
    persistSession: !isServer,
    // Web OAuth comes back as a full-page redirect with tokens in the URL — let
    // supabase-js pick them up there. On native we parse the callback ourselves.
    detectSessionInUrl: Platform.OS === 'web' && !isServer,
  },
});
