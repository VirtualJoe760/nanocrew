import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Line, Path, RadialGradient, Stop } from 'react-native-svg';
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

type EntityState = 'idle' | 'listening' | 'thinking' | 'speaking';

// Dark ink used for text ON the gold accent buttons — gold is light, so dark text reads in
// both modes. (The screen background comes from the palette below.)
const BG = '#08080a';
const ONBOARD_SEEN_KEY = 'nc_welcome_seen';
const ONBOARD_INTENT_KEY = 'nc_onboard_intent';
// idle → listening → thinking → speaking. Champagne gold resting, brightening to near-white
// as Venus speaks — monochrome + gold, per the Nano Crew brand.
const STATE_COLORS = ['#cdd1d9', '#e8eaee', '#dfe2e8', '#ffffff'];
const STATE_INDEX: Record<EntityState, number> = { idle: 0, listening: 1, thinking: 2, speaking: 3 };

const MONO = 'Jost-Regular'; // mono label motif retired — unified on Jost
const SERIF = 'Jost-Light'; // display title face (was Georgia serif; unified on Jost)
// Palette + the silk FabricBackground + the NC mark now live in @/components/nc-screen so Studio,
// Design, Market, and Account all share one look (imported above).
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ---------- Network mesh ----------

type Node = { x: number; y: number; r: number };
type Edge = { a: Node; b: Node };

function buildMesh(count: number, w: number, h: number, linkDist: number): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = Array.from({ length: count }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: 1 + Math.random() * 1.8,
  }));
  const edges: Edge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      if (Math.sqrt(dx * dx + dy * dy) < linkDist) edges.push({ a: nodes[i], b: nodes[j] });
    }
  }
  return { nodes, edges };
}

/** Faint network threading through the whole background, slowly breathing. */
function NetworkField() {
  const p = usePalette();
  const mesh = useMemo(() => buildMesh(26, SCREEN_W, SCREEN_H, 150), []);
  const breath = useSharedValue(0.5);
  useEffect(() => {
    breath.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 4200, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.45, { duration: 4200, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    );
    return () => cancelAnimation(breath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: breath.value }));
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width={SCREEN_W} height={SCREEN_H}>
        {mesh.edges.map((e, i) => (
          <Line key={`e${i}`} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} stroke={p.accent} strokeOpacity={p.dark ? 0.09 : 0.16} strokeWidth={0.7} />
        ))}
        {mesh.nodes.map((n, i) => (
          <Circle key={`n${i}`} cx={n.x} cy={n.y} r={n.r} fill={p.accent} fillOpacity={p.dark ? 0.22 : 0.32} />
        ))}
      </Svg>
    </Animated.View>
  );
}

// ---------- Spatial dust ----------

type Dust = { x: number; y: number; r: number; o: number; c: string };

function buildDust(count: number, rMax: number): Dust[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * (SCREEN_W + 60) - 30,
    y: Math.random() * (SCREEN_H + 60) - 30,
    r: 0.4 + Math.random() * rMax,
    o: 0.08 + Math.random() * 0.5,
    c: pick(TONES),
  }));
}

