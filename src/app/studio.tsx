import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams, usePathname } from 'expo-router';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePalette } from '@/components/nc-screen';
import { EVE_SCRIM, withScreenFade } from '@/components/screen-fade';
import { glow } from '@/constants/glow';

import { BrandDeck } from '@/components/eve/brand-deck';
import { EveAssets } from '@/components/eve/eve-assets';
import { EveDesign } from '@/components/eve/eve-design';
import { EveDeveloping } from '@/components/eve/eve-developing';
import { EveGlyph } from '@/components/eve/eve-glyph';
import { EveHome } from '@/components/eve/eve-home';
import { Paywall } from '@/components/paywall';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { apiUrl, readJson } from '@/lib/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Welcome, type OnboardChoice } from '@/components/welcome';
import { addEveEventListener, registerEveSummonListener, type EveSummon } from '@/lib/eve-bus';

// THE EVE TAB — her page. DEFAULT is the talk-to-Eve experience (EveHome, over the persistent root
// Eve). The BrandDeck (full-screen, swipe-between-brands) opens ONLY from the wheel's BRANDS spoke —
// the old top-edge pull-down/handle is gone (one summon, the wheel; Joe 2026-08-17). `developing`
// (site edits) and `design` are deep voice surfaces that swap in full-screen. Eve's live mic is
// gated on tab focus + the deck being closed, so she only listens when you're actually on her tab.
// summonEve() still works app-wide — the listener registers here and queued summons flush on mount.

// Dark ink used for text ON the gold accent buttons — gold is light, so dark text reads in
// both modes. (The screen background comes from the palette below.)
const BG = '#08080a';
const ONBOARD_SEEN_KEY = 'nc_welcome_seen';
const ONBOARD_INTENT_KEY = 'nc_onboard_intent';

const SERIF = 'Jost-Light'; // display title face (was Georgia serif; unified on Jost)
// Palette + the silk FabricBackground + the NC mark now live in @/components/nc-screen so Studio,
// Design, Market, and Account all share one look (imported above).

// ---------- Screen ----------

export default withScreenFade(StudioScreen, { eveThrough: 'clear' });

