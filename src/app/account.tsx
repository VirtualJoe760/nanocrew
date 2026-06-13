import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { apiUrl } from '@/lib/api';
import { signInWithProvider, type OAuthProvider } from '@/lib/oauth';
import { supabase } from '@/lib/supabase';

// Billing lives on the web portal (Stripe) — never in the app (Apple IAP avoidance).
const BILLING_URL = 'https://nanocrew.app/account';

type StoreRow = { id: string; name: string; slug: string; status: string };

export default function AccountScreen() {
  const theme = useTheme();
  const { session, loading } = useAuth();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stores, setStores] = useState<StoreRow[]>([]);

  // Ensure the creators row exists + load this creator's stores.
  useEffect(() => {
    if (!session) {
      setStores([]);
      return;
    }
    fetch(apiUrl('/api/me'), {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((d: { stores?: StoreRow[] }) => setStores(d.stores ?? []))
      .catch(() => {});
  }, [session]);

  // Dev-only: deep-linking /account?auto=google|facebook starts the flow hands-free,
  // so simulator test runs don't need a tap (clicks are unreliable to automate there).
  const params = useLocalSearchParams<{ auto?: string }>();
  const autoFired = useRef(false);
  useEffect(() => {
    if (!__DEV__) return;
    if (!loading && !session && !autoFired.current && (params.auto === 'google' || params.auto === 'facebook')) {
      autoFired.current = true;
      void social(params.auto);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session, params.auto]);

  const social = async (provider: OAuthProvider) => {
    setBusy(true);
    setError(null);
    try {
      await signInWithProvider(provider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed';
      // A cancelled sheet isn't an error worth shouting about.
      if (!/cancelled/i.test(msg)) setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (mode: 'in' | 'up') => {
    const e = email.trim().toLowerCase();
    if (!e || password.length < 6) {
      setError('Enter an email and a password of at least 6 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: err } =
        mode === 'in'
          ? await supabase.auth.signInWithPassword({ email: e, password })
          : await supabase.auth.signUp({ email: e, password });
      if (err) throw err;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.flex}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.flex}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[styles.content, { paddingBottom: BottomTabInset + insets.bottom + Spacing.four }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <ThemedText type="code" themeColor="tint" style={{ letterSpacing: 2, textTransform: 'uppercase' }}>
              Account
            </ThemedText>

            {loading ? (
              <ActivityIndicator style={{ marginTop: Spacing.six }} />
            ) : session ? (
              <>
                <ThemedText type="subtitle" numberOfLines={1}>
                  {session.user.email}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Signed in · creator {session.user.id.slice(0, 8)}
                </ThemedText>

                <View style={styles.section}>
                  <ThemedText type="smallBold">Your stores</ThemedText>
                  {stores.length ? (
                    stores.map((s) => (
                      <ThemedView key={s.id} type="backgroundElement" style={styles.storeRow}>
                        <ThemedText type="small">{s.name}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {s.slug} · {s.status}
                        </ThemedText>
                      </ThemedView>
                    ))
                  ) : (
                    <ThemedText type="small" themeColor="textSecondary">
                      No stores yet — build one in Studio.
                    </ThemedText>
                  )}
                </View>

                <Pressable onPress={() => Linking.openURL(BILLING_URL).catch(() => {})}>
                  <ThemedView type="backgroundElement" style={styles.button}>
                    <ThemedText type="smallBold">Subscription & billing ↗</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      Managed on the web portal
                    </ThemedText>
                  </ThemedView>
                </Pressable>

                <Pressable onPress={() => supabase.auth.signOut()}>
                  <View style={[styles.button, styles.signOut]}>
                    <ThemedText type="smallBold" style={{ color: '#e24b4a' }}>
                      Sign out
                    </ThemedText>
                  </View>
                </Pressable>
              </>
            ) : (
              <>
                <ThemedText type="title">Join the crew</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Sign in to sync your designs, stores and sales.
                </ThemedText>
                {/* Apple requires Sign in with Apple first on iOS when other social logins exist. */}
                {Platform.OS === 'ios' ? (
                  <Pressable onPress={() => social('apple')} disabled={busy}>
                    <View style={[styles.button, styles.appleButton, { opacity: busy ? 0.5 : 1 }]}>
                      <ThemedText type="smallBold" style={styles.appleText}> Continue with Apple</ThemedText>
                    </View>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => social('google')} disabled={busy}>
                  <ThemedView type="backgroundElement" style={[styles.button, { opacity: busy ? 0.5 : 1 }]}>
                    <ThemedText type="smallBold">Continue with Google</ThemedText>
                  </ThemedView>
                </Pressable>
                <Pressable onPress={() => social('facebook')} disabled={busy}>
                  <ThemedView type="backgroundElement" style={[styles.button, { opacity: busy ? 0.5 : 1 }]}>
                    <ThemedText type="smallBold">Continue with Facebook</ThemedText>
                  </ThemedView>
                </Pressable>
                <ThemedText type="small" themeColor="textSecondary" style={styles.divider}>
                  or with email
                </ThemedText>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="email@you.com"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="password"
                  placeholderTextColor={theme.textSecondary}
                  secureTextEntry
                  autoComplete="password"
                  style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
                {error ? (
                  <ThemedText type="small" style={{ color: '#e24b4a' }}>
                    {error}
                  </ThemedText>
                ) : null}
                <Pressable onPress={() => submit('in')} disabled={busy}>
                  <View style={[styles.button, { backgroundColor: theme.text, opacity: busy ? 0.5 : 1 }]}>
                    {busy ? (
                      <ActivityIndicator color={theme.background} />
                    ) : (
                      <ThemedText type="smallBold" style={{ color: theme.background }}>
                        Sign in
                      </ThemedText>
                    )}
                  </View>
                </Pressable>
                <Pressable onPress={() => submit('up')} disabled={busy}>
                  <ThemedView type="backgroundElement" style={styles.button}>
                    <ThemedText type="smallBold">Create account</ThemedText>
                  </ThemedView>
                </Pressable>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: { flexGrow: 1, padding: Spacing.four, gap: Spacing.three, maxWidth: 520, width: '100%', alignSelf: 'center' },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, fontSize: 15 },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    gap: 2,
    minHeight: 48,
  },
  appleButton: { backgroundColor: '#000' },
  appleText: { color: '#fff' },
  signOut: { marginTop: Spacing.four },
  divider: { textAlign: 'center', marginVertical: Spacing.one },
  section: { gap: Spacing.two, marginTop: Spacing.three },
  storeRow: { padding: Spacing.three, borderRadius: Spacing.two, gap: 2 },
});
