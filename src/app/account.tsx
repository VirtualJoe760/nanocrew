import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';

import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { NCMark, usePalette } from '@/components/nc-screen';
import { AppBackground } from '@/components/backgrounds/app-background';
import { withScreenFade } from '@/components/screen-fade';
import { GlowButton } from '@/components/glow-button';
import { GlowInput } from '@/components/glow-input';
import { glow } from '@/constants/glow';
import { BrandStore } from '@/components/brand-store';
import { EarningsCockpit } from '@/components/earnings-cockpit';
import { Purchases } from '@/components/purchases';
import { Paywall } from '@/components/paywall';
import { PlatformAdmin } from '@/components/platform-admin';
import { useAuth } from '@/hooks/use-auth';
import { TERMS_URL, TERMS_VERSION } from '@/lib/legal';
import { useTheme } from '@/hooks/use-theme';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { ApiError, apiFetch, apiUrl, readJson } from '@/lib/api';
import { signInWithProvider, type OAuthProvider } from '@/lib/oauth';
import { supabase } from '@/lib/supabase';

type StoreRow = { id: string; name: string; slug: string; status: string };

const DANGER = '#e24b4a';
const WORDMARK = 'Jost-Thin'; // the "Nano Crew" brand title — Thin 100
const DISPLAY = 'Jost-Light'; // other display marks
const PLAN_LABEL: Record<string, string> = { free: 'Free', starter: 'Starter', pro: 'Pro', advanced: 'Advanced' };

// ---- Small layout primitives for a clean grouped (iOS-settings-style) list ----

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <ThemedText type="code" themeColor="textSecondary" style={styles.sectionLabel}>
      {children}
    </ThemedText>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      {children}
    </ThemedView>
  );
}

function Row({
  title,
  subtitle,
  trailing,
  onPress,
  danger,
  tint,
  first,
}: {
  title: string;
  subtitle?: string;
  trailing?: string;
  onPress?: () => void;
  danger?: boolean;
  tint?: boolean;
  first?: boolean;
}) {
  const theme = useTheme();
  const body = (
    <View style={[styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: `${theme.textSecondary}22` }]}>
      <View style={styles.rowMeta}>
        <ThemedText type="smallBold" themeColor={tint ? 'tint' : undefined} style={danger ? { color: DANGER } : undefined}>
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText type="code" themeColor="textSecondary" style={styles.rowSub}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {trailing ? (
        <ThemedText type="code" themeColor={tint ? 'tint' : 'textSecondary'} style={styles.rowTrailing}>
          {trailing}
        </ThemedText>
      ) : null}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? styles.rowPressed : undefined)}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

export default withScreenFade(AccountScreen);

