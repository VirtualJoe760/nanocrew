import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line, Path } from 'react-native-svg';
import { usePalette } from '@/components/nc-screen';
import { withScreenFade } from '@/components/screen-fade';
import { glow } from '@/constants/glow';

import { EveGlyph } from '@/components/eve/eve-glyph';
import { StudioComposer } from '@/components/studio-composer';
import { StudioDashboard } from '@/components/studio-dashboard';
import { Paywall } from '@/components/paywall';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { apiUrl, readJson } from '@/lib/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Welcome, type OnboardChoice } from '@/components/welcome';
import { addEveEventListener, summonEve } from '@/lib/eve-bus';

// The Studio is VIEWING — brand details, the dashboard, the composer. DOING (the voice interview,
// site edits, designs) lives with EVE, the full-screen overlay assistant: the interview moved
// wholesale to src/components/eve/eve-home.tsx (docs/studio/VENUS_CENTRAL.md). "New brand" and the
// old ?mode=interview deep link now summon her.

// Dark ink used for text ON the gold accent buttons — gold is light, so dark text reads in
// both modes. (The screen background comes from the palette below.)
const BG = '#08080a';
const ONBOARD_SEEN_KEY = 'nc_welcome_seen';
const ONBOARD_INTENT_KEY = 'nc_onboard_intent';

const SERIF = 'Jost-Light'; // display title face (was Georgia serif; unified on Jost)
// Palette + the silk FabricBackground + the NC mark now live in @/components/nc-screen so Studio,
// Design, Market, and Account all share one look (imported above).

