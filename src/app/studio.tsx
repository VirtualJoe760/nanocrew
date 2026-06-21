import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  AppState,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useColorScheme,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import {
  AudioModule,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioSampleListener,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import Svg, { Circle, Defs, Line, LinearGradient, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { FabricBackground, NCMark, type Palette, usePalette } from '@/components/nc-screen';

import { BrandReview } from '@/components/brand-review';
import { ChatInterview } from '@/components/chat-interview';
import { StudioComposer } from '@/components/studio-composer';
import { StudioDashboard } from '@/components/studio-dashboard';
import { Paywall } from '@/components/paywall';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useLiveVoice } from '@/hooks/use-live-voice';
import { apiUrl, readJson } from '@/lib/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Welcome, type OnboardChoice } from '@/components/welcome';
import type { BrandResult, ChatMessage } from '@/lib/interview';

// Venus runs on Gemini Live (realtime speech-to-speech) — see docs/studio/GEMINI_LIVE.md.
const LIVE_VOICE = 'Aoede'; // warm Gemini voice — Venus's single voice (no picker)

// The Studio: a voice-first brand interview. A nano-entity — flickering pixel core inside
// counter-rotating rings, digital rain behind — talks you through building your brand. Venus
// listens + replies in realtime over Gemini Live (open-mic); tap the orb to pause.

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

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
const SERIF = Platform.select({ ios: 'Georgia', default: 'serif' });
// Palette + the silk FabricBackground + the NC mark now live in @/components/nc-screen so Studio,
// Design, Market, and Account all share one look (imported above).
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ---------- The circular nucleus (the Venus orb) ----------

/** The circular logo as the entity's nucleus: a thin gold ring around the NC monogram, on
 *  a soft glow. Optionally breathes with the live audio level (one cheap animated node). */
function NCNucleus({
  size,
  p,
  level,
  state,
  onPress,
  onPressIn,
  onPressOut,
}: {
  size: number;
  p: Palette;
  level?: SharedValue<number>;
  state?: EntityState;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
}) {
  const ring = state ? STATE_COLORS[STATE_INDEX[state]] : p.accent;
  const glow = useAnimatedStyle(() => {
    const v = level ? level.value : 0;
    return { opacity: 0.4 + v * 0.45, transform: [{ scale: 1 + v * 0.05 }] };
  });
  const r = size / 2;
  const body = (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[StyleSheet.absoluteFill, glow]} pointerEvents="none">
        <Svg width={size} height={size}>
          <Defs>
            <RadialGradient id="nuc-glow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={p.coreInner} stopOpacity={p.dark ? 0.5 : 0.35} />
              <Stop offset="55%" stopColor={p.accent} stopOpacity={0.18} />
              <Stop offset="100%" stopColor={p.accent} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={r} cy={r} r={r * 0.7} fill="url(#nuc-glow)" />
        </Svg>
      </Animated.View>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={r} cy={r} r={r - 2} fill="none" stroke={ring} strokeWidth={1} strokeOpacity={0.7} />
        <Circle cx={r} cy={r} r={r - 8} fill="none" stroke={ring} strokeWidth={0.5} strokeOpacity={0.25} />
      </Svg>
      <NCMark size={size * 0.58} color={p.ink} metallic={p.dark} />
    </View>
  );
  return onPress || onPressIn ? (
    <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} hitSlop={24}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

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

/** Minimal keyboard glyph: the type-instead-of-talk toggle. Translucent until active. */
function KeyboardIcon({ active }: { active: boolean }) {
  const c = active ? '#cdd1d9' : '#9396a0';
  const o = active ? 0.95 : 0.4;
  const keyRows: [number, number[]][] = [
    [9.5, [6, 10, 14, 18, 22]],
    [13.5, [7, 11, 15, 19, 21.5]],
  ];
  return (
    <Svg width={28} height={26} opacity={o}>
      {/* body */}
      <Line x1={3} y1={6} x2={25} y2={6} stroke={c} strokeWidth={1.5} strokeLinecap="round" />
      <Line x1={3} y1={20} x2={25} y2={20} stroke={c} strokeWidth={1.5} strokeLinecap="round" />
      <Line x1={3} y1={6} x2={3} y2={20} stroke={c} strokeWidth={1.5} strokeLinecap="round" />
      <Line x1={25} y1={6} x2={25} y2={20} stroke={c} strokeWidth={1.5} strokeLinecap="round" />
      {/* keys */}
      {keyRows.flatMap(([y, xs]) =>
        xs.map((x) => <Circle key={`${x}-${y}`} cx={x} cy={y} r={1.1} fill={c} />),
      )}
      {/* spacebar */}
      <Line x1={9} y1={17} x2={19} y2={17} stroke={c} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}

/** Hamburger → back to the list of brands. */
function BrandsIcon() {
  const c = '#9396a0';
  return (
    <Svg width={28} height={26} opacity={0.5}>
      {[9, 14, 19].map((y) => (
        <Line key={y} x1={6} y1={y} x2={22} y2={y} stroke={c} strokeWidth={2.2} strokeLinecap="round" />
      ))}
    </Svg>
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

export default function StudioScreen() {
  const insets = useSafeAreaInsets();
  const p = usePalette();
  const { session, loading } = useAuth();

  const [state, setState] = useState<EntityState>('idle');
  const [line, setLine] = useState('');
  const [heard, setHeard] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [brand, setBrand] = useState<BrandResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const messages = useRef<ChatMessage[]>([]);
  const playCount = useRef(0);
  const playGenRef = useRef(0); // bumps each playSpeech so a stale playback watchdog bails

  const [voiceResolved, setVoiceResolved] = useState(false); // /api/me landing check done
  const [showComposer, setShowComposer] = useState(false);
  const [consoleBrand, setConsoleBrand] = useState<{ slug: string; name: string } | null>(null);
  const [dashKey, setDashKey] = useState(0); // bump to refetch the dashboard (e.g. after deleting a brand)
  const [hasStore, setHasStore] = useState(false);

  // Deep-link from a tapped "changes ready" push → open that store's Console on the Edit tab (review).
  const reviewParams = useLocalSearchParams<{ reviewSlug?: string; reviewName?: string }>();
  const reviewHandled = useRef<string | null>(null);
  useEffect(() => {
    const slug = reviewParams.reviewSlug;
    if (slug && reviewHandled.current !== slug) {
      reviewHandled.current = slug;
      setConsoleBrand({ slug, name: reviewParams.reviewName || slug });
      setShowComposer(true);
    }
  }, [reviewParams.reviewSlug, reviewParams.reviewName]);
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
  // The Studio is gated, not auto-launched: new creators see a CTA (pick a voice +
  // get started), returning creators see their dashboard, and the AI entity only
  // runs in 'interview'. 'loading' until we know which.
  const [mode, setMode] = useState<'loading' | 'primer' | 'interview' | 'dashboard'>('loading');

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

  const player = useAudioPlayer();

  // Live audio level (0..1) driving the nucleus from her voice while she speaks (the /api/say
  // launch line): PCM RMS sampled off the player. The Live session drives a state pulse below.
  const level = useSharedValue(0);
  useAudioSampleListener(player, (sample) => {
    const frames = sample.channels?.[0]?.frames;
    if (!frames?.length) return;
    const step = Math.max(1, Math.floor(frames.length / 64));
    let sum = 0;
    let n = 0;
    for (let i = 0; i < frames.length; i += step) {
      sum += frames[i] * frames[i];
      n++;
    }
    const rms = Math.sqrt(sum / n);
    level.value = withTiming(Math.min(1, rms * 4.5), { duration: 90 });
  });
  useEffect(() => {
    if (state === 'idle' || state === 'thinking') level.value = withTiming(0, { duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Keyboard mode: type instead of talk (noisy environments). Her voice still replies.
  const [keyboardMode, setKeyboardMode] = useState(false);

  // Paused = the user explicitly paused (or the tab blurred). Gates ALL playback + listening so
  // Venus never talks over another tab, and so an unprepared user can stop her mid-question.
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  // Venus is vocal ONLY when her view is on screen AND the app is foregrounded. These two flags are
  // the single source of truth the lifecycle effect uses to start/stop the Live session.
  const [focused, setFocused] = useState(false);
  const [appActive, setAppActive] = useState(true);

  // ---- Gemini Live wiring (the realtime speech-to-speech interview; GEMINI_LIVE.md) ----
  // Name from the auth provider / signup form (first name only is used in her greeting); on a brand's
  // very first creation (no stores yet) Venus introduces herself.
  const creatorName =
    (session?.user?.user_metadata?.name as string | undefined) ??
    (session?.user?.user_metadata?.full_name as string | undefined) ??
    undefined;
  const live = useLiveVoice({
    accessToken: session?.access_token,
    userName: creatorName,
    firstTime: !hasStore,
    voiceName: LIVE_VOICE,
    onBrand: (b, transcript) => { setBrand(b); if (transcript?.length) messages.current = transcript; },
  });
  // Mirror the Live session into the existing orb/caption state so the render is unchanged.
  useEffect(() => {
    const m: Record<string, EntityState> = {
      connecting: 'thinking', thinking: 'thinking', listening: 'listening',
      speaking: 'speaking', idle: 'idle', error: 'idle',
    };
    setState(m[live.state] ?? 'idle');
  }, [live.state]);
  useEffect(() => { setLine(live.venusText); }, [live.venusText]);
  useEffect(() => { setHeard(live.userText); }, [live.userText]);
  useEffect(() => { if (live.error) setError(live.error); }, [live.error]);
  // Build is GATED: Venus gathers the essentials first, then invites them to build — that's when the
  // button appears. We latch "ready" when she signals it (she's prompted to say "ready to build your
  // brand" once she has a name, products, and a style), floored at 3 answers; a 6-answer safety net
  // ensures the button always eventually appears. Resets when a fresh interview clears the transcript.
  const [buildReady, setBuildReady] = useState(false);
  useEffect(() => {
    if (!live.messages.length) { setBuildReady(false); return; }
    if (buildReady) return;
    const userTurns = live.messages.filter((m) => m.role === 'user').length;
    const lastVenus = [...live.messages].reverse().find((m) => m.role === 'assistant')?.text ?? '';
    const cue = /\b(ready to build|ready to (create|launch|go)|build your (brand|store|site|shop)|(everything|all)\s+(i|we)\s+need|got everything|let'?s build|time to build|shall we build)\b/i;
    if (userTurns >= 6 || (userTurns >= 3 && cue.test(lastVenus))) setBuildReady(true);
  }, [live.messages, buildReady]);
  // The ONE rule for when Venus is live: her view is on screen (interview, focused, app foregrounded)
  // and not paused / already done. Anything else → stop, so she's never vocal outside her view.
  // start()/stop() are idempotent.
  useEffect(() => {
    // Pause is a VOICE concept (stop her talking over you). In text/chat mode it must NOT gate the
    // session, or typed turns get no reply ("chat not completing"). So: run when not paused, OR when
    // in keyboard mode regardless of pause.
    const inHerView = mode === 'interview' && !brand && focused && appActive;
    if (inHerView && (keyboardMode || !paused)) live.start();
    else live.stop();
  }, [mode, brand, paused, keyboardMode, focused, appActive, live.start, live.stop]);
  // Keyboard/chat mode mutes the mic so Venus doesn't react to the room while you type. Re-applied on
  // state changes too, so it sticks even if the session (re)connects after the mode flips.
  useEffect(() => { live.mute(keyboardMode); }, [keyboardMode, live.state, live.mute]);
  // App foreground state feeds the lifecycle rule above — backgrounding (home button / app switcher)
  // silences her even though nav focus hasn't changed.
  useEffect(() => {
    setAppActive(AppState.currentState === 'active');
    const sub = AppState.addEventListener('change', (st) => setAppActive(st === 'active'));
    return () => sub.remove();
  }, []);
  // Orb amplitude: the Live session has no expo-audio metering — drive a gentle state-based pulse.
  useEffect(() => {
    if (state === 'speaking' || state === 'listening') {
      level.value = withRepeat(withSequence(withTiming(0.6, { duration: 480 }), withTiming(0.18, { duration: 480 })), -1, true);
    } else {
      cancelAnimation(level);
      level.value = withTiming(0, { duration: 400 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const playSpeech = useCallback(
    async (b64: string, ext: 'mp3' | 'wav' = 'mp3') => {
      const gen = ++playGenRef.current;
      const file = `${FileSystem.cacheDirectory}entity-${playCount.current++}.${ext}`;
      await FileSystem.writeAsStringAsync(file, b64, { encoding: FileSystem.EncodingType.Base64 });
      // Switch the audio session OUT of record mode (we may have just recorded), then give iOS a
      // beat to actually apply the category switch before playing — otherwise play() no-ops silently.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      // If the user left the Studio tab or paused while this reply was loading, stay silent —
      // never let her start talking on a tab the user isn't looking at.
      if (!focusedRef.current || pausedRef.current) {
        setState('idle');
        return;
      }
      try {
        player.replace({ uri: file });
      } catch {
        setState('idle');
        return;
      }
      // CRITICAL: wait for the clip to actually LOAD before play() — calling play() on an
      // unloaded source no-ops silently (this was the "first word shows but no audio" freeze).
      // Also gives the record→playback audio-session switch time to apply.
      for (let i = 0; i < 25 && !player.isLoaded; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (gen !== playGenRef.current) return; // superseded by a newer reply
      }
      if (gen !== playGenRef.current || !focusedRef.current || pausedRef.current) {
        setState('idle');
        return;
      }
      setState('speaking');
      player.play();
      // Watchdog: confirm playback ACTUALLY started. If play() no-op'd (session/load race), nudge
      // once, and if it still never starts, drop to idle so she never freezes silent in "speaking"
      // (the reply text is already on screen). didJustFinish handles the normal end.
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (gen !== playGenRef.current || pausedRef.current) return;
        if (player.playing || player.currentTime > 0.02) return; // real playback — done
        if (i === 4 || i === 9) {
          // play() no-op'd — re-assert the playback session + nudge again.
          try {
            await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
            player.play();
          } catch {}
        }
      }
      if (gen === playGenRef.current && !player.playing && player.currentTime <= 0.02) {
        setState('idle'); // never started — don't leave her hung
      }
    },
    [player],
  );

  // The AI only speaks on its own stage: the conversation starts when the Studio tab is
  // actually focused AND an AI has been chosen; everything goes quiet on blur.
  const focusedRef = useRef(false);
  // Decide the landing once auth + store status are known: returning creators get the
  // dashboard, everyone else the CTA. Never override an interview the user started, and
  // flip to the dashboard the moment a store appears.
  useEffect(() => {
    if (!voiceResolved) return;
    setMode((m) => {
      if (m === 'interview' || m === 'primer') return m; // never yank the user out of an in-progress flow
      if (hasStore) return 'dashboard';
      if (m === 'loading') return 'primer';
      return m;
    });
  }, [voiceResolved, hasStore]);

  // Venus greets via the Live session's setupComplete; nothing to kick off here. We only track focus,
  // which drives the Live lifecycle rule (she resumes only on her focused view).
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      setFocused(true);
      return () => {
        focusedRef.current = false;
        setFocused(false); // leaving the screen stops the Live session via the lifecycle effect
      };
    }, []),
  );

  // Not ready yet — back out of the primer to the brand dashboard (a returning creator). A brand-new
  // creator lands directly on the primer, so the Back link only shows when there's a dashboard.
  const onPrimerBack = useCallback(() => setMode('dashboard'), []);

  // Primer choices. Voice (recommended) requests the mic HERE — the only place we prompt — so the
  // OS dialog appears when the user chooses to talk, before the Live session opens its recorder.
  // Text starts the same interview in keyboard mode (no mic); on denial we fall back to text too.
  const startVoice = useCallback(async () => {
    setKeyboardMode(false);
    const perm = await AudioModule.requestRecordingPermissionsAsync().catch(() => null);
    if (!perm?.granted) {
      setKeyboardMode(true);
      setError('No microphone access — you can type your answers, or enable the mic in Settings.');
    }
    setMode('interview');
  }, []);
  const startText = useCallback(() => {
    setKeyboardMode(true);
    setPaused(false); // entering the chat always resumes — pause is a voice-only concept
    pausedRef.current = false;
    setMode('interview');
  }, []);

  // Pause/resume the whole experience. Setting `paused` stops the Live session via the lifecycle
  // effect; we also pause the player so the launch fanfare goes quiet. Resume leaves it idle.
  const togglePause = useCallback(() => {
    setPaused((prev) => {
      const next = !prev;
      pausedRef.current = next;
      if (next) {
        try { player.pause(); } catch {}
      }
      setState('idle');
      return next;
    });
  }, [player]);

  // Orb tap: if the last connect failed (watchdog tripped), a single tap retries; otherwise it's the
  // pause/resume toggle.
  const onOrbPress = useCallback(() => {
    if (live.error) {
      setError(null);
      if (paused) { pausedRef.current = false; setPaused(false); }
      live.start();
      return;
    }
    togglePause();
  }, [live.error, live.start, paused, togglePause]);

  // Returning creator wants another brand — reset the interview and start fresh.
  const onNewBrand = useCallback(() => {
    messages.current = [];
    setBrand(null);
    setCreated(null);
    setHeard('');
    setLine('');
    setMode('primer');
  }, []);

  // Just finished creating a brand — graduate from the compiled/created screen back to the brand
  // picker (dashboard). Bump dashKey so the freshly created brand shows up in the list.
  const onFinishedBrand = useCallback(() => {
    messages.current = [];
    setBrand(null);
    setCreated(null);
    setHeard('');
    setLine('');
    setHasStore(true);
    setDashKey((k) => k + 1);
    setMode('dashboard');
  }, []);

  const toggleKeyboard = useCallback(() => {
    const entering = !keyboardMode;
    setKeyboardMode(entering);
    if (entering) {
      // Entering the chat always resumes the session — a pause set in voice must not leave the chat
      // dead (no replies). Pause is voice-only.
      setPaused(false);
      pausedRef.current = false;
    }
  }, [keyboardMode]);

  const createStore = useCallback(async () => {
    if (!session || !brand) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch(apiUrl('/api/store'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ brand, transcript: messages.current }),
      });
      // Launching a store needs an active plan with room under its brand cap — open the paywall.
      if (r.status === 402) {
        const g = (await r.json()) as { error?: string };
        setPaywall(g.error === 'brand_limit' ? 'brand_limit' : 'subscription_required');
        return;
      }
      const d = await readJson<{
        store?: { slug: string; logoUrl?: string | null };
        error?: string;
      }>(r);
      if (!d.store) throw new Error(d.error || 'Failed to create store');
      setCreated(d.store.slug);
      setHasStore(true);
      setLogoUrl(d.store.logoUrl ?? null);
      // The entity announces the launch — in Venus's OWN Gemini voice (Aoede), the same voice as the
      // live interview, NOT the legacy ElevenLabs `/api/voice` path. The live session is already torn
      // down by finalize() at this point, so this one-shot /api/say keeps the voice consistent.
      try {
        const v = await fetch(apiUrl('/api/say'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ text: `${brand.name} is online. Head to the Design tab — let's make your first drop.` }),
        });
        const s = await readJson<{ audio?: string }>(v);
        if (s.audio) await playSpeech(s.audio, 'wav');
      } catch {
        // launch fanfare is optional
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create store');
    } finally {
      setCreating(false);
    }
  }, [session, brand, playSpeech]);

  const hint =
    state === 'listening'
      ? '[ listening — just talk ]'
      : state === 'thinking'
        ? '[ thinking… ]'
        : state === 'speaking'
          ? '[ Venus is speaking — tap to pause ]'
          : paused
            ? '[ paused — tap the mark to resume ]'
            : '[ connecting… ]';

  // Native tab bar sits above the home indicator; reserve its height + the inset + a
  // comfortable gap so the karaoke captions never dip under it.
  const bottomPad = BottomTabInset + insets.bottom + Spacing.five;
  const aiName = 'Venus'; // the only consultant — no picker

  // First-launch welcome: a full-screen Modal presented ABOVE the tab bar so it owns its own swipe
  // gestures (no tab-navigator conflict) and hides the bottom bar during onboarding.
  const welcomeVisible = welcomeChecked && !loading && !session && showWelcome;

  return (
    <View style={[styles.container, { backgroundColor: p.bg }]}>
      <FabricBackground p={p} />
      <Modal
        visible={welcomeVisible}
        animationType="fade"
        onRequestClose={() => {
          setShowWelcome(false);
          AsyncStorage.setItem(ONBOARD_SEEN_KEY, '1').catch(() => {});
        }}>
        {/* The Modal renders in its own native view tree (no safe-area context), so pass the
            app-level insets in — otherwise the top bar sits under the Dynamic Island / status bar. */}
        <Welcome onChoose={handleChoose} topInset={insets.top} bottomInset={insets.bottom} />
      </Modal>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[styles.content, { paddingTop: insets.top + Spacing.four, paddingBottom: bottomPad }]}>
        <View style={styles.headerRow}>
          <NCMark size={22} color={p.ink} metallic={p.dark} />
          <ThemedText type="code" style={[styles.eyebrow, { color: p.dim }]}>
            STUDIO
          </ThemedText>
          <View style={styles.headerSpacer} />
          {session && !brand && (mode === 'interview' || mode === 'dashboard') ? (
            <View style={styles.headerIcons}>
              {hasStore && mode === 'dashboard' ? (
                <Pressable onPress={() => setShowComposer(true)} hitSlop={10}>
                  <ManageIcon />
                </Pressable>
              ) : null}
              {hasStore && mode === 'interview' ? (
                <Pressable onPress={() => setMode('dashboard')} hitSlop={10}>
                  <BrandsIcon />
                </Pressable>
              ) : null}
              {mode === 'interview' && !keyboardMode ? (
                <Pressable onPress={togglePause} hitSlop={10} accessibilityLabel={paused ? 'Resume' : 'Pause'}>
                  <ThemedText type="code" style={{ color: paused ? p.accent : p.dim, fontSize: 16 }}>
                    {paused ? '▶' : '❚❚'}
                  </ThemedText>
                </Pressable>
              ) : null}
              {mode === 'interview' && !keyboardMode ? (
                <Pressable onPress={toggleKeyboard} hitSlop={10}>
                  <KeyboardIcon active={keyboardMode} />
                </Pressable>
              ) : null}
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
              onFreeSlot={() => { setPaywall(null); setMode('dashboard'); }}
            />
          </>
        ) : null}

        {loading ? (
          <ActivityIndicator style={styles.center} color="#cdd1d9" />
        ) : !session ? (
          <View style={styles.introWrap}>
            <NCNucleus size={132} p={p} />
            <ThemedText type="code" style={[styles.introTag, { color: p.dim }]}>
              FROM IDEA TO BRAND IN SECONDS
            </ThemedText>
            <ThemedText type="title" style={[styles.introTitle, { color: p.ink }]}>
              Meet Venus
            </ThemedText>
            <ThemedText type="small" style={[styles.introBody, { color: p.dim }]}>
              Your AI brand consultant. Talk it through, and Venus designs your clothing
              brand, builds the store, and launches your website.
            </ThemedText>
            <Pressable onPress={() => router.navigate('/account')} style={[styles.ctaPrimary, { backgroundColor: p.accent }]}>
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
        ) : mode === 'dashboard' ? (
          <>
            {brand ? (
              <Pressable onPress={() => setMode('interview')} style={[styles.stagedBanner, { borderColor: p.accent }]}>
                <ThemedText type="code" style={{ color: p.accent, fontSize: 12, letterSpacing: 0.5 }}>
                  ‹ “{brand.name}” is staged — delete a brand below to free a slot, then tap to launch it
                </ThemedText>
              </Pressable>
            ) : null}
            <StudioDashboard
              key={dashKey}
              token={session.access_token}
              onEditBrand={(slug, name) => { setConsoleBrand({ slug, name }); setShowComposer(true); }}
              onNewBrand={onNewBrand}
              onOpenBilling={() => setPaywall('manage')}
              onBounty={(panel, slot) => router.navigate(`/design?panel=${panel}${slot ? `&slot=${slot}` : ''}`)}
            />
          </>
        ) : brand ? (
          <BrandReview
            brand={brand}
            onChange={setBrand}
            onCreate={createStore}
            creating={creating}
            created={created}
            onFinished={onFinishedBrand}
            logoUrl={logoUrl}
            p={p}
            bg={BG}
          />
        ) : mode === 'primer' ? (
          <ScrollView style={styles.fill} contentContainerStyle={styles.selectScroll} showsVerticalScrollIndicator={false}>
            {hasStore ? (
              <Pressable onPress={onPrimerBack} hitSlop={10} style={{ alignSelf: 'flex-start', marginBottom: Spacing.two }}>
                <ThemedText type="code" style={{ color: p.dim }}>‹ Back</ThemedText>
              </Pressable>
            ) : null}
            <ThemedText type="code" style={styles.brandEyebrow}>
              {'// BEFORE WE START'}
            </ThemedText>
            <ThemedText type="title" style={[styles.introTitle, { color: p.ink }]}>
              {aiName} will interview you
            </ThemedText>
            <ThemedText type="small" style={[styles.introBody, { color: p.dim, textAlign: 'left' }]}>
              On the next screen, {aiName} talks with you to design your brand — a quick back-and-forth.
              Just talk — Venus listens as you speak (or tap the keyboard to type). Have a rough idea of:
            </ThemedText>
            {[
              'Your brand name + what it stands for',
              'A logo — or the direction for one',
              'Colors + the kind of look (minimal, bold, street…)',
              'The vibe, and how your site should feel',
              'The products you want to sell',
            ].map((q) => (
              <View key={q} style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginBottom: 8 }}>
                <ThemedText type="code" style={{ color: p.accent }}>›</ThemedText>
                <ThemedText type="small" style={[styles.dim, { color: p.dim, flex: 1 }]}>{q}</ThemedText>
              </View>
            ))}
            <ThemedText type="code" style={[styles.introFoot, { color: p.faint }]}>
              No perfect answers needed — {aiName} guides you, and you can pause anytime.
            </ThemedText>
            {/* Voice is the recommended, prominent choice; typing is a quieter fallback. */}
            <Pressable onPress={startVoice}>
              <View style={styles.getStarted}>
                <ThemedText type="smallBold" style={{ color: BG }}>
                  🎙  Talk with {aiName} — recommended
                </ThemedText>
              </View>
            </Pressable>
            <ThemedText type="code" style={[styles.ctaSecondaryText, { color: p.faint, textAlign: 'center', marginTop: 6 }]}>
              We’ll ask for microphone access — best experience.
            </ThemedText>
            <Pressable onPress={startText} hitSlop={8} style={{ marginTop: Spacing.three, alignSelf: 'center' }}>
              <ThemedText type="code" style={[styles.ctaSecondaryText, { color: p.dim }]}>
                I’d rather type
              </ThemedText>
            </Pressable>
          </ScrollView>
        ) : keyboardMode ? (
          // Keyboard mode renders as a full-screen overlay (below) — outside this KeyboardAvoidingView.
          null
        ) : (
          <>
            <View style={styles.entityArea}>
              <NCNucleus size={232} p={p} level={level} state={state} onPress={onOrbPress} />
              <ThemedText type="code" style={[styles.hint, { color: p.faint }]}>
                {hint}
              </ThemedText>
              <Pressable onPress={togglePause} hitSlop={12} style={[styles.pausePill, { borderColor: paused ? p.accent : `${p.dim}66` }]}>
                <ThemedText type="code" style={{ color: paused ? p.accent : p.dim, fontSize: 13, letterSpacing: 1 }}>
                  {paused ? '▶  Resume' : '❚❚  Pause'}
                </ThemedText>
              </Pressable>
              {/* Build only appears once Venus has gathered the essentials (buildReady) — she leads
                  the interview first. Then we extract the brand from the transcript on demand. */}
              {buildReady ? (
                <Pressable
                  onPress={live.finalize}
                  disabled={live.finalizing}
                  hitSlop={10}
                  style={[styles.finalizePill, { backgroundColor: p.accent, opacity: live.finalizing ? 0.6 : 1 }]}>
                  {live.finalizing ? (
                    <ActivityIndicator color={BG} />
                  ) : (
                    <ThemedText type="smallBold" style={{ color: BG }}>✓ Build my brand</ThemedText>
                  )}
                </Pressable>
              ) : null}
            </View>
            <View style={styles.captions}>
              {heard ? (
                <ThemedText type="code" style={[styles.heard, { color: p.dim }]} numberOfLines={2}>
                  {'you > ' + heard}
                </ThemedText>
              ) : null}
              {line ? (
                <ThemedText style={[styles.line, { color: p.ink }]} numberOfLines={3}>
                  {line}
                </ThemedText>
              ) : null}
            </View>
          </>
        )}

        {error ? (
          <Pressable
            onPress={() => setError(null)}
            style={[styles.errorBar, { bottom: BottomTabInset + insets.bottom + Spacing.two }]}>
            <ThemedText type="code" style={styles.error}>
              {error}
            </ThemedText>
            <ThemedText type="code" style={styles.errorDismiss}>
              tap to dismiss
            </ThemedText>
          </Pressable>
        ) : null}
      </KeyboardAvoidingView>

      {/* Keyboard mode = a full-screen chat window OVER the studio (its own keyboard/tab-bar insets,
          text-only — her voice is muted). Rendered outside the KeyboardAvoidingView on purpose. */}
      {session && mode === 'interview' && !brand && keyboardMode ? (
        <ChatInterview
          messages={live.messages}
          streaming={live.venusText}
          thinking={live.state === 'thinking' || live.state === 'connecting'}
          aiName={aiName}
          onSend={(t) => live.sendText(t)}
          onVoice={() => setKeyboardMode(false)}
          onExit={() => { setKeyboardMode(false); setMode(hasStore ? 'dashboard' : 'primer'); }}
          onFinalize={live.finalize}
          finalizing={live.finalizing}
          canBuild={buildReady}
          p={p}
          bg={BG}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
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
  introFoot: { color: '#9396a0', fontSize: 12, marginTop: Spacing.three, textAlign: 'center' },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  markBadge: { transform: [{ scale: 0.32 }], width: 28, height: 28, marginLeft: -28, marginRight: -22 },
  entityArea: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.four },
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
