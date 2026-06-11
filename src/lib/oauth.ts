import { makeRedirectUri } from 'expo-auth-session';
import { getQueryParams } from 'expo-auth-session/build/QueryParams';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// Social sign-in (Google/Facebook) through Supabase OAuth. On native we run the flow in
// an auth session browser and hand the callback tokens to supabase-js ourselves; on web
// Supabase's normal full-page redirect does the work.

WebBrowser.maybeCompleteAuthSession();

export type OAuthProvider = 'google' | 'facebook';

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
