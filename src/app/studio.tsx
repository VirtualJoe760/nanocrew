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
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';

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
const MATRIX_DIM = '#00ff8822';
// idle green → listening mint → thinking cyan → speaking lime
const STATE_COLORS = ['#00ff7f', '#8fffd0', '#39d9ff', '#c8ff4a'];
const STATE_INDEX: Record<EntityState, number> = { idle: 0, listening: 1, thinking: 2, speaking: 3 };

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ---------- Digital rain ----------

const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789Z';

type RainColumn = { x: number; text: string; dur: number; delay: number; opacity: number };

function makeRain(count: number): RainColumn[] {
  return Array.from({ length: count }, (_, i) => ({
    x: (SCREEN_W / count) * i + Math.random() * 14,
    text: Array.from(
      { length: 14 + Math.floor(Math.random() * 10) },
      () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
    ).join('\n'),
    dur: 7000 + Math.random() * 9000,
    delay: Math.random() * 6000,
    opacity: 0.1 + Math.random() * 0.18,
  }));
}

function RainStrand({ col }: { col: RainColumn }) {
  const y = useSharedValue(-460);
  useEffect(() => {
    y.value = withDelay(
      col.delay,
      withRepeat(withTiming(SCREEN_H + 60, { duration: col.dur, easing: Easing.linear }), -1),
    );
    return () => cancelAnimation(y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <Animated.Text
      pointerEvents="none"
      style={[styles.rain, { left: col.x, opacity: col.opacity }, style]}
    >
      {col.text}
    </Animated.Text>
  );
}

// ---------- Nano entity ----------

const PIXELS = 25; // 5×5 nano-pixel core

function NanoPixel({ index, stage }: { index: number; stage: SharedValue<number> }) {
  const flicker = useSharedValue(0.25 + Math.random() * 0.6);
  useEffect(() => {
    flicker.value = withDelay(
      Math.random() * 1200,
      withRepeat(
        withSequence(
          withTiming(0.15 + Math.random() * 0.3, { duration: 240 + Math.random() * 700 }),
          withTiming(0.6 + Math.random() * 0.4, { duration: 240 + Math.random() * 700 }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(flicker);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: flicker.value,
    backgroundColor: interpolateColor(stage.value, [0, 1, 2, 3], STATE_COLORS),
  }));
  // Center pixel stays solid — the "eye".
  const isEye = index === 12;
  return <Animated.View style={[styles.pixel, isEye && styles.pixelEye, style]} />;
}

function Entity({ state, onPress }: { state: EntityState; onPress: () => void }) {
  const stage = useSharedValue(0);
  const spinA = useSharedValue(0);
  const spinB = useSharedValue(0);
  const ring = useSharedValue(0);

  useEffect(() => {
    stage.value = withTiming(STATE_INDEX[state], { duration: 400 });
    const speed = state === 'thinking' ? 2200 : state === 'speaking' ? 4500 : 9000;
    cancelAnimation(spinA);
    cancelAnimation(spinB);
    spinA.value = withRepeat(withTiming(spinA.value + 360, { duration: speed, easing: Easing.linear }), -1);
    spinB.value = withRepeat(withTiming(spinB.value - 360, { duration: speed * 1.6, easing: Easing.linear }), -1);
    cancelAnimation(ring);
    if (state === 'listening') {
      ring.value = 0;
      ring.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1);
    } else {
      ring.value = withTiming(0, { duration: 250 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const ringA = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spinA.value}deg` }],
    borderColor: interpolateColor(stage.value, [0, 1, 2, 3], STATE_COLORS),
  }));
  const ringB = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spinB.value}deg` }],
    borderColor: interpolateColor(stage.value, [0, 1, 2, 3], STATE_COLORS),
  }));
  const sonar = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + ring.value * 1.15 }],
    opacity: ring.value === 0 ? 0 : 0.7 * (1 - ring.value),
    borderColor: interpolateColor(stage.value, [0, 1, 2, 3], STATE_COLORS),
  }));
  const glow = useAnimatedStyle(() => ({
    shadowColor: interpolateColor(stage.value, [0, 1, 2, 3], STATE_COLORS),
  }));

  return (
    <Pressable onPress={onPress} hitSlop={30} style={styles.entityWrap}>
      <Animated.View style={[styles.sonar, sonar]} />
      <Animated.View style={[styles.ringOuter, ringA]} />
      <Animated.View style={[styles.ringInner, ringB]} />
      <Animated.View style={[styles.coreBox, glow]}>
        <View style={styles.pixelGrid}>
          {Array.from({ length: PIXELS }, (_, i) => (
            <NanoPixel key={i} index={i} stage={stage} />
          ))}
        </View>
      </Animated.View>
    </Pressable>
  );
}

