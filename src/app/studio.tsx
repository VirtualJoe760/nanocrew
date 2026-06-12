import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import Svg, { Circle, Defs, Line, Path, RadialGradient, Stop } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { apiUrl } from '@/lib/api';
import type { BrandResult, ChatMessage } from '@/lib/interview';

// The Studio: a voice-first brand interview. A nano-entity — flickering pixel core inside
// counter-rotating rings, digital rain behind — talks you through building your brand.
// Tap it to speak; Gemini hears the audio, ElevenLabs gives the reply a voice.

type EntityState = 'idle' | 'listening' | 'thinking' | 'speaking';

const BG = '#010604';
// idle green → listening mint → thinking cyan → speaking lime
const STATE_COLORS = ['#00ff7f', '#8fffd0', '#39d9ff', '#c8ff4a'];
const STATE_INDEX: Record<EntityState, number> = { idle: 0, listening: 1, thinking: 2, speaking: 3 };

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
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
          <Line key={`e${i}`} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} stroke="#00ff7f" strokeOpacity={0.09} strokeWidth={0.7} />
        ))}
        {mesh.nodes.map((n, i) => (
          <Circle key={`n${i}`} cx={n.x} cy={n.y} r={n.r} fill="#00ff7f" fillOpacity={0.22} />
        ))}
      </Svg>
    </Animated.View>
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

