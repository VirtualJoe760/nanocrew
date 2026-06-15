import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
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
import { BrandStore } from '@/components/brand-store';
import { EarningsCockpit } from '@/components/earnings-cockpit';
import { PlatformAdmin } from '@/components/platform-admin';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { apiFetch, apiUrl } from '@/lib/api';
import { signInWithProvider, type OAuthProvider } from '@/lib/oauth';
import { supabase } from '@/lib/supabase';

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
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showEarnings, setShowEarnings] = useState(false);
  const [storeSlug, setStoreSlug] = useState<string | null>(null);
  const [payouts, setPayouts] = useState<{ connected: boolean; chargesEnabled: boolean } | null>(null);

  // Ensure the creators row exists + load this creator's stores; probe platform-admin access.
  useEffect(() => {
    if (!session) {
      setStores([]);
      setIsAdmin(false);
      return;
    }
    fetch(apiUrl('/api/me'), {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((d: { stores?: StoreRow[] }) => setStores(d.stores ?? []))
      .catch(() => {});
    apiFetch('/api/platform/admin')
      .then((r) => setIsAdmin(r.ok))
      .catch(() => setIsAdmin(false));
    apiFetch('/api/creator/connect')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { connected?: boolean; chargesEnabled?: boolean } | null) =>
        setPayouts(d ? { connected: !!d.connected, chargesEnabled: !!d.chargesEnabled } : null),
      )
      .catch(() => setPayouts(null));
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

  const deleteAccount = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch('/api/me', { method: 'DELETE' });
      if (!r.ok) throw new Error('Could not delete account');
      await supabase.auth.signOut();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete account');
    } finally {
      setBusy(false);
    }
  };

  const openBilling = async () => {
    setError(null);
    try {
      const r = await apiFetch('/api/creator/billing/portal', { method: 'POST' });
      const d = (await r.json()) as { url?: string };
      if (r.ok && d.url) {
        Linking.openURL(d.url).catch(() => {});
        return;
      }
    } catch {
      /* fall through */
    }
    setError('No active billing yet — subscribe from Studio first.');
  };

  // Stripe Connect onboarding — opens the Stripe-hosted account link so the creator can finish
  // payout setup. Their brands' storefront sales pay out to this account.
  const openPayouts = async () => {
    setError(null);
    try {
      const r = await apiFetch('/api/creator/connect', { method: 'POST' });
      const d = (await r.json()) as { url?: string; error?: string };
      if (r.ok && d.url) {
        Linking.openURL(d.url).catch(() => {});
        return;
      }
      setError(d.error ?? 'Payouts aren’t available yet.');
    } catch {
      setError('Could not start payout setup.');
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account, brands, designs, and data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void deleteAccount() },
      ],
    );
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
                      <Pressable key={s.id} onPress={() => setStoreSlug(s.slug)}>
                        <ThemedView type="backgroundElement" style={styles.storeRow}>
                          <View style={styles.storeRowMeta}>
                            <ThemedText type="small">{s.name}</ThemedText>
                            <ThemedText type="code" themeColor="textSecondary">
                              {s.slug} · {s.status}
                            </ThemedText>
                          </View>
                          <ThemedText type="code" themeColor="tint">
                            Open store →
                          </ThemedText>
                        </ThemedView>
                      </Pressable>
                    ))
                  ) : (
                    <ThemedText type="small" themeColor="textSecondary">
                      No stores yet — build one in Studio.
                    </ThemedText>
                  )}
                </View>

                {stores.length ? (
                  <Pressable onPress={() => setShowEarnings(true)}>
                    <ThemedView type="backgroundElement" style={styles.button}>
                      <ThemedText type="smallBold">Earnings</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        Revenue, orders & margins across your brands
                      </ThemedText>
                    </ThemedView>
                  </Pressable>
                ) : null}

                <Pressable onPress={openBilling} disabled={busy}>
                  <ThemedView type="backgroundElement" style={styles.button}>
                    <ThemedText type="smallBold">Subscription & billing ↗</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      Manage your plan, card & invoices
                    </ThemedText>
                  </ThemedView>
                </Pressable>

                <Pressable onPress={openPayouts} disabled={busy}>
                  <ThemedView type="backgroundElement" style={styles.button}>
                    <ThemedText type="smallBold" themeColor={payouts?.chargesEnabled ? 'tint' : undefined}>
                      {payouts?.chargesEnabled ? 'Payouts active ✓' : payouts?.connected ? 'Finish payout setup ↗' : 'Set up payouts ↗'}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {payouts?.chargesEnabled ? 'Your store sales pay out to your account' : 'Get paid when your brand sells'}
                    </ThemedText>
                  </ThemedView>
                </Pressable>

                {isAdmin ? (
                  <Pressable onPress={() => setShowAdmin(true)}>
                    <ThemedView type="backgroundElement" style={styles.button}>
                      <ThemedText type="smallBold" themeColor="tint">Platform admin</ThemedText>
                    </ThemedView>
                  </Pressable>
                ) : null}

                <Pressable onPress={() => supabase.auth.signOut()}>
                  <View style={[styles.button, styles.signOut]}>
                    <ThemedText type="smallBold" style={{ color: '#e24b4a' }}>
                      Sign out
                    </ThemedText>
                  </View>
                </Pressable>

                <Pressable onPress={confirmDelete} disabled={busy}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.deleteLink}>
                    Delete account
                  </ThemedText>
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
      {isAdmin ? <PlatformAdmin visible={showAdmin} onClose={() => setShowAdmin(false)} /> : null}
      {session ? <EarningsCockpit visible={showEarnings} onClose={() => setShowEarnings(false)} token={session.access_token} /> : null}
      <BrandStore slug={storeSlug} visible={!!storeSlug} onClose={() => setStoreSlug(null)} />
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
  deleteLink: { textAlign: 'center', marginTop: Spacing.three, textDecorationLine: 'underline' },
  divider: { textAlign: 'center', marginVertical: Spacing.one },
  section: { gap: Spacing.two, marginTop: Spacing.three },
  storeRow: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  storeRowMeta: { gap: 2, flex: 1 },
});
