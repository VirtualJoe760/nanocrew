import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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

// The Studio: a voice-first brand interview. A glowing entity floats in space and talks
// you through building your brand — tap it to speak, it listens, thinks, and answers
// aloud (Gemini hears the audio, ElevenLabs gives it a voice).

type EntityState = 'idle' | 'listening' | 'thinking' | 'speaking';

const SPACE_BG = '#030514';
// idle indigo → listening green → thinking violet → speaking cyan
const STATE_COLORS = ['#5b6cff', '#27e0a3', '#a05bff', '#22d3ee'];
const STATE_INDEX: Record<EntityState, number> = { idle: 0, listening: 1, thinking: 2, speaking: 3 };

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

type Star = { x: number; y: number; size: number; base: number; dur: number; delay: number };

function makeStars(count: number): Star[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * SCREEN_W,
    y: Math.random() * SCREEN_H,
    size: 1 + Math.random() * 2.2,
    base: 0.15 + Math.random() * 0.5,
    dur: 1200 + Math.random() * 2600,
    delay: Math.random() * 2000,
  }));
}

function TwinklingStar({ star }: { star: Star }) {
  const opacity = useSharedValue(star.base);
  useEffect(() => {
    opacity.value = withDelay(
      star.delay,
      withRepeat(
        withSequence(
          withTiming(Math.min(1, star.base + 0.5), { duration: star.dur, easing: Easing.inOut(Easing.quad) }),
          withTiming(star.base, { duration: star.dur, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(opacity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.star,
        { left: star.x, top: star.y, width: star.size, height: star.size, borderRadius: star.size / 2 },
        style,
      ]}
    />
  );
}

function Entity({ state, onPress }: { state: EntityState; onPress: () => void }) {
  const stage = useSharedValue(0);
  const breath = useSharedValue(1);
  const ring = useSharedValue(0);

  useEffect(() => {
    stage.value = withTiming(STATE_INDEX[state], { duration: 450 });
    cancelAnimation(breath);
    const tempo = state === 'thinking' ? 420 : state === 'speaking' ? 600 : 2600;
    const amp = state === 'speaking' ? 1.18 : state === 'thinking' ? 1.08 : 1.1;
    breath.value = withRepeat(
      withSequence(
        withTiming(amp, { duration: tempo, easing: Easing.inOut(Easing.sin) }),
        withTiming(1, { duration: tempo, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    );
    cancelAnimation(ring);
    if (state === 'listening') {
      ring.value = 0;
      ring.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) }), -1);
    } else {
      ring.value = withTiming(0, { duration: 300 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const color = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(stage.value, [0, 1, 2, 3], STATE_COLORS),
    shadowColor: interpolateColor(stage.value, [0, 1, 2, 3], STATE_COLORS),
  }));
  const glowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: breath.value * 1.45 }],
    opacity: 0.22,
    backgroundColor: interpolateColor(stage.value, [0, 1, 2, 3], STATE_COLORS),
  }));
  const coreStyle = useAnimatedStyle(() => ({ transform: [{ scale: breath.value }] }));
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + ring.value * 1.1 }],
    opacity: ring.value === 0 ? 0 : 0.65 * (1 - ring.value),
    borderColor: interpolateColor(stage.value, [0, 1, 2, 3], STATE_COLORS),
  }));

  return (
    <Pressable onPress={onPress} hitSlop={30} style={styles.entityWrap}>
      <Animated.View style={[styles.entityGlow, glowStyle]} />
      <Animated.View style={[styles.entityRing, ringStyle]} />
      <Animated.View style={[styles.entityCore, color, coreStyle]}>
        <View style={styles.entityInner} />
      </Animated.View>
    </Pressable>
  );
}

