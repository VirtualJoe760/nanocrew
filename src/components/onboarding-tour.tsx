import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';

import { ThemedText } from '@/components/themed-text';
import { GlowButton } from '@/components/glow-button';
import { usePalette } from '@/components/nc-screen';
import { Spacing } from '@/constants/theme';
import { apiUrl, readJson } from '@/lib/api';
import { glow } from '@/constants/glow';
import { type Rect, useTourAnchorRects } from '@/components/tour-anchors';

// Guided coachmark tour: dims the app and SPOTLIGHTS the exact thing to tap — either a real on-screen
// button (measured via <TourAnchor>, so the highlight lands dead-on) or a bottom tab (the native
// UITabBar can't be measured from JS, so those use bar geometry). Venus NARRATES each step in her own
// voice (/api/say, Aoede). Next/Skip; first-run + re-openable from a "?" affordance. Self-contained —
// owns its own audio player so it can run from anywhere without the Studio session.

type TabKey = 'studio' | 'design' | 'market' | 'account';
const TAB_ORDER: TabKey[] = ['studio', 'design', 'market', 'account'];

// A step highlights AT MOST one target: an `anchor` (a measured on-screen button — preferred, exact)
// or a `tab` (the native bottom bar — geometry-based). With neither, the card centers (intro/outro).
type Step = { tab?: TabKey; anchor?: string; title: string; body: string; say: string };

// ACT 1 — the first-run tab overview (runs on first sign-in).
export const TOUR_STEPS: Step[] = [
  {
    title: 'Hi, I’m Venus',
    body: 'I’ll help you start a real clothing brand — right from your phone. Let me show you around in a few seconds.',
    say: 'Hi, I’m Venus. I’ll help you start a real clothing brand, right from your phone. Let me show you around.',
  },
  {
    tab: 'studio',
    title: 'Studio — talk to me',
    body: 'This is home. Tell me your idea out loud and I’ll name your brand, design its identity, and spin up a whole store and website with you.',
    say: 'This is Studio — your home base. Just talk to me, and I’ll build your brand, your store, and your website with you.',
  },
  {
    tab: 'design',
    title: 'Design — make products',
    body: 'Generate artwork or bring your own, drop it onto real apparel, and publish it for sale — print-ready, no inventory.',
    say: 'Design is where you make products. Generate artwork, drop it on real apparel, and publish it for sale.',
  },
  {
    tab: 'market',
    title: 'Market — discover & sell',
    body: 'Browse brands and shop right here. Your own brand shows up here too once you publish it.',
    say: 'Market is where you discover and sell. Browse brands, and your own brand shows up here once you publish.',
  },
  {
    tab: 'account',
    title: 'Account — plan & settings',
    body: 'Your plan, credits, payouts and settings live here whenever you need them.',
    say: 'And Account holds your plan, your credits, and your settings, whenever you need them.',
  },
  {
    tab: 'studio',
    title: 'Let’s build your brand',
    body: 'That’s the tour. Tap Studio whenever you’re ready and just start talking — I’ll take it from there.',
    say: 'That’s the tour. Tap Studio whenever you’re ready, and just start talking. I’ll take it from there.',
  },
];

// ACT 2 — the build journey, runs ONCE after the first brand is created. Walks through finishing the
// store + site, in order. The hero/logo steps point straight at the real "Finish your site" buttons
// (anchored); products/publish point at the Design/Market tabs. Narrated by Venus.
export const JOURNEY_STEPS: Step[] = [
  {
    title: 'Your brand is built 🎉',
    body: 'This is your Studio dashboard — your command center. Let’s finish the important bits together, one at a time.',
    say: 'Your brand is built! This is your Studio dashboard, your command center. Let’s finish the important bits together.',
  },
  {
    anchor: 'finish-hero',
    title: 'Design your hero image',
    body: 'Your site needs a hero — the big image up top. Tap this to generate it with me.',
    say: 'First, your hero image — the big picture at the top of your site. Tap “Design your website hero,” and I’ll generate it with you.',
  },
  {
    anchor: 'finish-logo',
    title: 'Add your logo',
    body: 'Next, your logo. Tap here to drop in your own mark, or have me create one.',
    say: 'Next, your logo. Tap “Add your logo” to drop in your own, or have me create one for you.',
  },
  {
    tab: 'design',
    title: 'Create your first products',
    body: 'Open the Design tab, generate artwork or bring your own, drop it on a tee or hoodie, and publish it — print-ready, no inventory.',
    say: 'Now, your first products. Open the Design tab, make some artwork, drop it on a tee or hoodie, and publish it. We print and ship every order.',
  },
  {
    tab: 'market',
    title: 'Publish to the Market',
    body: 'Once you have a product, publish your store so people can find and buy it right inside the app’s Market.',
    say: 'Once you have a product, publish your store to the Market, so people can find and buy it right here in the app.',
  },
  {
    title: 'Take your website live',
    body: 'Finally, go live on the web — connect a domain and flip your site on from your brand card. That’s the whole journey!',
    say: 'And finally, take your website live. Connect a domain and flip your site on from your brand card. That’s the whole journey — you’ve got this.',
  },
];