function StudioScreen() {
  const insets = useSafeAreaInsets();
  const p = usePalette();
  const { session, loading } = useAuth();

  const [voiceResolved, setVoiceResolved] = useState(false); // /api/me landing check done
  // Deep-link landing for the deck's embedded console (push → review, site submitted).
  const [deckFocus, setDeckFocus] = useState<{ slug: string; tab?: 'posts' | 'settings' } | null>(null);
  const [dashKey, setDashKey] = useState(0); // bump to refetch the dashboard (e.g. after deleting a brand)
  const [hasStore, setHasStore] = useState(false);

  // Eve's in-tab voice machine. `eve` now only carries the DEEP surfaces (developing/design); the
  // default (eve null or state 'home') is EveHome. Summons from anywhere (the composer's site tile,
  // deep links) land here; the bus queues any summon fired before this tab mounts.
  const [eve, setEve] = useState<EveSummon | null>(null);
  useEffect(() => registerEveSummonListener((s) => setEve(s)), []);

  // The swipe-down brand deck.
  const [deckShown, setDeckShown] = useState(false);
  // Eve only listens when her tab is actually the active one (not just mounted-but-hidden by the
  // tab navigator) AND the brand deck isn't pulled down over her.
  const focused = usePathname().startsWith('/studio');
  // `design` is deliberately NOT deep: it renders as a translucent overlay ON TOP of EveHome so she
  // KEEPS LISTENING while you talk about the design. Swapping it in (the old behaviour) unmounted
  // EveHome, and useLiveVoice's cleanup killed the mic — she was mute on her own "voice" surface.
  const deep = eve?.state === 'developing';
  // The top-edge pull-down/handle is GONE (Joe, decided with the wheel, landed 2026-08-17): the
  // wheel's BRANDS spoke is the one way the deck opens. Two summons for one surface made the
  // wheel look optional and the handle haunted the top edge of every screenshot.

  // Deep-link from a tapped "changes ready" push → open that store's Console on the Edit tab (review).
  const reviewParams = useLocalSearchParams<{ reviewSlug?: string; reviewName?: string; mode?: string }>();
  const reviewHandled = useRef<string | null>(null);
  useEffect(() => {
    const slug = reviewParams.reviewSlug;
    if (slug && reviewHandled.current !== slug) {
      reviewHandled.current = slug;
      setDeckFocus({ slug });
      setDeckShown(true);
    }
  }, [reviewParams.reviewSlug, reviewParams.reviewName]);
  // Legacy ?mode=interview deep link → straight into the voice surface.
  const modeHandled = useRef(false);
  useEffect(() => {
    if (reviewParams.mode === 'interview' && !modeHandled.current) {
      modeHandled.current = true;
      setEve({ state: 'home' });
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

  // Resolve whether this creator has any brands (gates the swipe-down deck). EveHome does its own
  // /api/me fetch; this one just decides deck availability + the loading spinner.
  useEffect(() => {
    if (!session) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch(apiUrl('/api/me'), { headers: { Authorization: `Bearer ${session.access_token}` } });
        const d = await readJson<{ stores?: unknown[] }>(r);
        if (alive) setHasStore((d.stores?.length ?? 0) > 0);
      } catch {
        /* leave hasStore false */
      } finally {
        if (alive) setVoiceResolved(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [session]);

  // "Build a new brand" (from the deck) — close the deck; EveHome is the default surface underneath,
  // already listening. The user just tells her what to build.
  const onNewBrand = useCallback(() => {
    setDeckShown(false);
    setEve(null);
  }, []);

  // Native tab bar sits above the home indicator; reserve its height + the inset + a
  // comfortable gap so the last row of the dashboard never dips under it.
  // The tab bar FLOATS now (frosted glass) — reserve its height + the home indicator so the
  // dashboard's last row never hides beneath it.
  const bottomPad = BottomTabInset + insets.bottom + Spacing.two;

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

      {/* The paywall stays mounted for a signed-in creator (gated by `visible`). The old standalone
          console Modal is GONE — the deck embeds the console now (the merge, 2026-08-17). */}
      {session ? (
        <>
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

      {/* DEEP voice surfaces — full-screen, over everything. */}
      {session && eve?.state === 'developing' ? (
        <EveDeveloping
          url={typeof eve.payload?.url === 'string' ? eve.payload.url : undefined}
          slug={typeof eve.payload?.slug === 'string' ? eve.payload.slug : undefined}
          name={typeof eve.payload?.name === 'string' ? eve.payload.name : undefined}
          onExit={() => setEve(null)}
          onSubmitted={(slug) => {
            setEve(null);
            setDeckFocus({ slug });
            setDeckShown(true);
          }}
        />
      ) : !deep ? (
        loading ? (
          // AUTH IS STILL RESTORING (Joe, 2026-08-18: "always shows create account for a split
          // second"). session is null while the stored session rehydrates, so the signed-out gate
          // used to win the first frame(s) of every cold start. Hold the quiet ground instead —
          // we don't know which surface this is yet.
          <>
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: EVE_SCRIM }]} />
            <ActivityIndicator style={styles.center} color="#cdd1d9" />
          </>
        ) : !session ? (
          // Signed-out gate — dim Eve with the scrim so the copy reads.
          <>
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: EVE_SCRIM }]} />
            <View style={[styles.content, { paddingTop: insets.top + Spacing.four, paddingBottom: bottomPad }]}>
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
            </View>
          </>
        ) : !voiceResolved ? (
          <>
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: EVE_SCRIM }]} />
            <ActivityIndicator style={styles.center} color="#cdd1d9" />
          </>
        ) : (
          // Signed-in DEFAULT — talk to Eve. Her mic is live only while this tab is focused and the
          // deck is closed. Swipe down (or tap the top handle) reveals the brand deck over her.
          <>
            {/* `covered` is the ONE signal for "something is layered over her". It used to be the
                deck alone, so opening a brand's console restarted her session and she narrated the
                editor (D-20). Every surface that sits on top of her must feed this. */}
            {/* `hidden` is PIXELS ONLY, never her session. Her own full-screen states (design,
                developing) sit on top of home, so its chrome must not print through — but the live
                session and the vision listener live in EveHome and the overlay publishes to them
                (see lib/eve-vision-bus). Suspending her here would mute her for the whole design
                flow and stop her ever SEEING what she made. `covered` is for surfaces she must not
                narrate; her own are not among them. */}
            <EveHome
              open={focused}
              covered={deckShown || !!paywall || welcomeVisible}
              hidden={!!eve}
              onRequestClose={() => setEve(null)}
              onGo={setEve}
              onShowBrands={() => setDeckShown(true)}
            />
            {hasStore ? (
              <>
                <BrandDeck
                  shown={deckShown}
                  focus={deckFocus}
                  token={session.access_token}
                  refreshKey={dashKey}
                  onClose={() => { setDeckShown(false); setDeckFocus(null); }}
                  onBounty={(panel, slot) => { setDeckShown(false); router.navigate(`/design?panel=${panel}${slot ? `&slot=${slot}` : ''}`); }}
                />
              </>
            ) : null}
          </>
        )
      ) : null}

      {/* DESIGN — the translucent popup Eve SPAWNS over her own screen. EveHome stays mounted
          underneath (see `deep` above), so her mic keeps listening and you just talk about what she
          made: "put it on a hoodie". The scrim is see-through on purpose — her orb glows behind it,
          so it reads as her holding the design up rather than a screen you navigated to. */}
      {session && eve?.state === 'design' ? (
        <View style={StyleSheet.absoluteFill}>
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.designScrim]} />
          <EveDesign
            idea={typeof eve.payload?.idea === 'string' ? eve.payload.idea : undefined}
            onExit={() => setEve(null)}
          />
        </View>
      ) : null}

      {/* SITE ASSETS — the ASSETS spoke's surface, same shape as DESIGN: she spawns it over
          herself, stays live underneath, and the graphic lands straight on the website. */}
      {session && eve?.state === 'assets' ? (
        <View style={StyleSheet.absoluteFill}>
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.designScrim]} />
          <EveAssets
            idea={typeof eve.payload?.idea === 'string' ? eve.payload.idea : undefined}
            slot={
              eve.payload?.slot === 'hero' || eve.payload?.slot === 'logo' || eve.payload?.slot === 'mark' || eve.payload?.slot === 'favicon' || eve.payload?.slot === 'og'
                ? eve.payload.slot
                : undefined
            }
            storeSlug={typeof eve.payload?.storeSlug === 'string' ? eve.payload.storeSlug : undefined}
            onExit={() => setEve(null)}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 }, // transparent — the global AppBackground (in _layout) shows through
  content: { flex: 1, paddingHorizontal: Spacing.four },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  introWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four },
  introTag: { letterSpacing: 3, fontSize: 10, marginTop: Spacing.two },
  introTitle: { fontSize: 30, fontFamily: SERIF, letterSpacing: 0.5 },
  introBody: { textAlign: 'center', maxWidth: 320, lineHeight: 22 },
  ctaPrimary: { backgroundColor: '#cdd1d9', borderRadius: 14, paddingVertical: Spacing.three, paddingHorizontal: Spacing.six, alignItems: 'center', marginTop: Spacing.three },
  ctaSecondary: { paddingVertical: Spacing.two },
  ctaSecondaryText: { color: '#9396a0' },
  introFoot: { color: '#9396a0', fontSize: 12, marginTop: Spacing.three, textAlign: 'center' },

  // Translucent bed for the design popup — dark enough that the artwork and Eve's line read, sheer
  // enough that her orb still shows through underneath (she's holding it up, not replacing herself).
  designScrim: { backgroundColor: 'rgba(6,8,15,0.78)' },

  // The always-armed top-edge zone that reveals the brand deck (pull down or tap the pill).
});