function ManageIcon() {
  const c = '#9396a0';
  return (
    <Svg width={28} height={26} opacity={0.5}>
      {/* pencil */}
      <Path d="M7 19 L7 16 L17 6 L20 9 L10 19 Z" fill="none" stroke={c} strokeWidth={1.5} strokeLinejoin="round" />
      <Line x1={15} y1={8} x2={18} y2={11} stroke={c} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

// ---------- Screen ----------

export default withScreenFade(StudioScreen, { eveThrough: true });

function StudioScreen() {
  const insets = useSafeAreaInsets();
  const p = usePalette();
  const { session, loading } = useAuth();

  const [voiceResolved, setVoiceResolved] = useState(false); // /api/me landing check done
  const [showComposer, setShowComposer] = useState(false);
  const [consoleBrand, setConsoleBrand] = useState<{ slug: string; name: string } | null>(null);
  const [dashKey, setDashKey] = useState(0); // bump to refetch the dashboard (e.g. after deleting a brand)
  const [hasStore, setHasStore] = useState(false);

  // Deep-link from a tapped "changes ready" push → open that store's Console on the Edit tab (review).
  const reviewParams = useLocalSearchParams<{ reviewSlug?: string; reviewName?: string; mode?: string }>();
  const reviewHandled = useRef<string | null>(null);
  useEffect(() => {
    const slug = reviewParams.reviewSlug;
    if (slug && reviewHandled.current !== slug) {
      reviewHandled.current = slug;
      setConsoleBrand({ slug, name: reviewParams.reviewName || slug });
      setShowComposer(true);
    }
  }, [reviewParams.reviewSlug, reviewParams.reviewName]);
  // Legacy ?mode=interview deep link → the interview lives with Eve now; summon her.
  const modeHandled = useRef(false);
  useEffect(() => {
    if (reviewParams.mode === 'interview' && !modeHandled.current) {
      modeHandled.current = true;
      summonEve({ state: 'home' });
    }
  }, [reviewParams.mode]);
  // Eve built a store while the Studio sat beneath her → refetch the dashboard.
  useEffect(
    () =>
      addEveEventListener((e) => {
        if (e.kind === 'store-created') {
          setHasStore(true);
          setDashKey((k) => k + 1);
        }
      }),
    [],
  );
  const [paywall, setPaywall] = useState<'subscription_required' | 'brand_limit' | 'manage' | null>(null);

  // ── First-launch welcome + onboarding intent ───────────────────────────────────────────────
  const [welcomeChecked, setWelcomeChecked] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [onboardIntent, setOnboardIntent] = useState<OnboardChoice | null>(null);
  const intentHandledRef = useRef(false);
  const pendingSubscribeGrantRef = useRef(false);

  // Load the first-launch flag + any pending onboarding intent once.
  useEffect(() => {
    (async () => {
      try {
        const [seen, intent] = await Promise.all([
          AsyncStorage.getItem(ONBOARD_SEEN_KEY),
          AsyncStorage.getItem(ONBOARD_INTENT_KEY),
        ]);
        if (intent === 'subscribe') setOnboardIntent('subscribe');
        setShowWelcome(!seen);
      } catch {
        setShowWelcome(false);
      } finally {
        setWelcomeChecked(true);
      }
    })();
  }, []);


  // Welcome CTA: remember the choice, dismiss the panel, send them to auth (/account). The chosen
  // path is executed once they sign in (the effect below).
  const handleChoose = useCallback(async (choice: OnboardChoice) => {
    setShowWelcome(false);
    AsyncStorage.setItem(ONBOARD_SEEN_KEY, '1').catch(() => {});
    if (choice === 'shop') {
      router.navigate('/market'); // browse + shop for free — no account required
      return;
    }
    if (choice === 'login') {
      router.navigate('/account');
      return;
    }
    // subscribe → remember the intent, send to auth; the paywall opens after sign-in (effect below).
    setOnboardIntent('subscribe');
    AsyncStorage.setItem(ONBOARD_INTENT_KEY, 'subscribe').catch(() => {});
    router.navigate('/account');
  }, []);

  // Once signed in, run the chosen path: trial → Pro paywall (+ a week of credits granted server-side
  // once the subscription verifies), free → the $3 starting credits, shop → Market. Idempotent.
  useEffect(() => {
    if (!session || onboardIntent !== 'subscribe' || intentHandledRef.current) return;
    intentHandledRef.current = true;
    pendingSubscribeGrantRef.current = true; // the welcome credits are granted when the paywall closes
    setPaywall('subscription_required');
    AsyncStorage.removeItem(ONBOARD_INTENT_KEY).catch(() => {});
    setOnboardIntent(null);
  }, [session, onboardIntent]);
  // 'loading' until /api/me resolves, then the dashboard (its empty state hands off to Eve).
  const [mode, setMode] = useState<'loading' | 'dashboard'>('loading');

  useEffect(() => {
    if (!session) return;
    let alive = true;
    (async () => {
      // Resolve the landing: a creator who already has brands lands on the dashboard, everyone else
      // on the primer. AWAIT so hasStore is known before voiceResolved gates the landing decision.
      try {
        const r = await fetch(apiUrl('/api/me'), { headers: { Authorization: `Bearer ${session.access_token}` } });
        const d = await readJson<{ stores?: unknown[] }>(r);
        if (alive) setHasStore((d.stores?.length ?? 0) > 0);
      } catch {
        /* leave hasStore false — lands on the primer, the safe default */
      } finally {
        if (alive) setVoiceResolved(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [session]);

  // Decide the landing once auth + store status are known — everyone gets the dashboard now
  // (its empty state hands off to Eve for the first brand).
  useEffect(() => {
    if (voiceResolved) setMode('dashboard');
  }, [voiceResolved]);

  // Another brand (or the first) — the interview is Eve's now; summon her.
  const onNewBrand = useCallback(() => {
    summonEve({ state: 'home' });
  }, []);

  // Native tab bar sits above the home indicator; reserve its height + the inset + a
  // comfortable gap so the last row of the dashboard never dips under it.
  const bottomPad = BottomTabInset + insets.bottom + Spacing.five;

  // First-launch welcome: a full-screen Modal presented ABOVE the tab bar so it owns its own swipe
  // gestures (no tab-navigator conflict) and hides the bottom bar during onboarding.
  const welcomeVisible = welcomeChecked && !loading && !session && showWelcome;

  return (
    <View style={styles.container}>
      <Modal
        visible={welcomeVisible}
        animationType="fade"
        transparent
        onRequestClose={() => {
          setShowWelcome(false);
          AsyncStorage.setItem(ONBOARD_SEEN_KEY, '1').catch(() => {});
        }}>
        {/* The Modal renders in its own native view tree (no safe-area context), so pass the
            app-level insets in — otherwise the top bar sits under the Dynamic Island / status bar. */}
        <Welcome onChoose={handleChoose} topInset={insets.top} bottomInset={insets.bottom} />
      </Modal>

      <View style={[styles.content, { paddingTop: insets.top + Spacing.four, paddingBottom: bottomPad }]}>
        <View style={styles.headerRow}>
          <ThemedText type="code" style={[styles.eyebrow, { color: p.dim }]}>
            EVE
          </ThemedText>
          <View style={styles.headerSpacer} />
          {session && hasStore && mode === 'dashboard' ? (
            <View style={styles.headerIcons}>
              <Pressable onPress={() => setShowComposer(true)} hitSlop={10}>
                <ManageIcon />
              </Pressable>
            </View>
          ) : null}
        </View>
        {session ? (
          <>
            <StudioComposer visible={showComposer} onClose={() => setShowComposer(false)} token={session.access_token} onOpenBilling={() => setPaywall('manage')} onDeleted={() => { setShowComposer(false); setConsoleBrand(null); setDashKey((k) => k + 1); }} onBrandRenamed={(name) => { setConsoleBrand((b) => (b ? { ...b, name } : b)); setDashKey((k) => k + 1); }} slug={consoleBrand?.slug} brandName={consoleBrand?.name} />
            <Paywall
              visible={!!paywall}
              onClose={() => {
                setPaywall(null);
                // If this paywall was opened by a welcome plan CTA, claim the $10 welcome-credit grant
                // now (the route only grants once a paid plan is truly active).
                if (pendingSubscribeGrantRef.current && session) {
                  pendingSubscribeGrantRef.current = false;
                  fetch(apiUrl('/api/creator/onboarding'), {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: 'subscribe' }),
                  }).catch(() => {});
                }
              }}
              token={session.access_token}
              reason={paywall}
              onFreeSlot={() => setPaywall(null)}
            />
          </>
        ) : null}

        {loading ? (
          <ActivityIndicator style={styles.center} color="#cdd1d9" />
        ) : !session ? (
          <View style={styles.introWrap}>
            <EveGlyph size={132} />
            <ThemedText type="code" style={[styles.introTag, { color: p.dim }]}>
              FROM IDEA TO BRAND IN SECONDS
            </ThemedText>
            <ThemedText type="title" style={[styles.introTitle, { color: p.ink }]}>
              Meet Eve
            </ThemedText>
            <ThemedText type="small" style={[styles.introBody, { color: p.dim }]}>
              Your AI brand consultant. Talk it through, and Eve designs your clothing
              brand, builds the store, and launches your website.
            </ThemedText>
            <Pressable
              onPress={() => router.navigate('/account')}
              style={({ pressed }) => [styles.ctaPrimary, { backgroundColor: p.accent }, glow(p.accent, 18, pressed ? 0.3 : 0.6), pressed && { transform: [{ scale: 0.98 }] }]}>
              <ThemedText type="smallBold" style={{ color: BG }}>
                Create an account
              </ThemedText>
            </Pressable>
            <Pressable onPress={() => router.navigate('/account')} hitSlop={8} style={styles.ctaSecondary}>
              <ThemedText type="code" style={[styles.ctaSecondaryText, { color: p.dim }]}>
                I already have one — log in
              </ThemedText>
            </Pressable>
            <ThemedText type="code" style={[styles.introFoot, { color: p.faint }]}>
              Free to explore. You only need a plan to launch a store.
            </ThemedText>
          </View>
        ) : !voiceResolved || mode === 'loading' ? (
          <ActivityIndicator style={styles.center} color="#cdd1d9" />
        ) : hasStore ? (
          <StudioDashboard
            key={dashKey}
            token={session.access_token}
            onEditBrand={(slug, name) => { setConsoleBrand({ slug, name }); setShowComposer(true); }}
            onNewBrand={onNewBrand}
            onOpenBilling={() => setPaywall('manage')}
            onBounty={(panel, slot) => router.navigate(`/design?panel=${panel}${slot ? `&slot=${slot}` : ''}`)}
          />
        ) : (
          // No store yet — the first brand is built WITH Eve (slide down from the top, or tap).
          <View style={styles.introWrap}>
            <EveGlyph size={132} />
            <ThemedText type="code" style={[styles.introTag, { color: p.dim }]}>
              YOUR FIRST BRAND
            </ThemedText>
            <ThemedText type="title" style={[styles.introTitle, { color: p.ink }]}>
              Talk it through with Eve
            </ThemedText>
            <ThemedText type="small" style={[styles.introBody, { color: p.dim }]}>
              Eve interviews you — name, products, style — then designs the brand and builds
              your store. Just talk; she does the rest.
            </ThemedText>
            <Pressable
              onPress={onNewBrand}
              style={({ pressed }) => [styles.ctaPrimary, { backgroundColor: p.accent }, glow(p.accent, 18, pressed ? 0.3 : 0.6), pressed && { transform: [{ scale: 0.98 }] }]}>
              <ThemedText type="smallBold" style={{ color: BG }}>
                🎙  Start with Eve
              </ThemedText>
            </Pressable>
            <ThemedText type="code" style={[styles.introFoot, { color: p.faint }]}>
              Tip: slide down from the top edge anytime — that’s Eve.
            </ThemedText>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 }, // transparent — the global AppBackground (in _layout) shows through
  content: { flex: 1, paddingHorizontal: Spacing.four },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: '#9396a0', letterSpacing: 1 },
  introWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four },
  introTag: { letterSpacing: 3, fontSize: 10, marginTop: Spacing.two },
  introTitle: { fontSize: 30, fontFamily: SERIF, letterSpacing: 0.5 },
  introBody: { textAlign: 'center', maxWidth: 320, lineHeight: 22 },
  ctaPrimary: { backgroundColor: '#cdd1d9', borderRadius: 14, paddingVertical: Spacing.three, paddingHorizontal: Spacing.six, alignItems: 'center', marginTop: Spacing.three },
  ctaSecondary: { paddingVertical: Spacing.two },
  ctaSecondaryText: { color: '#9396a0' },
  introFoot: { color: '#9396a0', fontSize: 12, marginTop: Spacing.three, textAlign: 'center' },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  headerSpacer: { flex: 1 },
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