/** A full-screen field of motes drifting as one — layered at different speeds for depth. */
function DustField({
  count,
  rMax,
  driftX,
  driftY,
  period,
}: {
  count: number;
  rMax: number;
  driftX: number;
  driftY: number;
  period: number;
}) {
  const dust = useMemo(() => buildDust(count, rMax), [count, rMax]);
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(
      withSequence(
        withTiming(1, { duration: period, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: period, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    );
    return () => cancelAnimation(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: 0.55 + t.value * 0.45,
    transform: [{ translateX: t.value * driftX }, { translateY: t.value * driftY }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width={SCREEN_W} height={SCREEN_H}>
        {dust.map((d, i) => (
          <Circle key={i} cx={d.x} cy={d.y} r={d.r} fill={d.c} fillOpacity={d.o} />
        ))}
      </Svg>
    </Animated.View>
  );
}

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

/** A calm, static holographic mark for the signed-out CTA — Venus at rest. */
function IntroGlyph() {
  return (
    <Svg width={96} height={96}>
      <Defs>
        <RadialGradient id="intro" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#f4f4f6" stopOpacity={1} />
          <Stop offset="40%" stopColor="#cdd1d9" stopOpacity={0.85} />
          <Stop offset="100%" stopColor="#cdd1d9" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={48} cy={48} r={46} fill="none" stroke="#cdd1d9" strokeWidth={0.6} opacity={0.25} />
      <Circle cx={48} cy={48} r={34} fill="none" stroke="#e8eaee" strokeWidth={0.6} opacity={0.3} />
      <Circle cx={48} cy={48} r={20} fill="url(#intro)" />
    </Svg>
  );
}

// ---------- Nano Crew mark: the crewcut ----------

const MARK = 88;
// Buzz crown: vertical bristles rising off the head's top arc. The center five end on a
// dead-flat line (the flat top); the outer pair fades shorter (the taper).
const HEAD_CX = 44;
const HEAD_CY = 50;
const HEAD_R = 25;
const BRISTLES = [-16, -11, -6, -1, 5, 10, 15].map((dx, i, arr) => {
  const onArc = HEAD_CY - Math.sqrt(HEAD_R * HEAD_R - dx * dx) + 1;
  const isFade = i === 0 || i === arr.length - 1;
  return { x: HEAD_CX + dx, y1: onArc, y2: isFade ? 19 : 13 };
});

/** The Nano Crew crewcut: a minimal head with a flat-top buzz crown and a nucleus within. */
function NanocrewMark({ color }: { color: string }) {
  return (
    <Svg width={MARK} height={MARK}>
      {/* head */}
      <Circle cx={HEAD_CX} cy={HEAD_CY} r={HEAD_R} stroke={color} strokeWidth={2.2} fill="none" strokeOpacity={0.9} />
      {/* the crewcut */}
      {BRISTLES.map((b, i) => (
        <Line key={i} x1={b.x} y1={b.y1} x2={b.x} y2={b.y2} stroke={color} strokeWidth={3} strokeLinecap="round" />
      ))}
      {/* the nucleus within */}
      <Circle cx={HEAD_CX} cy={HEAD_CY} r={4} fill={color} />
      <Circle cx={HEAD_CX} cy={HEAD_CY} r={10} stroke={color} strokeWidth={1} fill="none" strokeOpacity={0.45} />
    </Svg>
  );
}

// ---------- The nucleus: a JARVIS-grade orb ----------
// Density without cost: each layer is a STATIC dense SVG (hundreds of arcs/ticks/
// particles/links) animated as a whole — counter-rotation + parallax make it live.

const WEB_SIZE = 320;
const WEB_C = WEB_SIZE / 2;

const TONES = ['#cdd1d9', '#e8eaee', '#dfe2e8', '#9396a0'];
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

function arcPath(r: number, a0: number, a1: number): string {
  const x0 = WEB_C + Math.cos(a0) * r;
  const y0 = WEB_C + Math.sin(a0) * r;
  const x1 = WEB_C + Math.cos(a1) * r;
  const y1 = WEB_C + Math.sin(a1) * r;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

type OrbSpec = {
  arcs: { d: string; w: number; o: number; c: string }[];
  ticks: { x1: number; y1: number; x2: number; y2: number; o: number; c: string }[];
  links: { x1: number; y1: number; x2: number; y2: number; o: number }[];
  dots: { x: number; y: number; r: number; o: number; c: string }[];
};

function buildOrbLayer(rMin: number, rMax: number, density: number): OrbSpec {
  const arcs: OrbSpec['arcs'] = [];
  const ticks: OrbSpec['ticks'] = [];
  const links: OrbSpec['links'] = [];
  const dots: OrbSpec['dots'] = [];

  // Broken arc segments at many radii — the "tech rings".
  for (let i = 0; i < Math.round(14 * density); i++) {
    const r = rMin + Math.random() * (rMax - rMin);
    const start = Math.random() * Math.PI * 2;
    const span = 0.2 + Math.random() * 1.6;
    arcs.push({ d: arcPath(r, start, start + span), w: 0.5 + Math.random() * 1.1, o: 0.12 + Math.random() * 0.4, c: pick(TONES) });
  }
  // Tick clusters along invisible circles — instrument detail.
  for (let i = 0; i < Math.round(10 * density); i++) {
    const r = rMin + Math.random() * (rMax - rMin);
    const base = Math.random() * Math.PI * 2;
    const count = 4 + Math.floor(Math.random() * 9);
    for (let t = 0; t < count; t++) {
      const a = base + t * 0.045;
      const len = 2 + Math.random() * 5;
      ticks.push({
        x1: WEB_C + Math.cos(a) * r,
        y1: WEB_C + Math.sin(a) * r,
        x2: WEB_C + Math.cos(a) * (r + len),
        y2: WEB_C + Math.sin(a) * (r + len),
        o: 0.18 + Math.random() * 0.42,
        c: pick(TONES),
      });
    }
  }
  // Interconnecting chords — links across the structure.
  for (let i = 0; i < Math.round(9 * density); i++) {
    const r1 = rMin + Math.random() * (rMax - rMin);
    const r2 = rMin + Math.random() * (rMax - rMin);
    const a1 = Math.random() * Math.PI * 2;
    const a2 = a1 + (Math.random() - 0.5) * 2.2;
    links.push({
      x1: WEB_C + Math.cos(a1) * r1,
      y1: WEB_C + Math.sin(a1) * r1,
      x2: WEB_C + Math.cos(a2) * r2,
      y2: WEB_C + Math.sin(a2) * r2,
      o: 0.08 + Math.random() * 0.2,
    });
  }
  // Particle dust, denser toward the inner radius.
  for (let i = 0; i < Math.round(70 * density); i++) {
    const r = rMin + Math.pow(Math.random(), 1.6) * (rMax - rMin);
    const a = Math.random() * Math.PI * 2;
    dots.push({
      x: WEB_C + Math.cos(a) * r,
      y: WEB_C + Math.sin(a) * r,
      r: 0.5 + Math.random() * 1.4,
      o: 0.15 + Math.random() * 0.65,
      c: pick(TONES),
    });
  }
  return { arcs, ticks, links, dots };
}

function OrbLayerSvg({ spec }: { spec: OrbSpec }) {
  return (
    <Svg width={WEB_SIZE} height={WEB_SIZE}>
      {spec.links.map((l, i) => (
        <Line key={`l${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#cdd1d9" strokeOpacity={l.o} strokeWidth={0.5} />
      ))}
      {spec.arcs.map((a, i) => (
        <Path key={`a${i}`} d={a.d} stroke={a.c} strokeOpacity={a.o} strokeWidth={a.w} fill="none" />
      ))}
      {spec.ticks.map((t, i) => (
        <Line key={`t${i}`} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={t.c} strokeOpacity={t.o} strokeWidth={0.7} />
      ))}
      {spec.dots.map((d, i) => (
        <Circle key={`d${i}`} cx={d.x} cy={d.y} r={d.r} fill={d.c} fillOpacity={d.o} />
      ))}
    </Svg>
  );
}

/** One dense layer, spun and breathed as a whole. */
function OrbLayer({
  spec,
  duration,
  direction,
  level,
  drift,
}: {
  spec: OrbSpec;
  duration: number;
  direction: 1 | -1;
  level: SharedValue<number>;
  drift: number;
}) {
  const spin = useSharedValue(0);
  useEffect(() => {
    spin.value = withRepeat(withTiming(360 * direction, { duration, easing: Easing.linear }), -1);
    return () => cancelAnimation(spin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: 0.62 + level.value * 0.38,
    transform: [{ rotate: `${spin.value}deg` }, { scale: 1 + level.value * drift }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.web, style]}>
      <OrbLayerSvg spec={spec} />
    </Animated.View>
  );
}

const WAVE_BARS = 28;
const WAVE_MULTS = Array.from({ length: WAVE_BARS }, (_, i) => 0.45 + Math.abs(Math.sin(i * 2.7)) * 0.55);

/** One radial bar of the sound-wave ring; length rides the live audio level. */
function WaveBar({ index, level, color }: { index: number; level: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${(index / WAVE_BARS) * 360}deg` },
      { translateY: -132 },
      { scaleY: 0.18 + level.value * WAVE_MULTS[index] * 2.4 },
    ],
  }));
  return <Animated.View style={[styles.waveBar, { backgroundColor: color }, style]} />;
}

/** The blinding center: layered light with a white-hot heart, swelling with the audio. */
function CoreLight({ level, color, inner }: { level: SharedValue<number>; color: string; inner: string }) {
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + level.value * 0.45 }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.coreLight, style]}>
      <Svg width={120} height={120}>
        <Defs>
          <RadialGradient id="bloom" cx="50%" cy="50%" r="50%">
            {/* core is white-hot on dark, a saturated cyan on light (white vanishes on white) */}
            <Stop offset="0%" stopColor={inner} stopOpacity="1" />
            <Stop offset="28%" stopColor={inner} stopOpacity="0.9" />
            <Stop offset="52%" stopColor={color} stopOpacity="0.55" />
            <Stop offset="100%" stopColor={color} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx={60} cy={60} r={60} fill="url(#bloom)" />
      </Svg>
    </Animated.View>
  );
}

/**
 * The nucleus: a dense, layered orb of particles, broken rings, ticks and links —
 * counter-rotating around a nucleus of light. The wave ring and core ride the live
 * audio: HER voice while speaking, YOURS while listening.
 */
function Nucleus({
  state,
  level,
  onPress,
}: {
  state: EntityState;
  level: SharedValue<number>;
  onPress: () => void;
}) {
  const p = usePalette();
  const color = STATE_COLORS[STATE_INDEX[state]];
  const layers = useMemo(
    () => [
      buildOrbLayer(96, 152, 1.4), // outer halo — finest, sparsest
      buildOrbLayer(58, 112, 1.7), // mid machinery — densest band
      buildOrbLayer(24, 70, 1.1), // inner works
    ],
    [],
  );

  return (
    <Pressable onPress={onPress} hitSlop={30} style={styles.nucleusWrap}>
      <OrbLayer spec={layers[0]} duration={74000} direction={1} level={level} drift={0.05} />
      <OrbLayer spec={layers[1]} duration={46000} direction={-1} level={level} drift={0.09} />
      <OrbLayer spec={layers[2]} duration={28000} direction={1} level={level} drift={0.14} />
      {Array.from({ length: WAVE_BARS }, (_, i) => (
        <WaveBar key={i} index={i} level={level} color={color} />
      ))}
      <CoreLight level={level} color={color} inner={p.coreInner} />
    </Pressable>
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
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: '#9396a0', letterSpacing: 1 },
  signInNote: { color: '#9396a0', textAlign: 'center', fontFamily: MONO, fontSize: 14, lineHeight: 22 },
  introWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four },
  introTag: { letterSpacing: 3, fontSize: 10, marginTop: Spacing.two },
  introTitle: { fontSize: 30, fontFamily: SERIF, letterSpacing: 0.5 },
  introBody: { textAlign: 'center', maxWidth: 320, lineHeight: 22 },
  ctaPrimary: { backgroundColor: '#cdd1d9', borderRadius: 14, paddingVertical: Spacing.three, paddingHorizontal: Spacing.six, alignItems: 'center', marginTop: Spacing.three },
  ctaSecondary: { paddingVertical: Spacing.two },
  ctaSecondaryText: { color: '#9396a0' },
  busyBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.65)', padding: Spacing.four },
  busyCard: { width: '100%', maxWidth: 360, borderRadius: 18, borderWidth: 1, paddingVertical: Spacing.five, paddingHorizontal: Spacing.four, alignItems: 'center' },
  busyEyebrow: { fontSize: 11, letterSpacing: 1.5, marginBottom: Spacing.two },
  busyTitle: { fontSize: 22, lineHeight: 26, marginBottom: Spacing.two, textAlign: 'center' },
  busyBody: { textAlign: 'center', lineHeight: 20, marginBottom: Spacing.four },
  busyPrimary: { alignSelf: 'stretch', borderRadius: 14, paddingVertical: Spacing.three, alignItems: 'center' },
  busySecondary: { paddingVertical: Spacing.three, marginTop: Spacing.one },
  introFoot: { color: '#9396a0', fontSize: 12, marginTop: Spacing.three, textAlign: 'center' },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  markBadge: { transform: [{ scale: 0.32 }], width: 28, height: 28, marginLeft: -28, marginRight: -22 },
  entityArea: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.four },
  // Avatar mode: she fills the upper screen, so push the hint/pause/build controls to the bottom.
  entityAreaAvatar: { justifyContent: 'flex-end' },

  nucleusWrap: { width: WEB_SIZE, height: WEB_SIZE, alignItems: 'center', justifyContent: 'center' },
  web: { position: 'absolute', width: WEB_SIZE, height: WEB_SIZE },
  waveBar: { position: 'absolute', width: 2, height: 20, borderRadius: 1, opacity: 0.8 },
  coreLight: { position: 'absolute', width: 120, height: 120, alignItems: 'center', justifyContent: 'center' },
  corner: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderColor: '#3a3d44',
  },
  cornerTL: { left: 12, borderLeftWidth: 1.5, borderTopWidth: 1.5 },
  cornerTR: { right: 12, borderRightWidth: 1.5, borderTopWidth: 1.5 },
  cornerBL: { left: 12, borderLeftWidth: 1.5, borderBottomWidth: 1.5 },
  cornerBR: { right: 12, borderRightWidth: 1.5, borderBottomWidth: 1.5 },
  hint: { color: '#9396a0', letterSpacing: 1 },
  pausePill: { marginTop: Spacing.three, borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, alignSelf: 'center' },
  stagedBanner: { borderWidth: 1, borderRadius: 12, paddingVertical: Spacing.three, paddingHorizontal: Spacing.three, marginBottom: Spacing.three },
  finalizePill: { marginTop: Spacing.two, borderRadius: 999, paddingHorizontal: Spacing.five, paddingVertical: Spacing.three, alignSelf: 'center', minWidth: 180, alignItems: 'center' },
  headerSpacer: { flex: 1 },
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },

  captions: { gap: Spacing.two, paddingBottom: Spacing.four, marginBottom: Spacing.six, minHeight: 96 },
  heard: { color: '#56575e', textAlign: 'center' },
  bigWord: {
    color: '#f4f4f6',
    textAlign: 'center',
    fontFamily: MONO,
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '700',
  },
  line: { color: '#dfe2e8', textAlign: 'center', fontSize: 16, lineHeight: 23, fontFamily: MONO },
  errorBar: {
    position: 'absolute',
    left: Spacing.four,
    right: Spacing.four,
    alignItems: 'center',
    gap: 2,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: 16,
    backgroundColor: 'rgba(40,12,14,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ff5c5c55',
  },
  error: { color: '#ff8a8a', textAlign: 'center' },
  errorDismiss: { color: '#ff8a8a99', fontSize: 11, letterSpacing: 1 },

  // Scroll content must clear the native tab bar so the last action (Create my store /
  // Get started) is fully tappable and not intercepted by the bar.
  brandScroll: { gap: Spacing.three, paddingTop: Spacing.four, paddingBottom: BottomTabInset + Spacing.six },
  selectScroll: { gap: Spacing.three, paddingTop: Spacing.four, paddingBottom: BottomTabInset + Spacing.six },
  getStarted: { backgroundColor: '#cdd1d9', borderRadius: 14, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.three },
  logo: { width: 96, height: 96, borderRadius: 8, borderWidth: 1, borderColor: '#26282d' },
  brandEyebrow: { color: '#9396a0' },
  white: { color: '#f4f4f6' },
  dim: { color: '#9396a0' },
  green: { color: '#cdd1d9' },
  paletteRow: { flexDirection: 'row', gap: Spacing.two },
  swatchCol: { alignItems: 'center', gap: Spacing.one, flex: 1 },
  swatch: { width: '100%', aspectRatio: 1, borderRadius: 3 },
  swatchLabel: { fontSize: 10, color: '#9396a0' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderWidth: 1,
    borderColor: '#26282d',
    borderRadius: 3,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one,
  },
  chipText: { color: '#9396a0', fontSize: 11 },
  createBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    borderRadius: 4,
    minHeight: 48,
    backgroundColor: '#cdd1d9',
    gap: 2,
    marginTop: Spacing.two,
  },
  createdBox: { backgroundColor: '#141417' },
});