const TONES = ['#00ff7f', '#7dffc8', '#d8ffe9', '#1fbf6e'];
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
        <Line key={`l${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#00ff7f" strokeOpacity={l.o} strokeWidth={0.5} />
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
function CoreLight({ level, color }: { level: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + level.value * 0.45 }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.coreLight, style]}>
      <Svg width={120} height={120}>
        <Defs>
          <RadialGradient id="bloom" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <Stop offset="22%" stopColor="#eafff3" stopOpacity="0.95" />
            <Stop offset="48%" stopColor={color} stopOpacity="0.55" />
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
      <CoreLight level={level} color={color} />
    </Pressable>
  );
}

// ---------- Screen ----------

export default function StudioScreen() {
  const insets = useSafeAreaInsets();
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

  useEffect(() => {
    if (playerStatus.didJustFinish) setState('idle');
  }, [playerStatus.didJustFinish]);

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
    async (body: { init?: boolean; audio?: string }) => {
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
          body: JSON.stringify({ ...body, messages: messages.current }),
        });
        const d = (await r.json()) as {
          userText?: string;
          done?: boolean;
          brand?: BrandResult;
          line?: string;
          speech?: string;
          error?: string;
        };
        if (d.error) throw new Error(d.error);
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
    [session, playSpeech],
  );

  useEffect(() => {
    if (session && !started.current) {
      started.current = true;
      void turn({ init: true });
    }
  }, [session, turn]);

  const onEntityPress = useCallback(async () => {
    if (!session || brand) return;
    if (state === 'thinking') return;
    if (state === 'speaking') player.pause();

    if (state === 'listening') {
      try {
        await recorder.stop();
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        const uri = recorder.uri;
        if (!uri) throw new Error('No recording captured');
        const audio = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        void turn({ audio });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Recording failed');
        setState('idle');
      }
      return;
    }

    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError('Microphone permission needed — enable it in Settings.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setState('listening');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the microphone');
    }
  }, [session, brand, state, player, recorder, turn]);

  const createStore = useCallback(async () => {
    if (!session || !brand) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch(apiUrl('/api/store'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ brand }),
      });
      const d = (await r.json()) as {
        store?: { slug: string; logoUrl?: string | null };
        error?: string;
      };
      if (!d.store) throw new Error(d.error || 'Failed to create store');
      setCreated(d.store.slug);
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
      ? '[ listening — tap to send ]'
      : state === 'thinking'
        ? '[ processing… ]'
        : state === 'speaking'
          ? '[ tap to interrupt ]'
          : '[ tap to speak ]';

  const bottomPad = BottomTabInset + insets.bottom + Spacing.three;

  return (
    <View style={styles.container}>
      <NetworkField />
      {/* HUD corner brackets */}
      <View pointerEvents="none" style={[styles.corner, styles.cornerTL, { top: insets.top + 8 }]} />
      <View pointerEvents="none" style={[styles.corner, styles.cornerTR, { top: insets.top + 8 }]} />
      <View pointerEvents="none" style={[styles.corner, styles.cornerBL, { bottom: bottomPad - 8 }]} />
      <View pointerEvents="none" style={[styles.corner, styles.cornerBR, { bottom: bottomPad - 8 }]} />

      <View style={[styles.content, { paddingTop: insets.top + Spacing.four, paddingBottom: bottomPad }]}>
        <View style={styles.headerRow}>
          <View style={styles.markBadge}>
            <NanocrewMark color="#00ff7f" />
          </View>
          <ThemedText type="code" style={styles.eyebrow}>
            STUDIO // BRAND.SYS
          </ThemedText>
        </View>

        {loading ? (
          <ActivityIndicator style={styles.center} color="#00ff7f" />
        ) : !session ? (
          <View style={styles.center}>
            <ThemedText style={styles.signInNote}>
              {'> sign in on the Account tab\n> the entity will wake up'}
            </ThemedText>
          </View>
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
            <ThemedText type="subtitle" style={styles.white}>
              {brand.name}
            </ThemedText>
            <ThemedText type="small" style={styles.dim}>
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
            <ThemedText type="small" style={styles.dim}>
              {brand.story}
            </ThemedText>
            {created ? (
              <View style={[styles.createBtn, styles.createdBox]}>
                <ThemedText type="code" style={styles.green}>
                  {'> store online · @' + created}
                </ThemedText>
                <ThemedText type="small" style={styles.dim}>
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
        ) : (
          <>
            <View style={styles.entityArea}>
              <Nucleus state={state} level={level} onPress={onEntityPress} />
              <ThemedText type="code" style={styles.hint}>
                {hint}
              </ThemedText>
            </View>
            <View style={styles.captions}>
              {heard ? (
                <ThemedText type="code" style={styles.heard} numberOfLines={2}>
                  {'you > ' + heard}
                </ThemedText>
              ) : null}
              {line ? (
                <ThemedText style={styles.line} numberOfLines={4}>
                  {line}
                </ThemedText>
              ) : null}
            </View>
          </>
        )}

        {error ? (
          <ThemedText type="code" style={styles.error}>
            {'! ' + error}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  content: { flex: 1, paddingHorizontal: Spacing.four },
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: '#1f7a4d', letterSpacing: 1 },
  signInNote: { color: '#3fae77', textAlign: 'center', fontFamily: MONO, fontSize: 14, lineHeight: 22 },

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
    borderColor: '#1c5c3b',
  },
  cornerTL: { left: 12, borderLeftWidth: 1.5, borderTopWidth: 1.5 },
  cornerTR: { right: 12, borderRightWidth: 1.5, borderTopWidth: 1.5 },
  cornerBL: { left: 12, borderLeftWidth: 1.5, borderBottomWidth: 1.5 },
  cornerBR: { right: 12, borderRightWidth: 1.5, borderBottomWidth: 1.5 },
  hint: { color: '#3fae77', letterSpacing: 1 },

  captions: { gap: Spacing.two, paddingBottom: Spacing.three, minHeight: 96 },
  heard: { color: '#2c7a55', textAlign: 'center' },
  line: { color: '#d8ffe9', textAlign: 'center', fontSize: 16, lineHeight: 23, fontFamily: MONO },
  error: { color: '#ff5c5c', textAlign: 'center', paddingTop: Spacing.two },

  brandScroll: { gap: Spacing.three, paddingTop: Spacing.four },
  logo: { width: 96, height: 96, borderRadius: 8, borderWidth: 1, borderColor: '#134d31' },
  brandEyebrow: { color: '#1f7a4d' },
  white: { color: '#eafff3' },
  dim: { color: '#7dd6a8' },
  green: { color: '#00ff7f' },
  paletteRow: { flexDirection: 'row', gap: Spacing.two },
  swatchCol: { alignItems: 'center', gap: Spacing.one, flex: 1 },
  swatch: { width: '100%', aspectRatio: 1, borderRadius: 3 },
  swatchLabel: { fontSize: 10, color: '#3fae77' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderWidth: 1,
    borderColor: '#134d31',
    borderRadius: 3,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one,
  },
  chipText: { color: '#7dd6a8', fontSize: 11 },
  createBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    borderRadius: 4,
    minHeight: 48,
    backgroundColor: '#00ff7f',
    gap: 2,
    marginTop: Spacing.two,
  },
  createdBox: { backgroundColor: '#06281a' },
});
