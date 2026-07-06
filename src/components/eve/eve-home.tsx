import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, type Href } from 'expo-router';
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
import { EveOrbRing } from '@/components/eve/eve-orbs';
import { eveChildren, eveRootNodes, type EveNode } from '@/lib/eve-capabilities';
import { buildDigest, type Digest, type DigestStore } from '@/lib/eve-digest';
import { emitEveEvent, type EveSummon } from '@/lib/eve-bus';
import { eveCentralInstruction, EVE_CENTRAL_GREETING } from '@/lib/live-voice';
import { venusGuide, type VenusGuidance } from '@/lib/venus-guide';
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

type StoreLite = { name: string; slug: string; status: string; deploymentUrl?: string | null; customDomain?: string | null };

/** The REAL storefront URL — same rule as /api/store/[slug]: prefer the custom domain, else a
 *  non-placeholder deploymentUrl. Never fabricated from the slug (a brand can have no site). */
function siteUrlFor(s: StoreLite): string | null {
  if (s.customDomain) return `https://${s.customDomain}`;
  if (s.deploymentUrl && !s.deploymentUrl.includes('github.com')) return s.deploymentUrl;
  return null;
}

export function EveHome({
  open,
  ready,
  onRequestClose,
  onGo,
}: {
  /** The overlay is on screen (gates the live session — she is never vocal while hidden). */
  open: boolean;
  /** Slide-in finished — safe to mount the GL avatar. */
  ready: boolean;
  onRequestClose: () => void;
  /** Transition Eve's surface in place (home → developing/design) — the overlay's open(). */
  onGo: (s: EveSummon) => void;
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
  const [stores, setStores] = useState<StoreLite[]>([]);
  const [meResolved, setMeResolved] = useState(false); // instruction is chosen from this — never start before it
  const [micOk, setMicOk] = useState<boolean | null>(null); // guide-view auto-voice needs an answered mic prompt

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
          creator?: { name?: string | null };
          stores?: StoreLite[];
        };
        if (!alive) return;
        const firstName = (d.creator?.name ?? (session.user?.user_metadata?.name as string | undefined))
          ?.trim()
          .split(/\s+/)[0];
        setStores(d.stores ?? []);
        setHasStore((d.stores?.length ?? 0) > 0);
        setGuidance(venusGuide({ firstName, stores: d.stores ?? [] }));
      } catch {
        if (alive) setGuidance(venusGuide({ stores: [] }));
      } finally {
        if (alive) setMeResolved(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, session]);

  // Returning creators get VOICE in the guide too (that's how intent routing hears them) — ask for
  // the mic once, on summon. Denied → the guide still works by chips; the interview falls back to
  // typing via its own path.
  useEffect(() => {
    if (!open || !meResolved || !hasStore || micOk !== null) return;
    (async () => {
      const perm = await AudioModule.requestRecordingPermissionsAsync().catch(() => null);
      setMicOk(!!perm?.granted);
    })();
  }, [open, meResolved, hasStore, micOk]);

  // ---- Gemini Live wiring (the realtime speech-to-speech session; GEMINI_LIVE.md) ----
  const creatorName =
    (session?.user?.user_metadata?.name as string | undefined) ??
    (session?.user?.user_metadata?.full_name as string | undefined) ??
    undefined;
  // Persona: first-brand creators get the pure interview (liveSystemInstruction default); returning
  // creators get the CENTRAL persona — greeting + task awareness + the interview module verbatim
  // (the "ready to build your brand" cue survives, so buildReady below keeps working). The hook
  // reads opts at start() time and we never start before meResolved, so the choice is always final.
  const centralInstruction = useMemo(
    () => (hasStore ? eveCentralInstruction(creatorName, stores.map((s) => s.name)) : undefined),
    [hasStore, creatorName, stores],
  );
  const live = useLiveVoice({
    accessToken: session?.access_token,
    userName: creatorName,
    firstTime: !hasStore,
    voiceName: LIVE_VOICE,
    instruction: centralInstruction,
    greeting: hasStore ? EVE_CENTRAL_GREETING : undefined,
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
  // ensures the button always eventually appears. ONLY the interview may unlock it — for a returning
  // creator the guide voice shares the session, so without this gate 6 turns of guide small talk
  // would light up "✓ Build my brand" before any interview happened (and finalize over chatter).
  const [buildReady, setBuildReady] = useState(false);
  useEffect(() => {
    if (view !== 'interview' || !live.messages.length) { setBuildReady(false); return; }
    if (buildReady) return;
    const userTurns = live.messages.filter((m) => m.role === 'user').length;
    const lastEve = [...live.messages].reverse().find((m) => m.role === 'assistant')?.text ?? '';
    const cue = /\b(ready to build|ready to (create|launch|go)|build your (brand|store|site|shop)|(everything|all)\s+(i|we)\s+need|got everything|let'?s build|time to build|shall we build)\b/i;
    if (userTurns >= 6 || (userTurns >= 3 && cue.test(lastEve))) setBuildReady(true);
  }, [view, live.messages, buildReady]);

  // The digest — Eve's proactive status report. Fetched lazily the first time it's opened.
  const [digest, setDigest] = useState<Digest | 'loading' | null>(null);
  const [showDigest, setShowDigest] = useState(false);
  const openDigest = useCallback(async () => {
    setShowDigest(true);
    setDigest((cur) => (cur && cur !== 'loading' ? cur : 'loading'));
    if (digest && digest !== 'loading') return; // already have it
    if (!session?.access_token) { setDigest(buildDigest([])); return; }
    try {
      const r = await fetch(apiUrl('/api/creator/stats'), { headers: { Authorization: `Bearer ${session.access_token}` } });
      const d = (await r.json().catch(() => ({}))) as { stores?: DigestStore[] };
      setDigest(buildDigest(d.stores ?? []));
    } catch {
      setDigest(buildDigest([]));
    }
  }, [digest, session]);

  // ---- VOICE-INTENT ROUTING (VENUS_CENTRAL.md §3): distill-then-execute, per committed turn ----
  // Native-audio Live can't tool-call, so each new user utterance goes to /api/eve/route (~300ms
  // flash, non-blocking, fail-open to 'none'). Returning creators only — a first-brand creator is
  // the interview funnel. The endpoint is precision-biased; interviewActive makes it stricter still.
  const viewRef = useRef(view);
  viewRef.current = view;
  // Cleared when EveHome unmounts (the home→developing transition swaps components) so a routing
  // response that resolves late — the flash call retries 2×2 with backoff, seconds — can't fire
  // onGo/onRequestClose/router.push after we've already left the guide and torn the session down.
  const routingAlive = useRef(true);
  useEffect(() => () => { routingAlive.current = false; }, []);
  const enterInterview = useCallback(() => {
    // A returning creator's guide session must NOT bleed into the interview: stop it so the gate
    // effect starts a FRESH interview session (start() clears live.messages), and drop any latched
    // build state so the "✓ Build my brand" pill can't appear over an empty transcript.
    live.stop();
    setBuildReady(false);
    setKeyboardMode(false);
    setView('interview');
  }, [live.stop]);
  const routeTurn = useCallback(
    async (turn: string) => {
      if (!session) return;
      try {
        const r = await fetch(apiUrl('/api/eve/route'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            turn,
            recent: live.messages.slice(-6).map((m) => ({ role: m.role, text: m.text })),
            stores: stores.map((s) => ({ name: s.name, slug: s.slug, hasSite: !!siteUrlFor(s) })),
            interviewActive: viewRef.current === 'interview',
          }),
        });
        const d = (await r.json().catch(() => ({}))) as {
          intent?: string;
          storeSlug?: string;
          idea?: string;
          ask?: string;
        };
        if (!routingAlive.current) return; // left the guide while this classified — don't act
        switch (d.intent) {
          case 'edit-site': {
            const withSites = stores.filter((s) => siteUrlFor(s));
            const target = d.storeSlug
              ? stores.find((s) => s.slug === d.storeSlug)
              : withSites.length === 1
                ? withSites[0]
                : undefined;
            const url = target ? siteUrlFor(target) : null;
            if (target && url) {
              onGo({ state: 'developing', payload: { slug: target.slug, url, name: target.name } });
            } else if (target && !url) {
              // They NAMED a real brand, but it has no live site yet — say so about that brand,
              // not a nonsensical "did you mean <the other one>?".
              live.sendContext(
                `(They asked to edit "${target.name}", but that brand has no live site yet — tell them gently, and suggest launching its site from the Studio first.)`,
              );
            } else if (!withSites.length) {
              live.sendContext(
                '(They asked to edit their website, but none of their brands has a live site yet — tell them gently, and suggest launching the site from the Studio first.)',
              );
            } else {
              live.sendContext(
                `(They asked to edit a site but it's unclear which brand — ask whether they mean ${withSites.map((s) => `"${s.name}"`).join(' or ')}.${d.ask ? ` Their app suggests asking: ${d.ask}` : ''})`,
              );
            }
            return;
          }
          case 'create-brand':
            if (viewRef.current === 'guide') enterInterview();
            return;
          case 'new-design':
            if (/\bmeme\b/i.test(turn)) {
              onRequestClose();
              sendDesignCommand({ kind: 'open-generate', prompt: d.idea, meme: true });
              router.push('/design');
            } else {
              // Into Eve's design state with the spoken idea — she generates it in her own surface.
              onGo({ state: 'design', payload: { idea: d.idea } });
            }
            return;
          case 'write-post':
            live.sendContext(
              '(Writing posts by voice lands soon — in one sentence, tell them they can write posts from the Studio composer for now.)',
            );
            return;
          case 'digest':
            void openDigest();
            live.sendContext(
              "(Their digest is now on screen. In one short sentence, give them the headline — how they're doing — and offer a next step.)",
            );
            return;
          case 'done':
            onRequestClose();
            return;
        }
      } catch {
        // routing is best-effort — a missed command costs a repeat, never an error
      }
    },
    [session, stores, live.messages, live.sendContext, onGo, onRequestClose, enterInterview, openDigest],
  );
  const routedUsers = useRef(0);
  useEffect(() => {
    const said = live.messages.filter((m) => m.role === 'user');
    if (said.length < routedUsers.current) routedUsers.current = said.length; // session reset cleared messages
    // Gated (first-brand interview, or mid brand-review): mark the transcript CONSUMED without routing,
    // so when hasStore flips true after a first launch we don't burst-route the whole interview (a
    // closing "that's everything" would classify 'done' and close the overlay).
    if (!hasStore || brand) { routedUsers.current = said.length; return; }
    for (let i = routedUsers.current; i < said.length; i++) {
      const t = said[i].text.trim();
      if (t) void routeTurn(t);
    }
    routedUsers.current = said.length;
  }, [live.messages, hasStore, brand, routeTurn]);

  // The ONE rule for when Eve is live: her overlay is on screen, app foregrounded, persona resolved,
  // not paused / already done — in the interview always, and in the GUIDE for returning creators
  // once the mic prompt is answered (that's the voice the intent router listens to). Anything else
  // → stop, so she's never vocal outside her view.
  // (Pause is a VOICE concept — in keyboard mode it must not gate the session or typed turns hang.)
  useEffect(() => {
    const voiceView = view === 'interview' || (view === 'guide' && hasStore && micOk === true);
    // Only the returning-creator GUIDE persona (eveCentralInstruction) is built from /api/me, so only
    // it waits on meResolved. The first-brand interview uses the default persona and must never hang
    // on a stalled /api/me (which has no timeout) — otherwise typed turns vanish into a dead session.
    const personaReady = view === 'interview' ? true : meResolved;
    const inHerView = voiceView && !brand && open && appActive && personaReady;
    if (inHerView && (keyboardMode || !paused)) live.start();
    else live.stop();
  }, [view, hasStore, micOk, meResolved, brand, paused, keyboardMode, open, appActive, live.start, live.stop]);
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
  // talk, before the Live session opens its recorder. On denial, fall back to typing. Stop any guide
  // session first (enterInterview) so the interview starts fresh — no carried-over transcript.
  const startVoice = useCallback(async () => {
    live.stop();
    setBuildReady(false);
    setKeyboardMode(false);
    setPaused(false);
    pausedRef.current = false;
    const perm = await AudioModule.requestRecordingPermissionsAsync().catch(() => null);
    if (!perm?.granted) {
      setKeyboardMode(true);
      setError('No microphone access — you can type your answers, or enable the mic in Settings.');
    }
    setView('interview');
  }, [live.stop]);

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

  // Which branch the orb ring is currently inside — null = the root ring. Resets to root each time
  // Eve is (re)summoned (EveHome remounts).
  const [orbBranch, setOrbBranch] = useState<EveNode | null>(null);

  // Fire a LEAF capability node — the ONE dispatcher an orb tap (and, at the handler level, voice)
  // both land in. The registry hands back a pure action descriptor; this turns it into the app calls
  // (interview / developing / design bus / router).
  const runNode = useCallback(
    (node: EveNode) => {
      if (!node.action) return; // a branch — traversed by onOrbSelect, never dispatched here
      const action = node.action({ hasStore, stores });
      switch (action.type) {
        case 'build-brand':
          void startVoice();
          return;
        case 'edit-site': {
          // Open developing on a brand with a LIVE site; otherwise the Studio, where its site is
          // finalized/launched. (Prefer an unfinished brand — that's the one to get live.)
          const unfinished = stores.find((s) => s.status !== 'live' && s.status !== 'suspended');
          const target = unfinished ?? stores.find((s) => siteUrlFor(s));
          const url = target ? siteUrlFor(target) : null;
          if (target && url) {
            onGo({ state: 'developing', payload: { slug: target.slug, url, name: target.name } });
          } else {
            onRequestClose();
            router.push('/studio');
          }
          return;
        }
        case 'new-design':
          if (action.meme) {
            // Memes keep the Design-tab generator — its caption-building lives there.
            onRequestClose();
            sendDesignCommand({ kind: 'open-generate', meme: true });
            router.push('/design');
          } else {
            // Plain designs open Eve's hands-free create surface; she asks for the idea.
            onGo({ state: 'design' });
          }
          return;
        case 'digest':
          void openDigest();
          return;
        case 'write-post':
        case 'manage-brand':
          onRequestClose();
          router.push('/studio');
          return;
        case 'nav':
          onRequestClose();
          router.push(action.route as Href);
          return;
      }
    },
    [hasStore, stores, startVoice, onRequestClose, onGo, openDigest],
  );

  // An orb was tapped: a branch blooms its children; a leaf fires (and drops us back to the root).
  const onOrbSelect = useCallback(
    (node: EveNode) => {
      if (node.kind === 'branch') {
        setOrbBranch(node);
        return;
      }
      setOrbBranch(null);
      runNode(node);
    },
    [runNode],
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
  // The energy orbs to bloom right now: a branch's children if we're inside one, else the root ring.
  const orbNodes = useMemo(
    () => (orbBranch ? eveChildren(orbBranch, { hasStore, stores }) : eveRootNodes({ hasStore, stores })),
    [orbBranch, hasStore, stores],
  );

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
          // LAB LOOK — the orb owns the middle. Subtitles ride ABOVE her; her energy condenses into
          // tappable nodes along the LOWER screen. No pause button — swipe up on the overlay pauses.
          // Voice still routes ("edit my site", "make a meme") through the same registry nodes.
          <View style={styles.guideView}>
            <View style={styles.subsTop}>
              {heard ? (
                <ThemedText type="code" style={[styles.heard, { color: p.dim }]} numberOfLines={2}>
                  {'you > ' + heard}
                </ThemedText>
              ) : null}
              {/* Her spoken line once she talks; until then, her opening as a subtitle. */}
              <ThemedText style={[styles.line, { color: p.ink }]} numberOfLines={3}>
                {line || guidance?.greeting || '…'}
              </ThemedText>
            </View>
            <View style={styles.orbDock}>
              {/* key re-blooms the whole ring on every branch change (root ⇄ children) */}
              <EveOrbRing
                key={orbBranch?.id ?? 'root'}
                nodes={orbNodes}
                onSelect={onOrbSelect}
                onBack={orbBranch ? () => setOrbBranch(null) : undefined}
              />
            </View>
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

      {/* THE DIGEST — Eve's proactive status report, over the home state. */}
      {showDigest ? (
        <Pressable style={styles.digestBackdrop} onPress={() => setShowDigest(false)}>
          <Pressable style={[styles.digestCard, { backgroundColor: p.bgTop, borderColor: p.line }]} onPress={() => {}}>
            <ThemedText type="code" style={[styles.digestEyebrow, { color: p.accent }]}>YOUR DIGEST</ThemedText>
            {digest && digest !== 'loading' ? (
              <>
                <ThemedText style={[styles.digestHeadline, { color: p.ink }]}>{digest.headline}</ThemedText>
                <View style={styles.digestTiles}>
                  {digest.tiles.map((t) => (
                    <View key={t.label} style={styles.digestTile}>
                      <ThemedText style={[styles.digestValue, { color: p.ink }]}>{t.value}</ThemedText>
                      <ThemedText type="code" style={[styles.digestTileLabel, { color: p.dim }]}>{t.label}</ThemedText>
                    </View>
                  ))}
                </View>
                <ThemedText type="small" style={[styles.digestSuggestion, { color: p.dim }]}>{digest.suggestion}</ThemedText>
              </>
            ) : (
              <ActivityIndicator color={p.accent} style={{ marginVertical: Spacing.six }} />
            )}
            <Pressable onPress={() => setShowDigest(false)} hitSlop={8} style={[styles.digestClose, { borderColor: `${p.dim}66` }]}>
              <ThemedText type="code" style={{ color: p.dim }}>Close</ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
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

  // The guide: subtitles pinned at the TOP, the energy-orb dock at the BOTTOM, orb full-bleed between.
  guideView: { flex: 1, justifyContent: 'space-between' },
  subsTop: { alignItems: 'center', gap: Spacing.two, minHeight: 72 },
  orbDock: { alignItems: 'center', paddingBottom: Spacing.two },

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

  digestBackdrop: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)', padding: Spacing.four },
  digestCard: { width: '100%', maxWidth: 380, borderRadius: 20, borderWidth: 1, padding: Spacing.five, alignItems: 'center' },
  digestEyebrow: { fontSize: 11, letterSpacing: 2, marginBottom: Spacing.three },
  digestHeadline: { fontSize: 19, lineHeight: 26, textAlign: 'center', fontFamily: 'Jost-Medium', marginBottom: Spacing.four },
  digestTiles: { flexDirection: 'row', gap: Spacing.two, alignSelf: 'stretch', marginBottom: Spacing.four },
  digestTile: { flex: 1, alignItems: 'center', paddingVertical: Spacing.three, borderRadius: 12, backgroundColor: 'rgba(124,199,223,0.08)' },
  digestValue: { fontSize: 20, fontFamily: 'Jost-Medium' },
  digestTileLabel: { fontSize: 10, letterSpacing: 0.5, marginTop: 2 },
  digestSuggestion: { textAlign: 'center', lineHeight: 21, marginBottom: Spacing.four },
  digestClose: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.five, paddingVertical: Spacing.two },
});
