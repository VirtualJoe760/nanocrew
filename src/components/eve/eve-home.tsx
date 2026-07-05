import { useCallback, useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AudioModule, setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';

import { BrandReview } from '@/components/brand-review';
import { ChatInterview } from '@/components/chat-interview';
import VenusAvatar, { type VenusStage } from '@/components/venus-avatar';
import { InterviewTopics } from '@/components/interview-topics';
import { Paywall } from '@/components/paywall';
import { ThemedText } from '@/components/themed-text';
import { usePalette } from '@/components/nc-screen';
import { glow } from '@/constants/glow';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useLiveVoice } from '@/hooks/use-live-voice';
import { apiUrl, readJson } from '@/lib/api';
import { sendDesignCommand } from '@/lib/design-bus';
import { emitEveEvent } from '@/lib/eve-bus';
import { venusGuide, type VenusGuidance, type VenusToolKey } from '@/lib/venus-guide';
import type { BrandResult, ChatMessage } from '@/lib/interview';

// EVE'S HOME STATE — her steady state inside the overlay (docs/studio/VENUS_CENTRAL.md). This is
// the brand INTERVIEW, moved wholesale out of studio.tsx (the Studio is now viewing-only): the
// full-bleed neural-constellation avatar, live Gemini voice, subtitles, the buildReady gate, the
// BrandReview → createStore finish, and the launch fanfare — plus her GUIDE view (greeting +
// next-best-action chips) for creators who already have a store.
//
// Two views:  guide  — greeting + tools (build brand · edit site · designs · memes · posts)
//             interview — the voice interview → BrandReview when she's extracted the brand
//
// The GL avatar mounts only when `ready` (the overlay's slide-in is done) and only in views that
// show her (never behind BrandReview or the full-screen chat) — one GL context, ever.

const LIVE_VOICE = 'Kore'; // Joe's pick (Lab audition 2026-07-05): Kore × the 'british robot' delivery

type EntityState = 'idle' | 'listening' | 'thinking' | 'speaking';

// Map the interview's EntityState → the avatar's lifecycle stage. Formed + listening at rest;
// `talking` only while Eve speaks. The materialize (`morphing`) plays as an intro on entry.
function stageFor(state: EntityState, intro: boolean): VenusStage {
  if (intro) return 'morphing';
  return state === 'speaking' ? 'talking' : 'silence';
}

const BG = '#08080a'; // dark ink for text ON the gold accent buttons
const AI_NAME = 'Eve';

