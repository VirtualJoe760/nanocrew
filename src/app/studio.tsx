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
import Svg, { Circle, Line } from 'react-native-svg';

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

// ---------- Nanocrew mark ----------

const MARK = 88;
const HEX = Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 3) * i - Math.PI / 2;
  return { x: MARK / 2 + Math.cos(a) * 40, y: MARK / 2 + Math.sin(a) * 40 };
});

/** Circuit-style Nanocrew "N" monogram inside a hex frame. */
function NanocrewMark({ color }: { color: string }) {
  return (
    <Svg width={MARK} height={MARK}>
      {HEX.map((p, i) => {
        const q = HEX[(i + 1) % 6];
        return <Line key={`h${i}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={color} strokeOpacity={0.55} strokeWidth={1.4} />;
      })}
      {HEX.map((p, i) => (
        <Circle key={`hv${i}`} cx={p.x} cy={p.y} r={2} fill={color} fillOpacity={0.9} />
      ))}
      {/* the N */}
      <Line x1={31} y1={28} x2={31} y2={60} stroke={color} strokeWidth={3} strokeLinecap="round" />
      <Line x1={31} y1={28} x2={57} y2={60} stroke={color} strokeWidth={3} strokeLinecap="round" />
      <Line x1={57} y1={28} x2={57} y2={60} stroke={color} strokeWidth={3} strokeLinecap="round" />
      {[
        [31, 28],
        [31, 60],
        [57, 28],
        [57, 60],
      ].map(([x, y], i) => (
        <Circle key={`n${i}`} cx={x} cy={y} r={3.4} fill={color} />
      ))}
      {/* circuit taps from the N out toward the hex frame */}
      <Line x1={31} y1={44} x2={12} y2={44} stroke={color} strokeOpacity={0.5} strokeWidth={1.2} />
      <Line x1={57} y1={44} x2={76} y2={44} stroke={color} strokeOpacity={0.5} strokeWidth={1.2} />
      <Circle cx={12} cy={44} r={1.8} fill={color} fillOpacity={0.8} />
      <Circle cx={76} cy={44} r={1.8} fill={color} fillOpacity={0.8} />
    </Svg>
  );
}

// ---------- The nucleus ----------

const WEB_SIZE = 260;
const WEB_C = WEB_SIZE / 2;

function buildWeb(): { nodes: Node[]; edges: Edge[]; spokes: Node[] } {
  const nodes: Node[] = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2 + Math.random() * 0.5;
    const radius = 84 + Math.random() * 40;
    return { x: WEB_C + Math.cos(angle) * radius, y: WEB_C + Math.sin(angle) * radius, r: 1.6 + Math.random() * 1.6 };
  });
  const edges: Edge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    edges.push({ a: nodes[i], b: nodes[(i + 1) % nodes.length] });
    if (i % 3 === 0) edges.push({ a: nodes[i], b: nodes[(i + 5) % nodes.length] });
  }
  const spokes = nodes.filter((_, i) => i % 2 === 0);
  return { nodes, edges, spokes };
}

/** Orbiting interconnected node web around the nucleus. */
function NodeWeb({ tempo }: { tempo: number }) {
  const web = useMemo(buildWeb, []);
  const spin = useSharedValue(0);
  const pulse = useSharedValue(0.6);
  useEffect(() => {
    cancelAnimation(spin);
    spin.value = withRepeat(withTiming(spin.value + 360, { duration: 40000, easing: Easing.linear }), -1);
    cancelAnimation(pulse);
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: tempo, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.45, { duration: tempo, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tempo]);
  const style = useAnimatedStyle(() => ({
    opacity: pulse.value,
    transform: [{ rotate: `${spin.value}deg` }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.web, style]}>
      <Svg width={WEB_SIZE} height={WEB_SIZE}>
        {web.spokes.map((n, i) => (
          <Line key={`s${i}`} x1={WEB_C} y1={WEB_C} x2={n.x} y2={n.y} stroke="#00ff7f" strokeOpacity={0.26} strokeWidth={0.8} />
        ))}
        {web.edges.map((e, i) => (
          <Line key={`e${i}`} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} stroke="#00ff7f" strokeOpacity={0.4} strokeWidth={0.9} />
        ))}
        {web.nodes.map((n, i) => (
          <Circle key={`n${i}`} cx={n.x} cy={n.y} r={n.r} fill="#9affd2" fillOpacity={0.85} />
        ))}
      </Svg>
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
      { translateY: -96 },
      { scaleY: 0.18 + level.value * WAVE_MULTS[index] * 2.2 },
    ],
  }));
  return <Animated.View style={[styles.waveBar, { backgroundColor: color }, style]} />;
}

/**
 * The nucleus: the Nanocrew mark inside an orbiting node web, ringed by a live sound
 * wave — the bars ride HER voice while speaking and YOURS while listening, and the core
 * itself vibrates with the audio.
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
  const tempo = state === 'thinking' ? 550 : state === 'speaking' ? 900 : 2600;

  const coreStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 + level.value * 0.16 },
      { rotate: `${(level.value - 0.08) * 5}deg` }, // vibration shiver
    ],
  }));

  return (
    <Pressable onPress={onPress} hitSlop={30} style={styles.nucleusWrap}>
      <NodeWeb tempo={tempo} />
      {Array.from({ length: WAVE_BARS }, (_, i) => (
        <WaveBar key={i} index={i} level={level} color={color} />
      ))}
      <Animated.View style={[styles.coreBox, { shadowColor: color }, coreStyle]}>
        <NanocrewMark color={color} />
      </Animated.View>
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
  waveBar: { position: 'absolute', width: 2.5, height: 22, borderRadius: 1.25, opacity: 0.85 },
  coreBox: {
    shadowOpacity: 0.85,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 0 },
    elevation: 20,
  },
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