// ---------- Screen ----------

export default function StudioScreen() {
  const insets = useSafeAreaInsets();
  const { session, loading } = useAuth();
  const rain = useMemo(() => makeRain(11), []);

  const [state, setState] = useState<EntityState>('idle');
  const [line, setLine] = useState('');
  const [heard, setHeard] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [brand, setBrand] = useState<BrandResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  const messages = useRef<ChatMessage[]>([]);
  const started = useRef(false);
  const playCount = useRef(0);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const player = useAudioPlayer();
  const playerStatus = useAudioPlayerStatus(player);

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
      const d = (await r.json()) as { store?: { slug: string }; error?: string };
      if (!d.store) throw new Error(d.error || 'Failed to create store');
      setCreated(d.store.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create store');
    } finally {
      setCreating(false);
    }
  }, [session, brand]);

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
      {rain.map((c, i) => (
        <RainStrand key={i} col={c} />
      ))}

      <View style={[styles.content, { paddingTop: insets.top + Spacing.four, paddingBottom: bottomPad }]}>
        <ThemedText type="code" style={styles.eyebrow}>
          STUDIO // BRAND.SYS
        </ThemedText>

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
              <Entity state={state} onPress={onEntityPress} />
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
  rain: {
    position: 'absolute',
    top: 0,
    color: MATRIX_DIM,
    fontFamily: MONO,
    fontSize: 13,
    lineHeight: 15,
  },
  signInNote: { color: '#3fae77', textAlign: 'center', fontFamily: MONO, fontSize: 14, lineHeight: 22 },

  entityArea: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.five },
  entityWrap: { width: 220, height: 220, alignItems: 'center', justifyContent: 'center' },
  sonar: { position: 'absolute', width: 170, height: 170, borderRadius: 85, borderWidth: 1 },
  ringOuter: {
    position: 'absolute',
    width: 168,
    height: 168,
    borderRadius: 84,
    borderWidth: 1,
    borderStyle: 'dashed',
    opacity: 0.55,
  },
  ringInner: {
    position: 'absolute',
    width: 128,
    height: 128,
    borderRadius: 64,
    borderWidth: 1,
    borderStyle: 'dashed',
    opacity: 0.8,
  },
  coreBox: {
    shadowOpacity: 0.85,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 0 },
    elevation: 20,
  },
  pixelGrid: {
    width: 80,
    height: 80,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignContent: 'space-between',
  },
  pixel: { width: 12, height: 12, borderRadius: 2 },
  pixelEye: { borderRadius: 6 },
  hint: { color: '#3fae77', letterSpacing: 1 },

  captions: { gap: Spacing.two, paddingBottom: Spacing.three, minHeight: 96 },
  heard: { color: '#2c7a55', textAlign: 'center' },
  line: { color: '#d8ffe9', textAlign: 'center', fontSize: 16, lineHeight: 23, fontFamily: MONO },
  error: { color: '#ff5c5c', textAlign: 'center', paddingTop: Spacing.two },

  brandScroll: { gap: Spacing.three, paddingTop: Spacing.four },
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