function AccountScreen() {
  const theme = useTheme();
  const p = usePalette();
  const { session, loading } = useAuth();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [isSignup, setIsSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showEarnings, setShowEarnings] = useState(false);
  const [showPurchases, setShowPurchases] = useState(false);
  const [storeSlug, setStoreSlug] = useState<string | null>(null);
  const [payouts, setPayouts] = useState<{ connected: boolean; chargesEnabled: boolean } | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);

  // Ensure the creators row exists + load this creator's stores; probe platform-admin access + plan.
  useEffect(() => {
    if (!session) {
      setStores([]);
      setIsAdmin(false);
      setPlan(null);
      setPayouts(null);
      return;
    }
    fetch(apiUrl('/api/me'), {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(readJson<{ stores?: StoreRow[] }>)
      .then((d) => setStores(d.stores ?? []))
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
    apiFetch('/api/creator/subscription')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { entitlements?: { plan?: string } } | null) => setPlan(d?.entitlements?.plan ?? 'free'))
      .catch(() => setPlan(null));
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
    if (busy) return;
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
    if (busy) return;
    const e = email.trim().toLowerCase();
    if (!e || password.length < 6) {
      setError('Enter an email and a password of at least 6 characters.');
      return;
    }
    if (mode === 'up') {
      if (!fullName.trim()) {
        setError('Enter your name.');
        return;
      }
      if (!agreed) {
        setError('Please accept the Terms & Creator Agreement to create an account.');
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const { error: err } =
        mode === 'in'
          ? await supabase.auth.signInWithPassword({ email: e, password })
          : await supabase.auth.signUp({
              email: e,
              password,
              // Captured in user_metadata; /api/me persists these onto the creator + records the
              // accepted terms version (server stamps the time) on first sign-in.
              options: { data: { name: fullName.trim(), phone: phone.trim() || undefined, terms_version: TERMS_VERSION } },
            });
      if (err) throw err;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    if (busy) return;
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

  // Stripe Connect onboarding — opens the Stripe-hosted account link so the creator can finish
  // payout setup. Their brands' storefront sales pay out to this account.
  const openPayouts = async () => {
    setError(null);
    try {
      const r = await apiFetch('/api/creator/connect', { method: 'POST' });
      const d = await readJson<{ url?: string }>(r);
      if (d.url) {
        Linking.openURL(d.url).catch(() => {});
        return;
      }
      setError('Payouts aren’t available yet.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start payout setup.');
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

  const user = session?.user;
  const avatarUrl = (user?.user_metadata?.avatar_url as string | undefined) ?? (user?.user_metadata?.picture as string | undefined) ?? null;
  const emailAddr = user?.email ?? '';
  const initial = (emailAddr[0] ?? '?').toUpperCase();
  const planLabel = plan ? (PLAN_LABEL[plan] ?? plan) : null;
  const payoutTitle = payouts?.chargesEnabled ? 'Payouts active' : payouts?.connected ? 'Finish payout setup' : 'Set up payouts';

  return (
    <View style={[styles.container, { backgroundColor: p.bg }]}>
      <AppBackground />
      <SafeAreaView edges={['top']} style={styles.flex}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[styles.content, { paddingBottom: BottomTabInset + insets.bottom + Spacing.four }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {loading ? (
              <ActivityIndicator style={{ marginTop: Spacing.six }} />
            ) : session ? (
              <>
                {/* Branded chrome header — matches Studio/Market (NC serif mark + eyebrow) */}
                <View style={styles.brandHeader}>
                  <NCMark size={22} color={theme.text} />
                  <ThemedText type="code" themeColor="textSecondary" style={styles.eyebrow}>ACCOUNT</ThemedText>
                </View>

                {/* Profile header */}
                <View style={styles.profile}>
                  {avatarUrl ? (
                    <Image source={{ uri: avatarUrl }} style={styles.avatar} contentFit="cover" />
                  ) : (
                    <View style={[styles.avatar, styles.avatarFallback, { borderColor: theme.tint, backgroundColor: theme.backgroundElement }]}>
                      <ThemedText type="subtitle" themeColor="tint">{initial}</ThemedText>
                    </View>
                  )}
                  <View style={styles.profileMeta}>
                    <ThemedText type="default" numberOfLines={1}>{emailAddr}</ThemedText>
                    <View style={styles.planRow}>
                      {planLabel ? (
                        <View style={[styles.planBadge, { borderColor: `${theme.tint}66` }]}>
                          <ThemedText type="code" themeColor="tint" style={styles.planBadgeText}>{planLabel.toUpperCase()}</ThemedText>
                        </View>
                      ) : null}
                      <ThemedText type="code" themeColor="textSecondary">creator {user?.id.slice(0, 8)}</ThemedText>
                    </View>
                  </View>
                </View>

                <SectionLabel>Your brands</SectionLabel>
                <Card>
                  {stores.length ? (
                    stores.map((s, i) => (
                      <Row
                        key={s.id}
                        first={i === 0}
                        title={s.name}
                        subtitle={`${s.slug} · ${s.status}`}
                        trailing="›"
                        onPress={() => setStoreSlug(s.slug)}
                      />
                    ))
                  ) : (
                    <Row first title="No brands yet" subtitle="Create one in the Studio tab" />
                  )}
                </Card>

                <SectionLabel>Purchases</SectionLabel>
                <Card>
                  <Row
                    first
                    title="Your orders"
                    subtitle="Track shipments & request returns"
                    trailing="›"
                    onPress={() => setShowPurchases(true)}
                  />
                </Card>

                <SectionLabel>Commerce</SectionLabel>
                <Card>
                  {stores.length ? (
                    <Row
                      first
                      title="Earnings"
                      subtitle="Revenue, orders & margins across your brands"
                      trailing="›"
                      onPress={() => setShowEarnings(true)}
                    />
                  ) : null}
                  <Row
                    first={!stores.length}
                    title="Subscription & billing"
                    subtitle={planLabel && plan !== 'free' ? `${planLabel} plan · view plans & top up credits` : 'Choose a plan & top up credits'}
                    trailing="›"
                    onPress={() => setShowPaywall(true)}
                  />
                  <Row
                    title={payoutTitle}
                    subtitle={payouts?.chargesEnabled ? 'Your store sales pay out to your account' : 'Get paid when your brand sells'}
                    trailing={payouts?.chargesEnabled ? '✓' : '↗'}
                    tint={payouts?.chargesEnabled}
                    onPress={openPayouts}
                  />
                </Card>

                {isAdmin ? (
                  <>
                    <SectionLabel>Platform</SectionLabel>
                    <Card>
                      <Row first title="Platform admin" trailing="›" tint onPress={() => setShowAdmin(true)} />
                    </Card>
                  </>
                ) : null}

                {error ? (
                  <ThemedText type="small" style={{ color: DANGER, textAlign: 'center' }}>
                    {error}
                  </ThemedText>
                ) : null}

                <View style={styles.dangerZone}>
                  {/* Sign out is safe + reversible → neutral, themed. Red is reserved for Delete. */}
                  <Pressable onPress={() => supabase.auth.signOut()}>
                    <View style={[styles.signOutBtn, { borderColor: `${theme.textSecondary}44` }]}>
                      <ThemedText type="smallBold">Sign out</ThemedText>
                    </View>
                  </Pressable>
                  <Pressable onPress={confirmDelete} disabled={busy}>
                    <ThemedText type="small" style={[styles.deleteLink, { color: DANGER }]}>
                      Delete account
                    </ThemedText>
                  </Pressable>
                </View>
              </>
            ) : (
              <View style={styles.authWrap}>
                {/* Branded join hero — first impression before anyone has an account. */}
                <View style={styles.joinHero}>
                  <NCMark size={52} color={theme.text} />
                  <ThemedText glow style={[styles.joinWordmark, { color: theme.text }]}>Nano Crew</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.joinSub}>
                    {isSignup
                      ? 'Talk to Venus, launch an AI-designed clothing brand, and sell it anywhere — all from your phone.'
                      : 'Sign in to sync your designs, stores and sales.'}
                  </ThemedText>
                </View>

                {/* Apple requires Sign in with Apple first on iOS when other social logins exist. */}
                {Platform.OS === 'ios' ? (
                  <Pressable onPress={() => social('apple')} disabled={busy}>
                    <View style={[styles.button, styles.appleButton, glow(theme.tint, 10, 0.28), { opacity: busy ? 0.5 : 1 }]}>
                      <ThemedText type="smallBold" style={styles.appleText}> Continue with Apple</ThemedText>
                    </View>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => social('google')} disabled={busy}>
                  <ThemedView type="backgroundElement" style={[styles.button, glow(theme.tint, 10, 0.3), { opacity: busy ? 0.5 : 1 }]}>
                    <ThemedText type="smallBold">Continue with Google</ThemedText>
                  </ThemedView>
                </Pressable>

                <ThemedText type="small" themeColor="textSecondary" style={styles.divider}>
                  or with email
                </ThemedText>
                {isSignup ? (
                  <>
                    <GlowInput
                      value={fullName}
                      onChangeText={setFullName}
                      placeholder="Full name"
                      autoCapitalize="words"
                      autoComplete="name"
                    />
                    <GlowInput
                      value={phone}
                      onChangeText={setPhone}
                      placeholder="Phone (optional)"
                      keyboardType="phone-pad"
                      autoComplete="tel"
                    />
                  </>
                ) : null}
                <GlowInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="email@you.com"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                />
                <GlowInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="password"
                  secureTextEntry
                  autoComplete="password"
                />
                {isSignup ? (
                  <>
                    <Pressable onPress={() => setAgreed((v) => !v)} style={styles.agreeRow} hitSlop={6}>
                      <View style={[styles.checkbox, { borderColor: theme.textSecondary, backgroundColor: agreed ? theme.text : 'transparent' }]}>
                        {agreed ? <ThemedText type="smallBold" style={{ color: theme.background, fontSize: 12, lineHeight: 15 }}>✓</ThemedText> : null}
                      </View>
                      <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
                        I agree to the Terms &amp; Creator Agreement — I own my designs and indemnify Nano Crew and its manufacturers against claims arising from them.
                      </ThemedText>
                    </Pressable>
                    <Pressable onPress={() => Linking.openURL(TERMS_URL)} hitSlop={6}>
                      <ThemedText type="code" style={[styles.createLink, { color: theme.tint }]}>
                        Read the full Terms &amp; Creator Agreement →
                      </ThemedText>
                    </Pressable>
                  </>
                ) : null}
                {error ? (
                  <ThemedText type="small" style={{ color: DANGER }}>
                    {error}
                  </ThemedText>
                ) : null}
                <GlowButton
                  label={isSignup ? 'Create account' : 'Sign in'}
                  onPress={() => submit(isSignup ? 'up' : 'in')}
                  loading={busy}
                />
                <Pressable onPress={() => { setIsSignup((v) => !v); setError(null); }} disabled={busy}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.createLink}>
                    {isSignup ? 'Have an account? Sign in' : 'New here? Create an account'}
                  </ThemedText>
                </Pressable>
              </View>
            )}

            <View style={styles.legalRow}>
              <Pressable onPress={() => Linking.openURL('https://nanocrew-api.vercel.app/privacy')}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.legalLink}>
                  Privacy
                </ThemedText>
              </Pressable>
              <ThemedText type="small" themeColor="textSecondary">  ·  </ThemedText>
              <Pressable onPress={() => Linking.openURL('https://nanocrew-api.vercel.app/terms')}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.legalLink}>
                  Terms
                </ThemedText>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
      {isAdmin ? <PlatformAdmin visible={showAdmin} onClose={() => setShowAdmin(false)} /> : null}
      {session ? <EarningsCockpit visible={showEarnings} onClose={() => setShowEarnings(false)} token={session.access_token} /> : null}
      {session ? <Purchases visible={showPurchases} onClose={() => setShowPurchases(false)} /> : null}
      {session ? <Paywall visible={showPaywall} onClose={() => setShowPaywall(false)} token={session.access_token} reason="manage" /> : null}
      <BrandStore slug={storeSlug} visible={!!storeSlug} onClose={() => setStoreSlug(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: { flexGrow: 1, padding: Spacing.four, gap: Spacing.three, maxWidth: 520, width: '100%', alignSelf: 'center' },

  // Branded chrome header
  brandHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.one },
  ncMark: { fontFamily: DISPLAY, fontSize: 18, letterSpacing: 1 },

  // Profile header
  profile: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, marginBottom: Spacing.two },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  profileMeta: { flex: 1, gap: 4 },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  planBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 1 },
  planBadgeText: { fontSize: 10, letterSpacing: 1 },

  // Grouped list
  sectionLabel: { letterSpacing: 1.5, textTransform: 'uppercase', marginTop: Spacing.three, marginBottom: -Spacing.one, marginLeft: Spacing.one, fontSize: 11 },
  card: { borderRadius: Spacing.three, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, minHeight: 56 },
  rowPressed: { opacity: 0.55 },
  rowMeta: { flex: 1, gap: 2 },
  rowSub: { fontSize: 11 },
  rowTrailing: { fontSize: 16 },

  // Danger / session
  dangerZone: { marginTop: Spacing.five, gap: Spacing.two },
  signOutBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.three, borderRadius: Spacing.three, borderWidth: 1, minHeight: 48 },
  deleteLink: { textAlign: 'center', marginTop: Spacing.two, textDecorationLine: 'underline' },

  // Auth (logged-out)
  authWrap: { gap: Spacing.three },
  joinHero: { alignSelf: 'stretch', alignItems: 'flex-start', gap: Spacing.one, marginTop: Spacing.two, marginBottom: Spacing.four },
  joinWordmark: { fontFamily: WORDMARK, fontSize: 32, letterSpacing: 2, marginTop: Spacing.one },
  joinTitle: { textAlign: 'center', marginTop: Spacing.one },
  joinSub: { textAlign: 'left', lineHeight: 21 },
  eyebrow: { letterSpacing: 2, marginBottom: Spacing.one },
  authSub: { marginBottom: Spacing.two },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, fontSize: 15 },
  button: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.three, borderRadius: Spacing.three, minHeight: 48 },
  appleButton: { backgroundColor: '#000' },
  appleText: { color: '#fff' },
  divider: { textAlign: 'center', marginVertical: Spacing.one },
  createLink: { textAlign: 'center', marginTop: Spacing.two, textDecorationLine: 'underline' },
  agreeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, paddingVertical: Spacing.one },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 1 },

  // Legal
  legalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: Spacing.six, marginBottom: Spacing.four },
  legalLink: { textDecorationLine: 'underline' },
});