// Native iOS UITabBar geometry (can't be measured from JS). 4 items are evenly distributed across the
// full width; the bar is ~49pt tall and sits directly above the home indicator (insets.bottom).
const TAB_BAR_H = 48; // height of the ring around a tab — frames the icon+label cluster
const TAB_BAR_LIFT = 2; // the cluster sits a little above the home indicator, so lift the ring off the very bottom
// Measured native UITabBar item centers as a fraction of screen width. The bar can't be measured from
// JS, and its 4 items are NOT at width/4 — they're inset and spaced wider. These are calibrated from
// the real icons (iPhone) and hold closely across iPhone widths. Index matches TAB_ORDER.
const TAB_CENTER_FRAC = [0.16, 0.397, 0.634, 0.871];
const HOLE_PAD = Spacing.two; // breathing room around an anchored button, so the ring frames it rather than clips it
const CARD_GAP = Spacing.three;
const CARD_EST_H = 150; // approximate tooltip height for placement math

export function OnboardingTour({
  visible,
  onClose,
  accessToken,
  steps = TOUR_STEPS,
}: {
  visible: boolean;
  onClose: () => void;
  accessToken?: string;
  /** Which act to run — TOUR_STEPS (tab overview, default) or JOURNEY_STEPS (post-brand build journey). */
  steps?: Step[];
}) {
  const p = usePalette();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const anchorRects = useTourAnchorRects();
  const [i, setI] = useState(0);
  const [cardH, setCardH] = useState(CARD_EST_H); // real tooltip height, measured on layout (placement depends on it)
  const player = useAudioPlayer();
  const playGen = useRef(0);
  const fileN = useRef(0);
  const pulse = useRef(new Animated.Value(0)).current;

  const step = steps[i];
  const last = i === steps.length - 1;

  // Narrate the current step in Venus's voice (best-effort — the tour works silently if it fails).
  const narrate = useCallback(
    async (text: string) => {
      if (!accessToken) return;
      const gen = ++playGen.current;
      try {
        const v = await fetch(apiUrl('/api/say'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ text }),
        });
        const s = await readJson<{ audio?: string }>(v);
        if (!s.audio || gen !== playGen.current) return;
        const file = `${FileSystem.cacheDirectory}tour-${fileN.current++}.wav`;
        await FileSystem.writeAsStringAsync(file, s.audio, { encoding: FileSystem.EncodingType.Base64 });
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        if (gen !== playGen.current) return;
        player.replace(file);
        for (let t = 0; t < 25 && !player.isLoaded; t++) {
          await new Promise((r) => setTimeout(r, 100));
          if (gen !== playGen.current) return;
        }
        if (gen === playGen.current) player.play();
      } catch {
        /* narration is optional */
      }
    },
    [accessToken, player],
  );

  // Reset to step 0 each time the tour opens; stop audio when it closes.
  useEffect(() => {
    if (visible) setI(0);
    else {
      playGen.current++;
      try { player.pause(); } catch {}
    }
  }, [visible, player]);

  // Narrate whenever the step changes (while open).
  useEffect(() => {
    if (visible) void narrate(step.say);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, i]);

  // Pulse the spotlight ring so it clearly reads as "tap here" (loops while the tour is open).
  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 850, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 850, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, pulse]);

  const finish = useCallback(() => {
    playGen.current++;
    try { player.pause(); } catch {}
    onClose();
  }, [onClose, player]);

  const next = useCallback(() => {
    if (last) finish();
    else setI((v) => v + 1);
  }, [last, finish]);

  if (!visible) return null;

  // ── Resolve the highlight rect (window coords) for this step ──────────────────────────────────
  // 1) a measured on-screen button (exact), else 2) a native tab (bar geometry), else 3) nothing.
  const pad = (r: Rect): Rect => ({ x: r.x - HOLE_PAD, y: r.y - HOLE_PAD, width: r.width + HOLE_PAD * 2, height: r.height + HOLE_PAD * 2 });
  let hole: Rect | null = null;
  if (step.anchor && anchorRects[step.anchor]) {
    hole = pad(anchorRects[step.anchor]); // an in-screen button (exact)
  } else if (step.tab && anchorRects[`tab-${step.tab}`]) {
    hole = pad(anchorRects[`tab-${step.tab}`]); // the JS tab bar registers each tab — EXACT, no geometry guessing
  } else if (step.tab) {
    // Fallback geometry, only used for the first frame before the tab anchor has measured (or on a
    // platform whose bar doesn't register anchors). Calibrated to the native bar's real icon centers.
    const idx = TAB_ORDER.indexOf(step.tab);
    const center = width * (TAB_CENTER_FRAC[idx] ?? (idx + 0.5) / TAB_ORDER.length);
    const ringW = Math.min(width * 0.21, 92);
    const barTop = height - insets.bottom - TAB_BAR_LIFT - TAB_BAR_H;
    hole = { x: center - ringW / 2, y: barTop, width: ringW, height: TAB_BAR_H };
  }

  // Tooltip placement — uses the MEASURED card height so the card never overlaps the target. Card
  // sits above a low target / below a high one, with the caret glued to the card's edge nearest it.
  const CARET_H = 9;
  const cardLeft = Spacing.four;
  const cardRight = width - Spacing.four;
  let cardTop: number;
  let caret: { x: number; top: number; pointsDown: boolean } | null = null;
  if (hole) {
    const holeMid = hole.y + hole.height / 2;
    const cx = Math.max(cardLeft + 16, Math.min(hole.x + hole.width / 2, cardRight - 16));
    const pointsDown = holeMid > height * 0.5;
    cardTop = pointsDown
      ? hole.y - CARD_GAP - CARET_H - cardH // card ABOVE the target
      : hole.y + hole.height + CARD_GAP + CARET_H; // card BELOW the target
    cardTop = Math.max(insets.top + Spacing.two, Math.min(cardTop, height - insets.bottom - cardH - Spacing.two));
    caret = { x: cx, top: pointsDown ? cardTop + cardH : cardTop - CARET_H, pointsDown };
  } else {
    cardTop = (height - cardH) / 2; // intro/outro: centered
  }

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });
  const dim = 'rgba(0,0,0,0.78)';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={finish}>
      {/* Full-screen tap layer — tap anywhere advances. */}
      <Pressable style={styles.fill} onPress={next}>
        {hole ? (
          <>
            {/* Spotlight: four dim panels around the target leave a bright, un-dimmed cut-out over it. */}
            <View pointerEvents="none" style={[styles.dimRect, { backgroundColor: dim, top: 0, left: 0, right: 0, height: hole.y }]} />
            <View pointerEvents="none" style={[styles.dimRect, { backgroundColor: dim, top: hole.y + hole.height, left: 0, right: 0, bottom: 0 }]} />
            <View pointerEvents="none" style={[styles.dimRect, { backgroundColor: dim, top: hole.y, left: 0, width: hole.x, height: hole.height }]} />
            <View pointerEvents="none" style={[styles.dimRect, { backgroundColor: dim, top: hole.y, left: hole.x + hole.width, right: 0, height: hole.height }]} />

            {/* Pulsing ring framing the cut-out. */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.ring,
                {
                  left: hole.x,
                  top: hole.y,
                  width: hole.width,
                  height: hole.height,
                  borderColor: p.accent,
                  opacity: ringOpacity,
                  transform: [{ scale: ringScale }],
                },
                glow(p.accent, 20, 0.7),
              ]}
            />

            {/* Caret glued to the card edge, pointing at the target. */}
            {caret ? (
              <View
                pointerEvents="none"
                style={[
                  caret.pointsDown ? styles.caretDown : styles.caretUp,
                  { left: caret.x - 7, top: caret.top },
                  caret.pointsDown ? { borderTopColor: p.accent } : { borderBottomColor: p.accent },
                ]}
              />
            ) : null}
          </>
        ) : (
          // No target — dim the whole screen.
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: dim }]} />
        )}

        {/* Tooltip card — measures itself so placement above can react to its real height. */}
        <View
          onLayout={(e) => setCardH(e.nativeEvent.layout.height)}
          style={[styles.card, { top: cardTop, backgroundColor: p.bgTop, borderColor: p.line }]}>

          <View style={styles.cardHead}>
            <Image source={require('@/assets/brand/venus-portrait.png')} style={styles.venus} contentFit="cover" />
            <View style={styles.flex}>
              <ThemedText type="smallBold" style={{ color: p.ink }}>{step.title}</ThemedText>
              <ThemedText type="small" style={{ color: p.dim, marginTop: 2 }}>{step.body}</ThemedText>
            </View>
          </View>
          <View style={styles.cardFoot}>
            {/* step dots */}
            <View style={styles.dots}>
              {steps.map((_, n) => (
                <View key={n} style={[styles.dot, { backgroundColor: n === i ? p.accent : `${p.dim}55` }]} />
              ))}
            </View>
            <View style={styles.actions}>
              {!last ? <GlowButton label="Skip" variant="ghost" onPress={finish} /> : null}
              <GlowButton label={last ? 'Start' : 'Next'} variant="primary" onPress={next} />
            </View>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  dimRect: { position: 'absolute' },
  ring: { position: 'absolute', borderWidth: 2.5, borderRadius: 16 },
  caretDown: { position: 'absolute', width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 9, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  caretUp: { position: 'absolute', width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderBottomWidth: 9, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  card: { position: 'absolute', left: Spacing.four, right: Spacing.four, borderRadius: 18, borderWidth: 1, padding: Spacing.four },
  cardHead: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-start' },
  venus: { width: 46, height: 46, borderRadius: 23 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.four },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
});
