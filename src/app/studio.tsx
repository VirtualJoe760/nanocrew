import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
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
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
  useAudioSampleListener,
} from 'expo-audio';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import Svg, { Circle, Defs, Line, LinearGradient, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { StudioComposer } from '@/components/studio-composer';
import { StudioDashboard } from '@/components/studio-dashboard';
import { Paywall } from '@/components/paywall';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { apiUrl } from '@/lib/api';
import type { BrandResult, ChatMessage, TimedWord } from '@/lib/interview';
import { AI_VOICES, DEFAULT_VOICE, type AiVoice } from '@/lib/voices';

const VOICE_KEY = 'nanocrew.voiceId';

// The Studio: a voice-first brand interview. A nano-entity — flickering pixel core inside
// counter-rotating rings, digital rain behind — talks you through building your brand.
// Tap it to speak; Gemini hears the audio, ElevenLabs gives the reply a voice.

type EntityState = 'idle' | 'listening' | 'thinking' | 'speaking';

// Dark ink used for text ON the gold accent buttons — gold is light, so dark text reads in
// both modes. (The screen background comes from the palette below.)
const BG = '#08080a';
// idle → listening → thinking → speaking. Champagne gold resting, brightening to near-white
// as Venus speaks — monochrome + gold, per the Nano Crew brand.
const STATE_COLORS = ['#cdd1d9', '#e8eaee', '#dfe2e8', '#ffffff'];
const STATE_INDEX: Record<EntityState, number> = { idle: 0, listening: 1, thinking: 2, speaking: 3 };

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
const SERIF = Platform.select({ ios: 'Georgia', default: 'serif' });
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Nano Crew palette — monochrome black/white with a single champagne-gold accent. Black
// silk on dark, warm paper on light; gold holds on both.
type Palette = ReturnType<typeof makePalette>;
function makePalette(dark: boolean) {
  return {
    dark,
    bg: dark ? '#08080a' : '#f5f5f6',
    bgTop: dark ? '#141417' : '#fbfbfc', // top of the vertical wash
    wave: dark
      ? ['#101013', '#0d0d10', '#131318', '#0b0b0e'] // silk fold tones on black
      : ['#eeeef0', '#e9e9ec', '#f0f0f2', '#e3e3e6'],
    ink: dark ? '#f4f4f6' : '#131316',
    dim: dark ? '#9396a0' : '#6a6c73',
    faint: dark ? '#56575e' : '#a3a4ab',
    accent: dark ? '#cdd1d9' : '#44474e', // champagne gold (darker on light for contrast)
    accent2: dark ? '#e8eaee' : '#2c2e34',
    line: dark ? 'rgba(205,209,217,0.16)' : 'rgba(68,71,78,0.20)',
    coreInner: dark ? '#f4f4f6' : '#8a8d94',
  };
}
function usePalette(): Palette {
  return makePalette(useColorScheme() !== 'light');
}

// ---------- Static silk background (flat, no per-frame animation) ----------
// Smooth bezier "folds" filled in near-black tones evoke black silk, with one soft gold
// glow behind the nucleus. Entirely static — the laggy network/dust fields are gone.

function wavePath(yBase: number, amp: number): string {
  const W = SCREEN_W;
  const H = SCREEN_H;
  return (
    `M0 ${yBase}` +
    ` C ${W * 0.28} ${yBase - amp}, ${W * 0.42} ${yBase + amp}, ${W * 0.56} ${yBase}` +
    ` C ${W * 0.72} ${yBase - amp}, ${W * 0.88} ${yBase + amp * 1.15}, ${W} ${yBase - amp * 0.35}` +
    ` L ${W} ${H} L 0 ${H} Z`
  );
}

const WAVES = [
  { y: SCREEN_H * 0.34, amp: 64, tone: 0, op: 0.9 },
  { y: SCREEN_H * 0.48, amp: 82, tone: 1, op: 0.85 },
  { y: SCREEN_H * 0.62, amp: 70, tone: 2, op: 0.9 },
  { y: SCREEN_H * 0.76, amp: 92, tone: 3, op: 0.85 },
  { y: SCREEN_H * 0.88, amp: 60, tone: 0, op: 0.95 },
];

function FabricBackground({ p }: { p: Palette }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={SCREEN_W} height={SCREEN_H}>
        <Defs>
          <LinearGradient id="nc-wash" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={p.bgTop} />
            <Stop offset="1" stopColor={p.bg} />
          </LinearGradient>
          <RadialGradient id="nc-glow" cx="50%" cy="34%" r="52%">
            <Stop offset="0" stopColor={p.accent} stopOpacity={p.dark ? 0.12 : 0.07} />
            <Stop offset="1" stopColor={p.accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={SCREEN_W} height={SCREEN_H} fill="url(#nc-wash)" />
        {WAVES.map((w, i) => (
          <Path key={i} d={wavePath(w.y, w.amp)} fill={p.wave[w.tone]} opacity={w.op} />
        ))}
        <Rect width={SCREEN_W} height={SCREEN_H} fill="url(#nc-glow)" />
      </Svg>
    </View>
  );
}

// ---------- The NC monogram + circular nucleus ----------

/** The Nano Crew "NC" serif monogram. */
function NCMark({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <SvgText x="50" y="71" fill={color} fontFamily={SERIF} fontSize={62} fontWeight="500" textAnchor="middle" letterSpacing={-6}>
        NC
      </SvgText>
    </Svg>
  );
}

/** The circular logo as the entity's nucleus: a thin gold ring around the NC monogram, on
 *  a soft glow. Optionally breathes with the live audio level (one cheap animated node). */
function NCNucleus({
  size,
  p,
  level,
  state,
  onPress,
}: {
  size: number;
  p: Palette;
  level?: SharedValue<number>;
  state?: EntityState;
  onPress?: () => void;
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
      <NCMark size={size * 0.58} color={p.ink} />
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} hitSlop={24}>
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

// ---------- Nanocrew mark: the crewcut ----------

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

/** The Nanocrew crewcut: a minimal head with a flat-top buzz crown and a nucleus within. */
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
  const started = useRef(false);
  const playCount = useRef(0);

  // Which AI they chose. First-time creators (no store, no saved pick) choose; everyone
  // else goes straight to their consultant.
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [voiceResolved, setVoiceResolved] = useState(false);
  const [needsSelection, setNeedsSelection] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [showComposer, setShowComposer] = useState(false);
  const [consoleBrand, setConsoleBrand] = useState<{ slug: string; name: string } | null>(null);
  const [hasStore, setHasStore] = useState(false);
  const [paywall, setPaywall] = useState<'subscription_required' | 'brand_limit' | 'manage' | null>(null);
  // The Studio is gated, not auto-launched: new creators see a CTA (pick a voice +
  // get started), returning creators see their dashboard, and the AI entity only
  // runs in 'interview'. 'loading' until we know which.
  const [mode, setMode] = useState<'loading' | 'cta' | 'interview' | 'dashboard'>('loading');

  useEffect(() => {
    if (!session) return;
    let alive = true;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(VOICE_KEY);
        if (!alive) return;
        if (saved) {
          setVoiceId(saved);
          // Returning creator — confirm a store exists so the Manage panel shows.
          fetch(apiUrl('/api/me'), { headers: { Authorization: `Bearer ${session.access_token}` } })
            .then((r) => r.json())
            .then((d: { stores?: unknown[] }) => alive && setHasStore((d.stores?.length ?? 0) > 0))
            .catch(() => {});
        } else {
          const r = await fetch(apiUrl('/api/me'), {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          const d = (await r.json()) as { stores?: unknown[] };
          if (!alive) return;
          if ((d.stores?.length ?? 0) > 0) {
            setVoiceId(DEFAULT_VOICE.id);
            setHasStore(true);
          } else setNeedsSelection(true);
        }
      } catch {
        if (alive) setVoiceId(DEFAULT_VOICE.id); // never block the studio on a lookup
      } finally {
        if (alive) setVoiceResolved(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [session]);

  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const player = useAudioPlayer();
  const playerStatus = useAudioPlayerStatus(player);

  // Live audio level (0..1) driving the nucleus: her voice while speaking, yours while
  // listening. PCM RMS from the player; dBFS metering from the recorder.
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
  const recState = useAudioRecorderState(recorder, 120);
  useEffect(() => {
    if (state !== 'listening') return;
    const db = recState.metering;
    if (typeof db !== 'number') return;
    const amp = Math.min(1, Math.max(0, (db + 50) / 50)); // -50dB..0dB → 0..1
    level.value = withTiming(amp, { duration: 110 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recState.metering, state]);
  useEffect(() => {
    if (state === 'idle' || state === 'thinking') level.value = withTiming(0, { duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Fluid conversation: ask for the mic once, then the entity listens by itself after
  // each reply — silence ends your turn, no tapping.
  const [micGranted, setMicGranted] = useState(false);
  useEffect(() => {
    if (!session) return;
    AudioModule.requestRecordingPermissionsAsync()
      .then((p) => setMicGranted(p.granted))
      .catch(() => {});
  }, [session]);

  // Keyboard mode: type instead of talk (noisy environments). Her voice still replies.
  const [keyboardMode, setKeyboardMode] = useState(false);
  const [typed, setTyped] = useState('');

  // Voice-activity bookkeeping for auto-send.
  const spokeRef = useRef(false);
  const voicedCountRef = useRef(0);
  const lastLoudRef = useRef(0);
  const recStartRef = useRef(0);
  const busyRef = useRef(false);
  const lastTurnEmptyRef = useRef(false);

  const playSpeech = useCallback(
    async (b64: string) => {
      const file = `${FileSystem.cacheDirectory}entity-${playCount.current++}.mp3`;
      await FileSystem.writeAsStringAsync(file, b64, { encoding: FileSystem.EncodingType.Base64 });
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      player.replace({ uri: file });
      player.play();
      setState('speaking');
    },
    [player],
  );

  const turn = useCallback(
    async (body: { init?: boolean; audio?: string; text?: string }) => {
      if (!session) return;
      setState('thinking');
      setError(null);
      try {
        const r = await fetch(apiUrl('/api/voice'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ ...body, voiceId, messages: messages.current }),
        });
        const d = (await r.json()) as {
          userText?: string;
          done?: boolean;
          brand?: BrandResult;
          line?: string;
          speech?: string;
          words?: TimedWord[];
          empty?: boolean;
          error?: string;
        };
        if (d.error) throw new Error(d.error);
        lastTurnEmptyRef.current = !!d.empty;
        setTimedWords(d.words ?? []);
        if (d.empty) {
          // Nothing was actually said — she acknowledges and parks (no history written).
          if (d.line) setLine(d.line);
          if (d.speech) await playSpeech(d.speech);
          else setState('idle');
          return;
        }
        if (d.userText) {
          messages.current.push({ role: 'user', text: d.userText });
          setHeard(d.userText);
        }
        if (d.line) {
          messages.current.push({ role: 'assistant', text: d.line });
          setLine(d.line);
        }
        if (d.done && d.brand) setBrand(d.brand);
        if (d.speech) await playSpeech(d.speech);
        else setState('idle');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong');
        setState('idle');
      }
    },
    [session, playSpeech, voiceId],
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
      if (m === 'interview') return m;
      if (hasStore) return 'dashboard';
      if (m === 'loading') return 'cta';
      return m;
    });
  }, [voiceResolved, hasStore]);

  // The greeting only fires in interview mode (after Get started / Build a new brand).
  useEffect(() => {
    if (mode === 'interview' && session && voiceId && focusedRef.current && !started.current) {
      started.current = true;
      void turn({ init: true });
    }
  }, [mode, session, voiceId, turn]);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      if (session && voiceId && mode === 'interview' && !started.current) {
        started.current = true;
        void turn({ init: true });
      }
      return () => {
        focusedRef.current = false;
        try {
          player.pause();
        } catch {}
        recorder.stop().catch(() => {});
        busyRef.current = false;
        setState('idle');
      };
    }, [session, voiceId, mode, turn, player, recorder]),
  );

  const chooseVoice = useCallback((v: AiVoice) => {
    AsyncStorage.setItem(VOICE_KEY, v.id).catch(() => {});
    setNeedsSelection(false);
    setVoiceId(v.id); // just the pick — the interview waits for "Get started"
  }, []);

  // New creator pressed Get started — now (and only now) the AI wakes up.
  const onGetStarted = useCallback(() => setMode('interview'), []);

  // Returning creator wants another brand — reset the interview and start fresh.
  const onNewBrand = useCallback(() => {
    started.current = false;
    messages.current = [];
    setBrand(null);
    setCreated(null);
    setHeard('');
    setLine('');
    setMode(voiceId ? 'interview' : 'cta');
  }, [voiceId]);

  const previewVoice = useCallback(
    async (v: AiVoice) => {
      if (!session || previewing) return;
      setPreviewing(v.id);
      try {
        const r = await fetch(apiUrl('/api/voice'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ say: `Hi, I'm ${v.name}. Let's build your brand together.`, voiceId: v.id }),
        });
        const d = (await r.json()) as { speech?: string };
        if (d.speech) await playSpeech(d.speech);
      } catch {
        // preview is best-effort
      } finally {
        setPreviewing(null);
      }
    },
    [session, previewing, playSpeech],
  );

  const startListening = useCallback(async () => {
    if (busyRef.current) return;
    // The recorder can fail to prepare while the player is still releasing the audio
    // session (especially in the simulator) — be patient before falling back to tap mode.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
        spokeRef.current = false;
        voicedCountRef.current = 0;
        lastLoudRef.current = 0;
        recStartRef.current = Date.now();
        setState('listening');
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 700));
      }
    }
    setError('mic hiccup — tap the orb to talk');
    setState('idle');
  }, [recorder]);

  const sendRecording = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri;
      if (!uri) throw new Error('No recording captured');
      const audio = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      await turn({ audio });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recording failed');
      setState('idle');
    } finally {
      busyRef.current = false;
    }
  }, [recorder, turn]);

  // When she finishes speaking, she starts listening — the conversation just flows.
  // (Small delay so the audio session settles before the mic takes over.)
  useEffect(() => {
    if (!playerStatus.didJustFinish) return;
    if (lastTurnEmptyRef.current) {
      // She asked for a tap — wait for it instead of re-opening the mic.
      lastTurnEmptyRef.current = false;
      setState('idle');
      return;
    }
    if (micGranted && !brand && started.current && focusedRef.current && !keyboardMode) {
      const t = setTimeout(() => {
        if (focusedRef.current) void startListening();
      }, 450);
      return () => clearTimeout(t);
    }
    setState('idle');
  }, [playerStatus.didJustFinish, micGranted, brand, startListening, keyboardMode]);

  // Silence detection: real speech is SUSTAINED loudness (3+ samples ≈ a third of a
  // second), not a noise spike. Once you've spoken, ~1.2s of quiet sends your turn. If
  // you say nothing at all, she parks — no send, idle until you tap her awake.
  useEffect(() => {
    if (state !== 'listening' || busyRef.current) return;
    const db = recState.metering;
    if (typeof db !== 'number') return;
    const now = Date.now();
    if (db > -36) {
      voicedCountRef.current++;
      lastLoudRef.current = now;
      if (voicedCountRef.current >= 3) spokeRef.current = true;
    }
    if (spokeRef.current && (now - lastLoudRef.current > 1200 || now - recStartRef.current > 30000)) {
      void sendRecording();
      return;
    }
    if (!spokeRef.current && now - recStartRef.current > 12000) {
      // Nothing said — go quiet until they re-initiate by tapping.
      recorder.stop().catch(() => {});
      setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      setState('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recState.metering, state, sendRecording]);

  const toggleKeyboard = useCallback(() => {
    setKeyboardMode((k) => {
      const next = !k;
      if (next && state === 'listening') {
        recorder.stop().catch(() => {});
        setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
        setState('idle');
      }
      return next;
    });
  }, [state, recorder]);

  const sendTyped = useCallback(() => {
    const t = typed.trim();
    if (!t || state === 'thinking') return;
    if (state === 'speaking') player.pause();
    setTyped('');
    void turn({ text: t });
  }, [typed, state, player, turn]);

  const onEntityPress = useCallback(async () => {
    if (!session || brand) return;
    if (state === 'thinking') return;
    setKeyboardMode(false); // touching the orb always means voice
    if (state === 'speaking') {
      player.pause(); // interrupt her — your turn
      void startListening();
      return;
    }
    if (state === 'listening') {
      void sendRecording(); // manual send without waiting for silence
      return;
    }
    // idle — mic was denied or conversation hasn't started
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setError('Microphone permission needed — enable it in Settings.');
      return;
    }
    setMicGranted(true);
    void startListening();
  }, [session, brand, state, player, startListening, sendRecording]);

  // Word-by-word subtitles synced to the speech itself: ElevenLabs character timestamps
  // give each word its true start time (tempo-adjusted server-side). Linear fallback if
  // alignment is missing.
  const [wordIdx, setWordIdx] = useState(0);
  const [timedWords, setTimedWords] = useState<TimedWord[]>([]);
  const words = useMemo(
    () => (timedWords.length ? timedWords.map((x) => x.w) : line.split(/\s+/).filter(Boolean)),
    [timedWords, line],
  );
  useEffect(() => {
    if (state !== 'speaking' || !words.length) return;
    setWordIdx(0);
    const id = setInterval(() => {
      const ct = player.currentTime;
      if (timedWords.length) {
        let i = 0;
        while (i + 1 < timedWords.length && timedWords[i + 1].t <= ct) i++;
        setWordIdx(i);
      } else {
        const dur = player.duration;
        if (dur > 0) setWordIdx(Math.min(words.length - 1, Math.floor((ct / dur) * words.length)));
      }
    }, 60);
    return () => clearInterval(id);
  }, [state, words, timedWords, player]);

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
      const d = (await r.json()) as {
        store?: { slug: string; logoUrl?: string | null };
        error?: string;
      };
      if (!d.store) throw new Error(d.error || 'Failed to create store');
      setCreated(d.store.slug);
      setHasStore(true);
      setLogoUrl(d.store.logoUrl ?? null);
      // The entity announces the launch.
      try {
        const v = await fetch(apiUrl('/api/voice'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ say: `${brand.name} is online. Head to the Design tab — let's make your first drop.` }),
        });
        const s = (await v.json()) as { speech?: string };
        if (s.speech) await playSpeech(s.speech);
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
        ? '[ processing… ]'
        : state === 'speaking'
          ? '[ tap to interrupt ]'
          : micGranted
            ? '[ tap to wake ]'
            : '[ tap to enable the mic ]';

  // Native tab bar sits above the home indicator; reserve its height + the inset + a
  // comfortable gap so the karaoke captions never dip under it.
  const bottomPad = BottomTabInset + insets.bottom + Spacing.five;

  return (
    <View style={[styles.container, { backgroundColor: p.bg }]}>
      <FabricBackground p={p} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[styles.content, { paddingTop: insets.top + Spacing.four, paddingBottom: bottomPad }]}>
        <View style={styles.headerRow}>
          <NCMark size={22} color={p.ink} />
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
              {mode === 'interview' ? (
                <Pressable onPress={toggleKeyboard} hitSlop={10}>
                  <KeyboardIcon active={keyboardMode} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
        {session ? (
          <>
            <StudioComposer visible={showComposer} onClose={() => setShowComposer(false)} token={session.access_token} onOpenBilling={() => setPaywall('manage')} slug={consoleBrand?.slug} brandName={consoleBrand?.name} />
            <Paywall visible={!!paywall} onClose={() => setPaywall(null)} token={session.access_token} reason={paywall} />
          </>
        ) : null}

        {loading ? (
          <ActivityIndicator style={styles.center} color="#cdd1d9" />
        ) : !session ? (
          <View style={styles.introWrap}>
            <NCNucleus size={132} p={p} />
            <ThemedText type="code" style={[styles.introTag, { color: p.dim }]}>
              INTELLIGENCE IS THE NEW FABRIC
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
          <StudioDashboard
            token={session.access_token}
            onEditBrand={(slug, name) => { setConsoleBrand({ slug, name }); setShowComposer(true); }}
            onNewBrand={onNewBrand}
            onOpenBilling={() => setPaywall('manage')}
          />
        ) : brand ? (
          <ScrollView
            style={styles.fill}
            contentContainerStyle={styles.brandScroll}
            showsVerticalScrollIndicator={false}
          >
            <ThemedText type="code" style={styles.brandEyebrow}>
              {'// BRAND COMPILED'}
            </ThemedText>
            {logoUrl ? <Image source={{ uri: logoUrl }} style={styles.logo} contentFit="cover" /> : null}
            <ThemedText type="subtitle" style={[styles.white, { color: p.ink }]}>
              {brand.name}
            </ThemedText>
            <ThemedText type="small" style={[styles.dim, { color: p.dim }]}>
              {brand.tagline}
            </ThemedText>
            <View style={styles.paletteRow}>
              {brand.designSystem.palette.map((p) => (
                <View key={p.role} style={styles.swatchCol}>
                  <View style={[styles.swatch, { backgroundColor: p.hex }]} />
                  <ThemedText type="code" style={styles.swatchLabel}>
                    {p.role}
                  </ThemedText>
                </View>
              ))}
            </View>
            <View style={styles.chipsRow}>
              {brand.vibeKeywords.map((k) => (
                <View key={k} style={styles.chip}>
                  <ThemedText type="code" style={styles.chipText}>
                    {k}
                  </ThemedText>
                </View>
              ))}
            </View>
            <ThemedText type="small" style={[styles.dim, { color: p.dim }]}>
              {brand.story}
            </ThemedText>
            {created ? (
              <View style={[styles.createBtn, styles.createdBox]}>
                <ThemedText type="code" style={styles.green}>
                  {'> store online · @' + created}
                </ThemedText>
                <ThemedText type="small" style={[styles.dim, { color: p.dim }]}>
                  Head to Design to start your first drop.
                </ThemedText>
              </View>
            ) : (
              <Pressable onPress={createStore} disabled={creating}>
                <View style={[styles.createBtn, { opacity: creating ? 0.5 : 1 }]}>
                  {creating ? (
                    <ActivityIndicator color={BG} />
                  ) : (
                    <ThemedText type="smallBold" style={{ color: BG }}>
                      Create my store
                    </ThemedText>
                  )}
                </View>
              </Pressable>
            )}
          </ScrollView>
        ) : mode === 'cta' ? (
          <ScrollView style={styles.fill} contentContainerStyle={styles.selectScroll} showsVerticalScrollIndicator={false}>
            <ThemedText type="code" style={styles.brandEyebrow}>
              {'// CHOOSE YOUR AI'}
            </ThemedText>
            <ThemedText type="small" style={[styles.dim, { color: p.dim }]}>
              Your consultant guides the whole journey — hear them first, then get started.
            </ThemedText>
            {AI_VOICES.map((v) => (
              <View key={v.id} style={[styles.voiceCard, voiceId === v.id && styles.voiceCardOn]}>
                <View style={styles.voiceMeta}>
                  <ThemedText type="subtitle" style={[styles.white, { color: p.ink }]}>
                    {v.name}
                  </ThemedText>
                  <ThemedText type="code" style={styles.voiceVibe}>
                    {v.vibe}
                  </ThemedText>
                </View>
                <View style={styles.voiceActions}>
                  <Pressable onPress={() => previewVoice(v)} disabled={!!previewing} hitSlop={6}>
                    <View style={styles.voiceBtn}>
                      {previewing === v.id ? (
                        <ActivityIndicator size="small" color="#cdd1d9" />
                      ) : (
                        <ThemedText type="code" style={styles.green}>
                          ▶ hear
                        </ThemedText>
                      )}
                    </View>
                  </Pressable>
                  <Pressable onPress={() => chooseVoice(v)} hitSlop={6}>
                    <View style={[styles.voiceBtn, styles.voiceSelect]}>
                      <ThemedText type="code" style={{ color: BG }}>
                        {voiceId === v.id ? '✓ picked' : 'select →'}
                      </ThemedText>
                    </View>
                  </Pressable>
                </View>
              </View>
            ))}
            <Pressable onPress={onGetStarted} disabled={!voiceId}>
              <View style={[styles.getStarted, { opacity: voiceId ? 1 : 0.4 }]}>
                <ThemedText type="smallBold" style={{ color: BG }}>
                  Get started →
                </ThemedText>
              </View>
            </Pressable>
          </ScrollView>
        ) : (
          <>
            <View style={styles.entityArea}>
              <NCNucleus size={232} p={p} level={level} state={state} onPress={onEntityPress} />
              <ThemedText type="code" style={[styles.hint, { color: p.faint }]}>
                {keyboardMode ? '[ keyboard mode — tap the mark for voice ]' : hint}
              </ThemedText>
            </View>
            {keyboardMode ? (
              <View style={styles.typeRow}>
                <TextInput
                  value={typed}
                  onChangeText={setTyped}
                  placeholder="type your answer…"
                  placeholderTextColor="#56575e"
                  multiline
                  style={styles.typeInput}
                  onSubmitEditing={sendTyped}
                />
                <Pressable onPress={sendTyped} disabled={!typed.trim() || state === 'thinking'} hitSlop={8}>
                  <View style={[styles.typeSend, { opacity: !typed.trim() || state === 'thinking' ? 0.4 : 1 }]}>
                    <ThemedText type="code" style={{ color: BG }}>
                      send
                    </ThemedText>
                  </View>
                </Pressable>
              </View>
            ) : null}
            <View style={styles.captions}>
              {state === 'speaking' && words.length ? (
                <ThemedText style={[styles.bigWord, { color: p.ink }]}>{words[wordIdx]}</ThemedText>
              ) : (
                <>
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
                </>
              )}
            </View>
          </>
        )}

        {error ? (
          <ThemedText type="code" style={styles.error}>
            {'! ' + error}
          </ThemedText>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  content: { flex: 1, paddingHorizontal: Spacing.four },
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: '#8a8780', letterSpacing: 1 },
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
    borderColor: '#1c3f6c',
  },
  cornerTL: { left: 12, borderLeftWidth: 1.5, borderTopWidth: 1.5 },
  cornerTR: { right: 12, borderRightWidth: 1.5, borderTopWidth: 1.5 },
  cornerBL: { left: 12, borderLeftWidth: 1.5, borderBottomWidth: 1.5 },
  cornerBR: { right: 12, borderRightWidth: 1.5, borderBottomWidth: 1.5 },
  hint: { color: '#9396a0', letterSpacing: 1 },
  headerSpacer: { flex: 1 },
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  typeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two, paddingBottom: Spacing.two },
  typeInput: {
    flex: 1,
    minHeight: 42,
    maxHeight: 110,
    borderWidth: 1,
    borderColor: '#13294d',
    borderRadius: 4,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    color: '#dfe2e8',
    fontFamily: MONO,
    fontSize: 14,
  },
  typeSend: {
    backgroundColor: '#cdd1d9',
    borderRadius: 4,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },

  captions: { gap: Spacing.two, paddingBottom: Spacing.four, minHeight: 96 },
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
  error: { color: '#ff5c5c', textAlign: 'center', paddingTop: Spacing.two },

  brandScroll: { gap: Spacing.three, paddingTop: Spacing.four },
  selectScroll: { gap: Spacing.three, paddingTop: Spacing.four, paddingBottom: Spacing.four },
  voiceCard: {
    borderWidth: 1,
    borderColor: '#13294d',
    borderRadius: 6,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  voiceMeta: { gap: 2 },
  voiceVibe: { color: '#9396a0' },
  voiceActions: { flexDirection: 'row', gap: Spacing.two },
  voiceBtn: {
    borderWidth: 1,
    borderColor: '#1c3f6c',
    borderRadius: 4,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minWidth: 96,
    alignItems: 'center',
  },
  voiceSelect: { backgroundColor: '#cdd1d9', borderColor: '#cdd1d9' },
  voiceCardOn: { borderColor: '#cdd1d9' },
  getStarted: { backgroundColor: '#cdd1d9', borderRadius: 14, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.three },
  logo: { width: 96, height: 96, borderRadius: 8, borderWidth: 1, borderColor: '#13294d' },
  brandEyebrow: { color: '#8a8780' },
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
    borderColor: '#13294d',
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
