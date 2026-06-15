import { makeRedirectUri } from 'expo-auth-session';
import { getQueryParams } from 'expo-auth-session/build/QueryParams';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// Social sign-in (Apple/Google/Facebook) through Supabase. Google/Facebook run the web OAuth
// flow in an auth-session browser and hand the callback tokens to supabase-js ourselves; on web
// Supabase's normal full-page redirect does the work. APPLE on iOS uses the NATIVE
// "Sign in with Apple" sheet (expo-apple-authentication) and verifies the identity token via
// signInWithIdToken — no client secret to configure or expire. The Supabase Apple provider only
// needs the bundle id (com.nanocrew.app) in its Client IDs. expo-apple-authentication is a
// dev-build-only native module, so we lazy-require it (exactly like the IAP/push seams): until
// the dev build bundles it, native Apple throws a clear message and the other providers work.

WebBrowser.maybeCompleteAuthSession();

export type OAuthProvider = 'apple' | 'google' | 'facebook';

// In Expo Go this is exp://<host>/--/auth; in a dev/standalone build nanocrew://auth.
// Both (plus the web origin) must be allow-listed in Supabase → Auth → Redirect URLs.
const redirectTo = makeRedirectUri({ path: 'auth' });

async function createSessionFromUrl(url: string): Promise<void> {
  const { params, errorCode } = getQueryParams(url);
  if (errorCode) throw new Error(errorCode);
  if (params.error_description) throw new Error(params.error_description);
  if (params.code) {
    // PKCE flow — exchange the one-time code.
    const { error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) throw error;
    return;
  }
  const { access_token: accessToken, refresh_token: refreshToken } = params;
  if (!accessToken || !refreshToken) throw new Error('No session in callback');
  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw error;
}

/**
 * Native Sign in with Apple (iOS). Presents Apple's system sheet and exchanges the returned
 * identity token for a Supabase session. expo-apple-authentication is a dev-build-only native
 * module — we lazy-require it so a missing module can't break Metro/Expo Go; until the dev
 * build bundles it, this throws a friendly message and the user can fall back to email/Google.
 */
async function signInWithAppleNative(): Promise<void> {
  let AppleAuthentication: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AppleAuthentication = require('expo-apple-authentication');
  } catch {
    throw new Error('Apple sign-in needs the latest app update. Use email or Google for now.');
  }
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });
  if (!credential.identityToken) throw new Error('No identity token returned from Apple');
  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  if (error) throw error;
}

/** Run the OAuth flow. Resolves once signed in; throws on failure or user cancel. */
export async function signInWithProvider(provider: OAuthProvider): Promise<void> {
  if (Platform.OS === 'web') {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
    return; // the page redirects away
  }

  // iOS Apple → native sheet (no client secret, best UX, App Store 4.8 compliant).
  if (provider === 'apple' && Platform.OS === 'ios') {
    return signInWithAppleNative();
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error('No auth URL returned');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') throw new Error('Sign-in cancelled');
  await createSessionFromUrl(result.url);
}