export default function StudioScreen() {
  const insets = useSafeAreaInsets();
  const { session, loading } = useAuth();
  const stars = useMemo(() => makeStars(30), []);

  const [state, setState] = useState<EntityState>('idle');
  const [line, setLine] = useState(''); // what the entity last said
  const [heard, setHeard] = useState(''); // last transcript of the user
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

  // When the entity finishes speaking, go back to idle.
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
          question?: string;
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

  // Opening line once signed in.
  useEffect(() => {
    if (session && !started.current) {
      started.current = true;
      void turn({ init: true });
    }
  }, [session, turn]);

  const onEntityPress = useCallback(async () => {
    if (!session || brand) return;
    if (state === 'thinking') return;
    if (state === 'speaking') player.pause(); // interrupt — go straight to listening

    if (state === 'listening') {
      // Done talking → ship the audio.
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

    // idle (or interrupted speaking) → start listening
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
      ? 'listening — tap when done'
      : state === 'thinking'
        ? 'thinking…'
        : state === 'speaking'
          ? 'tap to interrupt'
          : 'tap to speak';

  const bottomPad = BottomTabInset + insets.bottom + Spacing.three;

  return (
    <View style={styles.container}>
      {stars.map((s, i) => (
        <TwinklingStar key={i} star={s} />
      ))}

      <View style={[styles.content, { paddingTop: insets.top + Spacing.four, paddingBottom: bottomPad }]}>
        <ThemedText type="code" style={styles.eyebrow}>
          Studio
        </ThemedText>

        {loading ? (
          <ActivityIndicator style={styles.center} color="#8a93b8" />
        ) : !session ? (
          <View style={styles.center}>
            <ThemedText style={styles.signInNote}>
              Sign in on the Account tab and the entity will wake up.
            </ThemedText>
          </View>
        ) : brand ? (
          <ScrollView
            style={styles.fill}
            contentContainerStyle={styles.brandScroll}
            showsVerticalScrollIndicator={false}
          >
            <ThemedText type="code" style={styles.brandEyebrow}>
              Your brand
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
                  <ThemedText type="small" style={styles.dim}>
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
                <ThemedText type="smallBold" style={styles.white}>
                  Store created · @{created}
                </ThemedText>
                <ThemedText type="small" style={styles.dim}>
                  Head to Design to start your first drop.
                </ThemedText>
              </View>
            ) : (
              <Pressable onPress={createStore} disabled={creating}>
                <View style={[styles.createBtn, { opacity: creating ? 0.5 : 1 }]}>
                  {creating ? (
                    <ActivityIndicator color={SPACE_BG} />
                  ) : (
                    <ThemedText type="smallBold" style={{ color: SPACE_BG }}>
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
              <ThemedText type="small" style={styles.hint}>
                {hint}
              </ThemedText>
            </View>
            <View style={styles.captions}>
              {heard ? (
                <ThemedText type="small" style={styles.heard} numberOfLines={2}>
                  “{heard}”
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
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SPACE_BG },
  content: { flex: 1, paddingHorizontal: Spacing.four },
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { textTransform: 'uppercase', color: '#5e6587' },
  star: { position: 'absolute', backgroundColor: '#cdd6ff' },
  signInNote: { color: '#8a93b8', textAlign: 'center', maxWidth: 280 },

  entityArea: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.five },
  entityWrap: { width: 200, height: 200, alignItems: 'center', justifyContent: 'center' },
  entityGlow: { position: 'absolute', width: 140, height: 140, borderRadius: 70 },
  entityRing: { position: 'absolute', width: 150, height: 150, borderRadius: 75, borderWidth: 1.5 },
  entityCore: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.9,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 0 },
    elevation: 24,
  },
  entityInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.85)',
    opacity: 0.35,
  },
  hint: { color: '#8a93b8' },

  captions: { gap: Spacing.two, paddingBottom: Spacing.three, minHeight: 96 },
  heard: { color: '#5e6587', textAlign: 'center' },
  line: { color: '#e7ebff', textAlign: 'center', fontSize: 17, lineHeight: 24 },
  error: { color: '#ff6b6a', textAlign: 'center', paddingTop: Spacing.two },

  brandScroll: { gap: Spacing.three, paddingTop: Spacing.four },
  brandEyebrow: { textTransform: 'uppercase', color: '#5e6587' },
  white: { color: '#ffffff' },
  dim: { color: '#aab3d6' },
  paletteRow: { flexDirection: 'row', gap: Spacing.two },
  swatchCol: { alignItems: 'center', gap: Spacing.one, flex: 1 },
  swatch: { width: '100%', aspectRatio: 1, borderRadius: Spacing.two },
  swatchLabel: { fontSize: 10, color: '#5e6587' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderWidth: 1,
    borderColor: '#2a3052',
    borderRadius: 999,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one,
  },
  createBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    borderRadius: 999,
    minHeight: 48,
    backgroundColor: '#e7ebff',
    gap: 2,
    marginTop: Spacing.two,
  },
  createdBox: { backgroundColor: '#141a33' },
});