export function EveHome({
  open,
  ready,
  onRequestClose,
}: {
  /** The overlay is on screen (gates the live session — she is never vocal while hidden). */
  open: boolean;
  /** Slide-in finished — safe to mount the GL avatar. */
  ready: boolean;
  onRequestClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const p = usePalette();
  const { session } = useAuth();

  const [view, setView] = useState<'guide' | 'interview'>('guide');
  const [state, setState] = useState<EntityState>('idle');
  const [line, setLine] = useState('');
  const [heard, setHeard] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [brand, setBrand] = useState<BrandResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [intro, setIntro] = useState(false);
  const [paywall, setPaywall] = useState<'subscription_required' | 'brand_limit' | null>(null);
  const [keyboardMode, setKeyboardMode] = useState(false);
  const [paused, setPaused] = useState(false);
  const [appActive, setAppActive] = useState(true);
  const [guidance, setGuidance] = useState<VenusGuidance | null>(null);
  const [hasStore, setHasStore] = useState(false);

  const messages = useRef<ChatMessage[]>([]);
  const playCount = useRef(0);
  const playGenRef = useRef(0); // bumps each playSpeech so a stale playback watchdog bails
  const pausedRef = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;

  // Her read of the creator's world — refetched each time the overlay opens (cheap /api/me).
  useEffect(() => {
    if (!open || !session?.access_token) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch(apiUrl('/api/me'), { headers: { Authorization: `Bearer ${session.access_token}` } });
        const d = (await r.json().catch(() => ({}))) as {
          profile?: { name?: string };
          stores?: { name: string; slug: string; status: string }[];
        };
        if (!alive) return;
        const firstName = (d.profile?.name ?? (session.user?.user_metadata?.name as string | undefined))
          ?.trim()
          .split(/\s+/)[0];
        setHasStore((d.stores?.length ?? 0) > 0);
        setGuidance(venusGuide({ firstName, stores: d.stores ?? [] }));
      } catch {
        if (alive) setGuidance(venusGuide({ stores: [] }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, session]);

  // ---- Gemini Live wiring (the realtime speech-to-speech interview; GEMINI_LIVE.md) ----
  const creatorName =
    (session?.user?.user_metadata?.name as string | undefined) ??
    (session?.user?.user_metadata?.full_name as string | undefined) ??
    undefined;
  const live = useLiveVoice({
    accessToken: session?.access_token,
    userName: creatorName,
    firstTime: !hasStore,
    voiceName: LIVE_VOICE,
    onBrand: (b, transcript) => {
      setBrand(b);
      if (transcript?.length) messages.current = transcript;
    },
  });
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

  // Build is GATED: Eve gathers the essentials first, then invites them to build — that's when the
  // button appears. Latch "ready" when she signals it, floored at 3 answers; a 6-answer safety net
  // ensures the button always eventually appears. Resets when a fresh interview clears the transcript.
  const [buildReady, setBuildReady] = useState(false);
  useEffect(() => {
    if (!live.messages.length) { setBuildReady(false); return; }
    if (buildReady) return;
    const userTurns = live.messages.filter((m) => m.role === 'user').length;
    const lastEve = [...live.messages].reverse().find((m) => m.role === 'assistant')?.text ?? '';
    const cue = /\b(ready to build|ready to (create|launch|go)|build your (brand|store|site|shop)|(everything|all)\s+(i|we)\s+need|got everything|let'?s build|time to build|shall we build)\b/i;
    if (userTurns >= 6 || (userTurns >= 3 && cue.test(lastEve))) setBuildReady(true);
  }, [live.messages, buildReady]);

  // The ONE rule for when Eve is live: her overlay is on screen, in the interview, app foregrounded,
  // and not paused / already done. Anything else → stop, so she's never vocal outside her view.
  // (Pause is a VOICE concept — in keyboard mode it must not gate the session or typed turns hang.)
  useEffect(() => {
    const inHerView = view === 'interview' && !brand && open && appActive;
    if (inHerView && (keyboardMode || !paused)) live.start();
    else live.stop();
  }, [view, brand, paused, keyboardMode, open, appActive, live.start, live.stop]);
  // Keyboard/chat mode mutes the mic so Eve doesn't react to the room while you type.
  useEffect(() => { live.mute(keyboardMode); }, [keyboardMode, live.state, live.mute]);
  useEffect(() => {
    setAppActive(AppState.currentState === 'active');
    const sub = AppState.addEventListener('change', (st) => setAppActive(st === 'active'));
    return () => sub.remove();
  }, []);

  // The launch fanfare (post-createStore /api/say) — one-shot playback with the load/no-op guards
  // carried over from the Studio (see playSpeech history there: silent play() races on iOS).
  const player = useAudioPlayer();
  const playSpeech = useCallback(
    async (b64: string, ext: 'mp3' | 'wav' = 'wav') => {
      const gen = ++playGenRef.current;
      const file = `${FileSystem.cacheDirectory}eve-${playCount.current++}.${ext}`;
      await FileSystem.writeAsStringAsync(file, b64, { encoding: FileSystem.EncodingType.Base64 });
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (!openRef.current || pausedRef.current) { setState('idle'); return; }
      try {
        player.replace({ uri: file });
      } catch {
        setState('idle');
        return;
      }
      // Wait for the clip to actually LOAD before play() — play() on an unloaded source no-ops.
      for (let i = 0; i < 25 && !player.isLoaded; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (gen !== playGenRef.current) return;
      }
      if (gen !== playGenRef.current || !openRef.current || pausedRef.current) { setState('idle'); return; }
      setState('speaking');
      player.play();
      // Watchdog: confirm playback ACTUALLY started; nudge twice, then drop to idle — never hang.
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (gen !== playGenRef.current || pausedRef.current) return;
        if (player.playing || player.currentTime > 0.02) return;
        if (i === 4 || i === 9) {
          try {
            await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
            player.play();
          } catch {}
        }
      }
      if (gen === playGenRef.current && !player.playing && player.currentTime <= 0.02) setState('idle');
    },
    [player],
  );

  // Entering the interview requests the mic HERE — the OS dialog appears when the user chooses to
  // talk, before the Live session opens its recorder. On denial, fall back to typing.
  const startVoice = useCallback(async () => {
    setKeyboardMode(false);
    setPaused(false);
    pausedRef.current = false;
    const perm = await AudioModule.requestRecordingPermissionsAsync().catch(() => null);
    if (!perm?.granted) {
      setKeyboardMode(true);
      setError('No microphone access — you can type your answers, or enable the mic in Settings.');
    }
    setView('interview');
  }, []);
  const startText = useCallback(() => {
    setKeyboardMode(true);
    setPaused(false);
    pausedRef.current = false;
    setView('interview');
  }, []);

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

  const toggleKeyboard = useCallback(() => {
    const entering = !keyboardMode;
    setKeyboardMode(entering);
    if (entering) {
      setPaused(false); // pause is voice-only — the chat must always reply
      pausedRef.current = false;
    }
  }, [keyboardMode]);

  // "Try again" from the mic-busy modal: they (hopefully) ended their call — reconnect.
  const retryAfterCall = useCallback(() => {
    live.dismissAudioBusy();
    if (pausedRef.current) { pausedRef.current = false; setPaused(false); }
    live.start();
  }, [live.dismissAudioBusy, live.start]);

  // Back out of the interview (or finish a brand) → the guide, reset for a fresh run.
  const resetToGuide = useCallback(() => {
    messages.current = [];
    setBrand(null);
    setCreated(null);
    setHeard('');
    setLine('');
    setKeyboardMode(false);
    setView('guide');
  }, []);

  const onFinishedBrand = useCallback(() => {
    setHasStore(true);
    resetToGuide();
  }, [resetToGuide]);

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
      if (r.status === 402) {
        const g = (await r.json()) as { error?: string };
        setPaywall(g.error === 'brand_limit' ? 'brand_limit' : 'subscription_required');
        return;
      }
      const d = await readJson<{ store?: { slug: string; logoUrl?: string | null }; error?: string }>(r);
      if (!d.store) throw new Error(d.error || 'Failed to create store');
      setCreated(d.store.slug);
      setHasStore(true);
      setLogoUrl(d.store.logoUrl ?? null);
      emitEveEvent({ kind: 'store-created', slug: d.store.slug }); // the Studio dashboard refetches
      // Eve announces the launch in her OWN voice (Kore /api/say) — the live session is already
      // torn down by finalize() at this point, so the one-shot keeps the voice consistent.
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

  // Guide chips: build-brand starts the interview HERE; the rest route into the app beneath.
  const runTool = useCallback(
    (key: VenusToolKey) => {
      switch (key) {
        case 'build-brand':
          void startVoice();
          return;
        case 'edit-site':
          onRequestClose();
          router.push('/studio');
          return;
        case 'create-designs':
          onRequestClose();
          sendDesignCommand({ kind: 'open-generate' });
          router.push('/design');
          return;
        case 'make-meme':
          onRequestClose();
          sendDesignCommand({ kind: 'open-generate', meme: true });
          router.push('/design');
          return;
        case 'blog-post':
          onRequestClose();
          router.push('/studio');
          return;
      }
    },
    [startVoice, onRequestClose],
  );

  // Play her materialize (`morphing`) for ~4.2s each time the interview view (re)appears.
  const inVoiceInterview = view === 'interview' && !brand && !keyboardMode;
  useEffect(() => {
    if (!inVoiceInterview || !ready) { setIntro(false); return; }
    setIntro(true);
    const t = setTimeout(() => setIntro(false), 4200);
    return () => clearTimeout(t);
  }, [inVoiceInterview, ready]);

  const hint =
    state === 'listening'
      ? '[ listening — just talk ]'
      : state === 'thinking'
        ? '[ thinking… ]'
        : state === 'speaking'
          ? `[ ${AI_NAME} is speaking — tap to pause ]`
          : paused
            ? '[ paused — tap to resume ]'
            : '[ connecting… ]';

  // The avatar renders full-bleed in the guide and the voice interview — never behind the
  // BrandReview scroll or the full-screen chat (GL off while she's not the face of the moment).
  const showAvatar = ready && !brand && !keyboardMode;
  const stage: VenusStage = view === 'interview' ? stageFor(state, intro) : 'silence';

  const bottomPad = insets.bottom + 44; // clear the overlay's dismiss handle

  return (
    <View style={styles.fill}>
      {showAvatar ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <VenusAvatar stage={stage} />
        </View>
      ) : null}

      {/* Mic-busy: iOS refused the audio session — almost always an active phone/FaceTime call. */}
      <Modal visible={live.audioBusy} animationType="fade" transparent onRequestClose={live.dismissAudioBusy}>
        <View style={styles.busyBackdrop}>
          <View style={[styles.busyCard, { backgroundColor: p.bgTop, borderColor: p.line }]}>
            <ThemedText type="code" style={[styles.busyEyebrow, { color: p.accent }]}>MICROPHONE IN USE</ThemedText>
            <ThemedText type="title" style={[styles.busyTitle, { color: p.ink }]}>You’re on a call</ThemedText>
            <ThemedText type="small" style={[styles.busyBody, { color: p.dim }]}>
              {AI_NAME} needs your microphone, but another app — most likely an active phone or FaceTime
              call — is using it. End your call, then come back and tap Try again.
            </ThemedText>
            <Pressable
              onPress={retryAfterCall}
              style={({ pressed }) => [styles.busyPrimary, { backgroundColor: p.accent }, glow(p.accent, 18, pressed ? 0.3 : 0.6), pressed && { transform: [{ scale: 0.98 }] }]}>
              <ThemedText type="smallBold" style={{ color: BG }}>Try again</ThemedText>
            </Pressable>
            <Pressable onPress={live.dismissAudioBusy} hitSlop={8} style={styles.busySecondary}>
              <ThemedText type="code" style={{ color: p.dim }}>Not now</ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>

      {session ? (
        <Paywall
          visible={!!paywall}
          onClose={() => setPaywall(null)}
          token={session.access_token}
          reason={paywall ?? 'subscription_required'}
          onFreeSlot={() => setPaywall(null)}
        />
      ) : null}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[styles.content, { paddingTop: insets.top + Spacing.four, paddingBottom: bottomPad }]}>
        <View style={styles.headerRow}>
          <ThemedText type="code" style={[styles.eyebrow, { color: p.dim }]}>
            EVE
          </ThemedText>
          <View style={styles.headerSpacer} />
          {view === 'interview' && !brand ? (
            <View style={styles.headerIcons}>
              <Pressable onPress={resetToGuide} hitSlop={10} accessibilityLabel="Back to Eve's tools">
                <ThemedText type="code" style={{ color: p.dim, fontSize: 15 }}>‹ tools</ThemedText>
              </Pressable>
              {!keyboardMode ? (
                <Pressable onPress={togglePause} hitSlop={10} accessibilityLabel={paused ? 'Resume' : 'Pause'}>
                  <ThemedText type="code" style={{ color: paused ? p.accent : p.dim, fontSize: 16 }}>
                    {paused ? '▶' : '❚❚'}
                  </ThemedText>
                </Pressable>
              ) : null}
              {!keyboardMode ? (
                <Pressable onPress={toggleKeyboard} hitSlop={10} accessibilityLabel="Type instead">
                  <ThemedText type="code" style={{ color: p.dim, fontSize: 15 }}>⌨</ThemedText>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>

        {!session ? (
          <View style={styles.guideWrap}>
            <ThemedText type="title" style={[styles.guideTitle, { color: p.ink }]}>Meet {AI_NAME}</ThemedText>
            <ThemedText type="small" style={[styles.guideBody, { color: p.dim }]}>
              Your AI brand consultant. Talk it through, and {AI_NAME} designs your clothing brand,
              builds the store, and launches your website. Sign in to start.
            </ThemedText>
            <Pressable
              onPress={() => { onRequestClose(); router.navigate('/account'); }}
              style={({ pressed }) => [styles.ctaPrimary, { backgroundColor: p.accent }, glow(p.accent, 18, pressed ? 0.3 : 0.6), pressed && { transform: [{ scale: 0.98 }] }]}>
              <ThemedText type="smallBold" style={{ color: BG }}>Create an account</ThemedText>
            </Pressable>
          </View>
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
        ) : view === 'guide' ? (
          <View style={styles.guideWrap}>
            <ThemedText style={[styles.greeting, { color: p.ink }]}>{guidance?.greeting ?? '…'}</ThemedText>
            <View style={styles.chips}>
              {(guidance?.suggestions ?? []).map((s) => (
                <Pressable key={s.key} onPress={() => runTool(s.key)} style={[styles.chip, { borderColor: `${p.accent}38` }]}>
                  <ThemedText style={[styles.chipLabel, { color: p.ink }]}>{s.label}</ThemedText>
                  <ThemedText style={[styles.chipDetail, { color: p.dim }]}>{s.detail}</ThemedText>
                </Pressable>
              ))}
            </View>
            {!hasStore ? (
              <Pressable onPress={startText} hitSlop={8} style={{ marginTop: Spacing.three, alignSelf: 'center' }}>
                <ThemedText type="code" style={{ color: p.dim }}>I’d rather type</ThemedText>
              </Pressable>
            ) : null}
            <ThemedText type="code" style={[styles.guideFoot, { color: p.faint }]}>
              slide up to pause {AI_NAME} · she asks for your mic only when you start talking
            </ThemedText>
          </View>
        ) : keyboardMode ? null : (
          <>
            {/* "What to talk about" — name, products, style, colors, logo, vibe; checks off as they go. */}
            <InterviewTopics messages={live.messages} onAsk={live.sendText} p={p} />
            <View style={styles.entityArea}>
              <ThemedText type="code" style={[styles.hint, { color: p.faint }]}>
                {hint}
              </ThemedText>
              <Pressable onPress={togglePause} hitSlop={12} style={[styles.pausePill, { borderColor: paused ? p.accent : `${p.dim}66` }]}>
                <ThemedText type="code" style={{ color: paused ? p.accent : p.dim, fontSize: 13, letterSpacing: 1 }}>
                  {paused ? '▶  Resume' : '❚❚  Pause'}
                </ThemedText>
              </Pressable>
              {/* Build only appears once Eve has gathered the essentials (buildReady). */}
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
            {/* SUBTITLES — always on, per Joe: what Eve hears, and what she's saying. */}
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
          <Pressable onPress={() => setError(null)} style={[styles.errorBar, { bottom: bottomPad }]}>
            <ThemedText type="code" style={styles.error}>{error}</ThemedText>
            <ThemedText type="code" style={styles.errorDismiss}>tap to dismiss</ThemedText>
          </Pressable>
        ) : null}
      </KeyboardAvoidingView>

      {/* Keyboard mode = a full-screen chat window over the overlay (text-only; her voice muted). */}
      {session && view === 'interview' && !brand && keyboardMode ? (
        <ChatInterview
          messages={live.messages}
          streaming={live.venusText}
          thinking={live.state === 'thinking' || live.state === 'connecting'}
          aiName={AI_NAME}
          onSend={(t) => live.sendText(t)}
          onVoice={() => setKeyboardMode(false)}
          onExit={resetToGuide}
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
  fill: { flex: 1 },
  content: { flex: 1, paddingHorizontal: Spacing.four },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  eyebrow: { letterSpacing: 3 },
  headerSpacer: { flex: 1 },
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },

  guideWrap: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: Spacing.six },
  guideTitle: { fontSize: 28, textAlign: 'center' },
  guideBody: { textAlign: 'center', maxWidth: 320, lineHeight: 22, marginTop: Spacing.two },
  ctaPrimary: { borderRadius: 14, paddingVertical: Spacing.three, paddingHorizontal: Spacing.six, alignItems: 'center', marginTop: Spacing.four },
  greeting: { textAlign: 'center', fontSize: 17, lineHeight: 25, maxWidth: 420, marginBottom: Spacing.four },
  chips: { alignSelf: 'stretch', maxWidth: 460, width: '100%', gap: 8, marginHorizontal: 'auto' },
  chip: {
    borderWidth: 1,
    backgroundColor: 'rgba(12,18,26,0.72)',
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  chipLabel: { fontSize: 14, fontFamily: 'Jost-Medium' },
  chipDetail: { fontSize: 12, marginTop: 1 },
  guideFoot: { fontSize: 11, letterSpacing: 0.6, marginTop: Spacing.four, textAlign: 'center' },

  entityArea: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: Spacing.four },
  hint: { letterSpacing: 1 },
  pausePill: { marginTop: Spacing.three, borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, alignSelf: 'center' },
  finalizePill: { marginTop: Spacing.two, borderRadius: 999, paddingHorizontal: Spacing.five, paddingVertical: Spacing.three, alignSelf: 'center', minWidth: 180, alignItems: 'center' },
  captions: { gap: Spacing.two, paddingBottom: Spacing.four, marginBottom: Spacing.two, minHeight: 96 },
  heard: { textAlign: 'center' },
  line: { textAlign: 'center', fontSize: 16, lineHeight: 23, fontFamily: 'Jost-Regular' },

  busyBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.65)', padding: Spacing.four },
  busyCard: { width: '100%', maxWidth: 360, borderRadius: 18, borderWidth: 1, paddingVertical: Spacing.five, paddingHorizontal: Spacing.four, alignItems: 'center' },
  busyEyebrow: { fontSize: 11, letterSpacing: 1.5, marginBottom: Spacing.two },
  busyTitle: { fontSize: 22, lineHeight: 26, marginBottom: Spacing.two, textAlign: 'center' },
  busyBody: { textAlign: 'center', lineHeight: 20, marginBottom: Spacing.four },
  busyPrimary: { alignSelf: 'stretch', borderRadius: 14, paddingVertical: Spacing.three, alignItems: 'center' },
  busySecondary: { paddingVertical: Spacing.three, marginTop: Spacing.one },

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
});
