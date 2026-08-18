import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { AudioModule } from 'expo-audio';

import { BrandReview } from '@/components/brand-review';
import { ChatInterview } from '@/components/chat-interview';
import { setEveStage } from '@/lib/eve-stage-bus';
import { InterviewTopics } from '@/components/interview-topics';
import { Paywall } from '@/components/paywall';
import { ThemedText } from '@/components/themed-text';
import { usePalette } from '@/components/nc-screen';
import { glow } from '@/constants/glow';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useLiveVoice } from '@/hooks/use-live-voice';
import { apiUrl, readJson } from '@/lib/api';
import { buildDigest, digestBriefing, type Digest, type DigestStore } from '@/lib/eve-digest';
import { imageForEve, registerEveVisionListener } from '@/lib/eve-vision-bus';
import { registerEveSayListener } from '@/lib/eve-say-bus';
import { consumeNextTurn } from '@/lib/eve-edit-bus';
import { publishEvePulse, registerEveMuteListener } from '@/lib/eve-live-state-bus';
import { publishTranscript } from '@/lib/eve-transcript-bus';
import { emitEveEvent, type EveSummon } from '@/lib/eve-bus';
import { EveWheel, spokeAt, type WheelId } from './eve-wheel';
import { announce, eveCentralInstruction, EVE_CENTRAL_GREETING, LIVE_VOICE } from '@/lib/live-voice';
import type { BrandResult, ChatMessage } from '@/lib/interview';

// EVE'S HOME STATE — her voice surface, hosted by the Eve tab (/studio) since the overlay
// retirement. This is the brand INTERVIEW: live Gemini voice, subtitles, the buildReady gate, the
// BrandReview → createStore finish, and the launch fanfare — plus her GUIDE view (greeting +
// digest) for creators who already have a store.
//
// Two views:  guide  — greeting + tools (build brand · edit site · designs · memes · posts)
//             interview — the voice interview → BrandReview when she's extracted the brand
//
// She has NO avatar of her own: the persistent root Eve (eve-background) is already behind this
// surface, and EveHome DRIVES it through the stage bus — one GL context, ever.

// Her voice is LIVE_VOICE from lib/live-voice — the single source every session defaults to.

type EntityState = 'idle' | 'listening' | 'thinking' | 'speaking';

const BG = '#08080a'; // dark ink for text ON the gold accent buttons
const AI_NAME = 'Eve';

// How far Eve is dimmed behind each kind of surface. She is the app's background, so the only
// question is how much reading the thing in front of her demands.
const REST_SCRIM = 'rgba(6,8,12,0.30)'; // captions over her — she still reads as the page
const READ_SCRIM = 'rgba(6,8,12,0.82)'; // forms + long copy (brand review) — her net must not compete

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
  covered = false,
  hidden = false,
  onRequestClose,
  onGo,
  onShowBrands,
}: {
  /** The surface is on screen (gates the live session — she is never vocal while hidden). */
  open: boolean;
  /** She's in another of her states (design/developing) — render nothing, don't just go quiet. */
  hidden?: boolean;
  /** Something is layered OVER her — the brand console, the paywall, the deck, the welcome panel.
   *  She suspends rather than stops, so a glance costs nothing and the conversation survives. */
  covered?: boolean;
  onRequestClose: () => void;
  /** Transition Eve's surface in place (home → developing/design) — the host's state machine. */
  onGo: (s: EveSummon) => void;
  /** Summon the Your-Brands deck (pick a brand → its Console: Edit site · Posts · Sell · Settings) —
   *  the wheel's SITE spoke. */
  onShowBrands: () => void;
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
  const [paywall, setPaywall] = useState<'subscription_required' | 'brand_limit' | null>(null);
  const [keyboardMode, setKeyboardMode] = useState(false);

  // THE WHEEL. Press-and-hold anywhere on her opens a radial menu at the thumb; drag to a sector;
  // release to choose. Releasing in the centre cancels. Quick tap keeps its old meaning entirely —
  // the two gestures are raced so they can never both fire.
  const [wheel, setWheel] = useState<{ x: number; y: number } | null>(null);
  const [wheelPick, setWheelPick] = useState<WheelId | null>(null);
  /** One release per hold. The web fallback below and the gesture's own onEnd both land here, and a
   *  spoke that fired twice would navigate twice. */
  const wheelSpent = useRef(false);
  /** The press-and-hold surface, so web can stop the OS stealing the hold. See below. */
  const wheelSurface = useRef<View | null>(null);
  const [paused, setPaused] = useState(false);
  const [appActive, setAppActive] = useState(true);
  // THE STATE MODEL: she is silent or talking, and only the creator moves her between them.
  // Landing on the tab must never open a socket — that used to bill a Gemini Live connection plus a
  // spoken greeting for anyone who tapped through to look at their brands.
  const [talking, setTalking] = useState(false);
  const wantGreetRef = useRef(false); // true only for the tap that STARTS a conversation
  const [hasStore, setHasStore] = useState(false);
  const [stores, setStores] = useState<StoreLite[]>([]);
  const [meResolved, setMeResolved] = useState(false);
  // Separate from meResolved on purpose. meResolved means "we stopped waiting" (it gates which
  // persona starts, and must flip even on failure). storesKnown means "we actually got an answer" —
  // the only honest basis for dimming a brand-scoped spoke. A 500 must never read as "no brands".
  const [storesKnown, setStoresKnown] = useState(false); // instruction is chosen from this — never start before it
  const [micOk, setMicOk] = useState<boolean | null>(null); // guide-view auto-voice needs an answered mic prompt

  const messages = useRef<ChatMessage[]>([]);
  const pausedRef = useRef(false);

  // Her read of the creator's world — refetched each time the overlay opens (cheap /api/me).
  useEffect(() => {
    if (!open || !session?.access_token) return;
    let alive = true;
    (async () => {
      // One retry: Cloud Run cold starts are the common failure here, and a single blip used to
      // leave the creator's brands invisible for the whole session.
      for (let attempt = 0; attempt < 2; attempt++) {
        // Timed out rather than open-ended: a hung /api/me would otherwise leave her surface
        // degraded forever. Manual AbortController — AbortSignal.timeout does NOT exist in Hermes,
        // and using it here threw on EVERY call, so she treated every creator as a first-timer
        // with routing dead (found 2026-08-17; the sim's me-debug trace).
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        try {
          const r = await fetch(apiUrl('/api/me'), {
            headers: { Authorization: `Bearer ${session.access_token}` },
            signal: ctrl.signal,
          });
          if (!r.ok) throw new Error(String(r.status)); // a 500 is NOT "you have no brands"
          const d = (await r.json()) as {
            creator?: { name?: string | null };
            stores?: StoreLite[];
          };
          if (!alive) return;
          setStores(d.stores ?? []);
          setHasStore((d.stores?.length ?? 0) > 0);
          setStoresKnown(true);
          break;
        } catch {
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 900));
            continue;
          }
          // Still failing: storesKnown stays false, so brand-scoped spokes stay LIT rather than
          // claiming the creator has nothing. Trying one and finding nothing beats being told a
          // lie about your own account.
        } finally {
          clearTimeout(timer);
        }
      }
      if (alive) setMeResolved(true);
    })();
    return () => {
      alive = false;
    };
  }, [open, session]);

  // The mic is requested WHEN THE CREATOR ASKS HER TO TALK — never on arrival. Landing on her tab
  // used to fire the OS permission prompt for someone who only wanted to see their brands.
  const ensureMic = useCallback(async (): Promise<boolean> => {
    if (micOk !== null) return micOk;
    const perm = await AudioModule.requestRecordingPermissionsAsync().catch(() => null);
    const granted = !!perm?.granted;
    setMicOk(granted);
    return granted;
  }, [micOk]);

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
      // The interview is over and finalize() has already closed the socket — drop the intent too,
      // or the pill claims she's listening while the creator reads a form in silence.
      setTalking(false);
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
  // EVE'S EYES. The design overlay renders ABOVE this component but the live session lives HERE, so
  // it publishes what it just put on screen and we do the looking. Fire-and-forget on purpose: a
  // failed fetch or a closing socket must never interrupt the conversation.
  useEffect(
    () =>
      registerEveVisionListener((sight) => {
        void (async () => {
          const img = await imageForEve(sight.url);
          if (img) live.sendImage(img.base64, img.mimeType, sight.note);
        })();
      }),
    [live.sendImage],
  );
  // EVE'S CUE CARD — same overlay split as her eyes: the design surface asks, the session (here)
  // speaks. prompt() sends a completed turn, so she voices it (sendContext never would).
  useEffect(() => registerEveSayListener((instruction) => live.prompt(instruction)), [live.prompt]);

  // Her pulse (state + caption), for badges/subtitles riding inside popups layered over her.
  // Tap-to-mute from any EveEar badge (the popups' listening pill toggles her).
  const [earMuted, setEarMuted] = useState(false);
  useEffect(() => registerEveMuteListener(() => setEarMuted((m) => !m)), []);
  useEffect(() => {
    publishEvePulse({ state: talking ? live.state : 'off', caption: live.venusText, muted: earMuted });
  }, [talking, live.state, live.venusText, earMuted]);
  const loggedTurns = useRef(0);
  const convoSession = useRef<{ id: string; startedAt: string } | null>(null);
  useEffect(() => {
    if (talking && !convoSession.current) {
      convoSession.current = { id: Math.random().toString(36).slice(2, 10), startedAt: new Date().toISOString() };
    }
    if (!talking) convoSession.current = null;
  }, [talking]);
  useEffect(() => {
    publishTranscript(live.messages.map((m) => ({ role: m.role, text: m.text })));
    // DEV: persist the whole conversation as JSON (local-logs/conversation_NNNN.json) so the dev
    // agent can read it verbatim and tune her responses (Joe, 2026-08-17).
    if (__DEV__ && convoSession.current && live.messages.length) {
      void fetch(apiUrl('/api/dev/log-conversation'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: convoSession.current.id,
          startedAt: convoSession.current.startedAt,
          messages: live.messages.map((m) => ({ role: m.role, text: m.text })),
        }),
      }).catch(() => {});
    }
    // DEV: stream committed turns to Metro so the dev agent can read the conversation verbatim
    // (Joe, 2026-08-17 — transcripts lived only in memory; debugging her behaviour needs them).
    if (__DEV__) {
      for (let i = loggedTurns.current; i < live.messages.length; i++) {
        const m = live.messages[i];
        console.log(`[transcript] ${m.role === 'user' ? 'JOE' : 'EVE'}: ${m.text}`);
      }
      loggedTurns.current = live.messages.length;
    }
  }, [live.messages]);
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
  // The raw rows behind the digest, kept so Eve can be BRIEFED with the real figures (and re-briefed
  // on a repeat ask without refetching). Rendering alone left her guessing at follow-ups.
  const digestStores = useRef<DigestStore[] | null>(null);
  /** Opens the digest and RESOLVES with the rows, so the caller can hand Eve the actual numbers. */
  const openDigest = useCallback(async (): Promise<DigestStore[]> => {
    setShowDigest(true);
    setDigest((cur) => (cur && cur !== 'loading' ? cur : 'loading'));
    if (digest && digest !== 'loading' && digestStores.current) return digestStores.current; // already have it
    if (!session?.access_token) { setDigest(buildDigest([])); digestStores.current = []; return []; }
    try {
      const r = await fetch(apiUrl('/api/creator/stats'), { headers: { Authorization: `Bearer ${session.access_token}` } });
      const d = (await r.json().catch(() => ({}))) as { stores?: DigestStore[] };
      const rows = d.stores ?? [];
      setDigest(buildDigest(rows));
      digestStores.current = rows;
      return rows;
    } catch {
      setDigest(buildDigest([]));
      digestStores.current = [];
      return [];
    }
  }, [digest, session]);

  /** Eve just asked what they'd like designed — the next user turn is (probably) the idea. */
  const awaitDesignIdea = useRef(false);
  /** One-shot greeting override for the NEXT session open (a spoke that wants her first line to be
   *  its own ask — e.g. DESIGN — instead of the general hello). Consumed by the gate effect. */
  const pendingGreeting = useRef<string | undefined>(undefined);

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
    wantGreetRef.current = true; // a fresh interview: she opens it
    setTalking(true);
    setView('interview');
  }, [live.stop]);
  const routeTurn = useCallback(
    async (turn: string) => {
      if (!session) return;
      // One-shot: Eve just asked what to design (the DESIGN spoke, or a no-idea new-design), so
      // the NEXT turn's bare answer ("a chrome skull") must classify as the idea instead of being
      // dropped by the router's precision bias. Consumed here whatever the router decides.
      const awaiting = awaitDesignIdea.current;
      awaitDesignIdea.current = false;
      try {
        const r = await fetch(apiUrl('/api/eve/route'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            turn,
            recent: live.messages.slice(-6).map((m) => ({ role: m.role, text: m.text })),
            stores: stores.map((s) => ({ name: s.name, slug: s.slug, hasSite: !!siteUrlFor(s) })),
            interviewActive: viewRef.current === 'interview',
            awaitingDesignIdea: awaiting,
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
            if (d.idea) {
              // Into Eve's design state with the spoken idea — she generates it in her own surface.
              onGo({ state: 'design', payload: { idea: d.idea } });
            } else {
              // A design ask with no subject ("make me a t-shirt") — opening EveDesign empty lands
              // in a typed form. She asks for the artwork instead (prompt, so it's actually voiced);
              // the answer re-routes with the idea via awaitDesignIdea.
              awaitDesignIdea.current = true;
              live.prompt(
                "(They want a design but haven't said what the artwork is — in one short sentence, ask what should go on it.)",
              );
            }
            return;
          case 'write-post':
            live.sendContext(
              '(Writing posts by voice lands soon — in one sentence, tell them they can write posts from the Studio composer for now.)',
            );
            return;
          case 'digest': {
            // Brief her with the ACTUAL figures, not "say the headline" — otherwise every follow-up
            // ("how's Urban doing?") is a guess. digestBriefing also states the data's limits so she
            // declines what she can't know instead of estimating revenue.
            const rows = await openDigest();
            live.sendContext(digestBriefing(rows));
            return;
          }
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
      // An armed surface (EveDesign's "Tell Eve" edit) captures the next turn whole — the
      // utterance IS the instruction, not an intent to classify.
      if (t && !consumeNextTurn(t)) void routeTurn(t);
    }
    routedUsers.current = said.length;
  }, [live.messages, hasStore, brand, routeTurn]);

  // THE ONE RULE for when Eve is live. Two things had to change here (D-19 / D-20 / D-22):
  //   · `talking` is a precondition. A surface appearing never opens a socket — only a creator does.
  //   · Being covered or backgrounded SUSPENDS instead of stopping, so glancing at the brand console
  //     no longer costs a fresh connection, a fresh greeting, and the whole transcript.
  // (Pause is a VOICE concept — in keyboard mode it must not gate the session or typed turns hang.)
  useEffect(() => {
    // Only the returning-creator GUIDE persona (eveCentralInstruction) is built from /api/me, so only
    // it waits on meResolved. The first-brand interview uses the default persona and must never wait
    // on a stalled /api/me (8s worst case) — otherwise typed turns vanish into a dead session.
    const personaReady = view === 'interview' ? true : meResolved;
    const wants = talking && !brand && personaReady && (keyboardMode || !paused);
    const reachable = open && appActive && !covered;

    if (!wants) { live.stop(); return; }          // she's done: release it now
    if (!reachable) { live.suspend(); return; }   // she's covered: hold it, quietly

    // Resuming a held socket costs nothing and keeps the thread; only open a new one if the grace
    // period already released it, and then WITHOUT a greeting — she's mid-conversation.
    if (!live.resume()) live.start(wantGreetRef.current, pendingGreeting.current);
    wantGreetRef.current = false;
    pendingGreeting.current = undefined;
  }, [talking, covered, view, meResolved, brand, paused, keyboardMode, open, appActive,
      live.start, live.stop, live.suspend, live.resume]);
  // Keyboard/chat mode mutes the mic so Eve doesn't react to the room while you type.
  useEffect(() => { live.mute(keyboardMode || earMuted); }, [keyboardMode, earMuted, live.state, live.mute]);
  useEffect(() => {
    setAppActive(AppState.currentState === 'active');
    const sub = AppState.addEventListener('change', (st) => setAppActive(st === 'active'));
    return () => sub.remove();
  }, []);

  // Entering the interview requests the mic HERE — the OS dialog appears when the user chooses to
  // talk, before the Live session opens its recorder. On denial, fall back to typing. Stop any guide
  // session first (enterInterview) so the interview starts fresh — no carried-over transcript.
  const startVoice = useCallback(async () => {
    live.stop();
    setBuildReady(false);
    setKeyboardMode(false);
    setPaused(false);
    pausedRef.current = false;
    if (!(await ensureMic())) {
      setKeyboardMode(true);
      setError('No microphone access — you can type your answers, or enable the mic in Settings.');
    }
    wantGreetRef.current = true;
    setTalking(true);
    setView('interview');
  }, [live.stop, ensureMic]);

  /** TAP TO TALK — the whole state model, and the only thing that opens a paid session.
   *  Silent → asks for the mic if we've never asked, then starts her (with a greeting).
   *  Talking → stops her. The socket is held briefly by the gate's suspend path on the way out. */
  const toggleTalk = useCallback(async () => {
    if (talking) {
      setTalking(false);
      setPaused(false);
      pausedRef.current = false;
      return;
    }
    const granted = await ensureMic();
    if (!granted) {
      // No mic is not a dead end — it's the reason the typed path exists.
      setKeyboardMode(true);
      setError('No microphone access — you can type to Eve, or enable the mic in Settings.');
    }
    wantGreetRef.current = true;
    setPaused(false);
    pausedRef.current = false;
    setTalking(true);
  }, [talking, ensureMic]);

  const togglePause = useCallback(() => {
    setPaused((prev) => {
      const next = !prev;
      pausedRef.current = next;
      setState('idle');
      return next;
    });
  }, []);

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
    // She never spoke — this IS the opening of the conversation, so let her greet.
    wantGreetRef.current = true;
    setTalking(true);
    live.start(true);
  }, [live.dismissAudioBusy, live.start]);

  // Back out of the interview (or finish a brand) → the guide, reset for a fresh run. The
  // conversation is over, so she goes silent too — the guide must never come back mid-sentence.
  const resetToGuide = useCallback(() => {
    messages.current = [];
    setBrand(null);
    setCreated(null);
    setHeard('');
    setLine('');
    setKeyboardMode(false);
    setTalking(false);
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
      // Eve announces the launch in her REAL voice. This goes through the LIVE model, not the
      // one-shot TTS route: the two engines render the same voice name as different people, so
      // `/api/say` made her sound like a stranger seconds after a long conversation with her.
      // `announce()` opens a session that never starts the mic and closes itself when she's done —
      // no listening, no conversation. Fire-and-forget: the fanfare is never worth blocking on.
      void announce(session.access_token, `${brand.name} is online. Head to the Design tab — let's make your first drop.`, LIVE_VOICE);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create store');
    } finally {
      setCreating(false);
    }
  }, [session, brand]);

  // Drive the SHARED root avatar (eve-background) — this surface no longer mounts its own GL.
  // 'talking' raises her energy while she speaks (syllable-level reactivity rides the module-level
  // speech envelope with no plumbing); anything else rests at 'silence'. The old 'morphing' intro is
  // deliberately dropped: it re-plays the assembly, which reads as the app background disintegrating.
  useEffect(() => {
    setEveStage(state === 'speaking' ? 'talking' : 'silence');
  }, [state]);
  useEffect(() => () => setEveStage('silence'), []); // rest when this surface unmounts

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

  // Surfaces that are read and typed into rather than glanced at — they get the deep scrim.
  const dense = !!brand || (view === 'interview' && !keyboardMode);

  // The state pill — the one place her state is always legible. Silent is the resting state and
  // reads as such; everything else is a live session doing something.
  // What each sector does. Kept next to the gesture so a spoke can never point at nothing: every
  // id here exists in eve-wheel's SPOKES, and every brand-scoped one is guarded.
  const chooseSpoke = useCallback(
    (id: WheelId) => {
      const withSites = stores.filter((st) => siteUrlFor(st));
      const target = withSites[0] ?? stores[0] ?? null;
      switch (id) {
        case 'toggle':
          void toggleTalk();
          return;
        case 'type':
          setKeyboardMode(true);
          if (!talking) void toggleTalk();
          return;
        case 'newbr':
          // startVoice, not enterInterview: it's the same fresh-interview reset PLUS the mic
          // request and the fall-back-to-typing-on-denial that a first brand needs. The removed
          // "Build your brand" button used this path; the spoke inherits it.
          void startVoice();
          return;
        case 'design': {
          // Voice-first, not form-first. Opening <EveDesign> with no idea landed people in a bare
          // text input ("What shall I make?") — a typed form nobody asked for. Instead she stays
          // home, ASKS out loud, and the answer routes back as new-design{idea} → EveDesign opens
          // already generating (VENUS_CENTRAL C3: "no idea given → she asks first, then transitions").
          // Talking → prompt() (sendContext is silent by design and can never voice the ask);
          // silent → the ask becomes her opening line instead of the general hello.
          const ask =
            "(They picked DESIGN on your wheel — they want you to make a design. In ONE short sentence, ask what they'd like you to make. Nothing else.)";
          awaitDesignIdea.current = true;
          if (talking) {
            live.prompt(ask);
          } else {
            pendingGreeting.current = ask;
            void toggleTalk();
          }
          return;
        }
        case 'digest':
          void openDigest();
          return;
        case 'assets':
          router.push('/design?panel=web');
          return;
        case 'site': {
          // The Your-Brands deck (Joe, 2026-08-17): pick the brand FIRST, then its Console
          // (Edit site · Posts · Sell · Settings) via the deck's edit action — not Eve's voice-edit
          // surface, and not the first brand's console unasked. Voice edits stay reachable by
          // ASKING her (the edit-site intent → EveDeveloping).
          onShowBrands();
          return;
        }
        case 'brand': {
          // There is no in-place identity editor yet (EVE_CONTROL P3.1 is open), and inventing a
          // half one here would be worse than the thing that already works: ask Eve. Edits still go
          // through buildBrandPatch on her side, so NEVER_VIOLATE §2 holds.
          if (!target) return;
          const ask = `(They want to change ${target.name}'s brand info — name, voice, palette or story. In one short sentence, ask which they'd like to change. Confirm before applying anything.)`;
          if (talking) {
            live.prompt(ask);
          } else {
            pendingGreeting.current = ask;
            void toggleTalk();
          }
          return;
        }
      }
    },
    [stores, talking, toggleTalk, startVoice, openDigest, onGo, onShowBrands, live],
  );

  /** Release: act on the highlighted sector, or cancel when the thumb is in the centre. */
  const commitWheel = useCallback(
    (id: WheelId | null) => {
      if (wheelSpent.current) return;
      wheelSpent.current = true;
      setWheel(null);
      setWheelPick(null);
      if (!id) return; // released in the dead zone — she carries on exactly as she was
      const brandScoped = id === 'site' || id === 'assets' || id === 'digest' || id === 'brand';
      // Only refuse when we KNOW there's nothing to act on. If /api/me hasn't answered, the spoke
      // wasn't dimmed, so refusing here would be an invisible no-op — the exact confusion this
      // whole change removes.
      if (brandScoped && storesKnown && !stores.length) return;
      chooseSpoke(id);
    },
    [chooseSpoke, stores.length],
  );

  /** Quick tap keeps exactly its old meaning. */
  const tapEve = useCallback(() => {
    void toggleTalk();
  }, [toggleTalk]);

  // A tap RACED against long-press-then-pan, so the two can never both fire: the pan can only win
  // once the 180ms hold passes, and anything shorter resolves as the tap it always was.
  // These run on the JS thread. The worklets below hand over RAW NUMBERS and nothing else —
  // spokeAt() is an ordinary imported function, and calling one from a worklet executes it on the
  // UI thread, which crashes the app outright. (It survived the browser preview because web has no
  // separate UI thread; only a device shows it.)
  const openWheel = useCallback((wx: number, wy: number) => {
    wheelSpent.current = false;
    setWheel({ x: wx, y: wy });
    setWheelPick(null);
  }, []);
  const moveWheel = useCallback((dx: number, dy: number) => setWheelPick(spokeAt(dx, dy)), []);
  const endWheel = useCallback((dx: number, dy: number) => commitWheel(spokeAt(dx, dy)), [commitWheel]);
  const closeWheel = useCallback(() => {
    setWheel(null);
    setWheelPick(null);
  }, []);

  // WEB ONLY — the wheel is opened by a press-and-hold, which is also how macOS asks for its native
  // context menu (a two-finger click does it outright). That menu takes the pointer with it, so the
  // release never comes back to the page: the Pan never ends and the wheel hangs open with no way
  // to dismiss it. Refusing the menu on this surface keeps the hold ours. Phones have no such menu,
  // so nothing about the gesture creators actually use changes.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = wheelSurface.current as unknown as HTMLElement | null;
    if (!el) return;
    const block = (e: Event) => e.preventDefault();
    el.addEventListener('contextmenu', block);
    return () => el.removeEventListener('contextmenu', block);
  }, [session, brand]);

  // And a belt-and-braces release for web: if anything else still swallows the pointer-up (an
  // extension, a devtools overlay), the wheel resolves on the window's copy instead of hanging.
  useEffect(() => {
    if (Platform.OS !== 'web' || !wheel) return;
    const release = (e: { clientX: number; clientY: number }) =>
      commitWheel(spokeAt(e.clientX - wheel.x, e.clientY - wheel.y));
    const cancel = () => closeWheel();
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [wheel, commitWheel, closeWheel]);

  const wheelGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .activateAfterLongPress(180)
      .onStart((e) => {
        'worklet';
        scheduleOnRN(openWheel, e.absoluteX, e.absoluteY);
      })
      .onUpdate((e) => {
        'worklet';
        scheduleOnRN(moveWheel, e.translationX, e.translationY);
      })
      .onEnd((e) => {
        'worklet';
        scheduleOnRN(endWheel, e.translationX, e.translationY);
      })
      .onFinalize(() => {
        'worklet';
        scheduleOnRN(closeWheel);
      });
    const tap = Gesture.Tap().onEnd((_e, ok) => {
      'worklet';
      if (ok) scheduleOnRN(tapEve);
    });
    return Gesture.Exclusive(pan, tap);
  }, [openWheel, moveWheel, endWheel, closeWheel, tapEve]);

  const pill: { label: string; live: boolean } = !talking
    ? { label: 'SILENT', live: false }
    : paused
      ? { label: 'PAUSED', live: false }
      : state === 'speaking'
        ? { label: 'SPEAKING', live: true }
        : state === 'thinking'
          ? { label: 'THINKING', live: true }
          : state === 'listening'
            ? { label: 'LISTENING', live: true }
            : { label: 'CONNECTING', live: false };

  // Hosted inside the tab slot — the tab bar sits BELOW this surface, so no home-indicator
  // clearance is needed; just breathing room above the bar.
  const bottomPad = Spacing.five;

  if (hidden) return null;

  return (
    <View style={styles.fill}>

      {/* HER TINT, in three steps. She is the background of the whole app, which is lovely behind a
          caption and unreadable behind a form — so the scrim tracks how much READING the surface in
          front of her demands:
            talking, nothing over her → none (she performs at full brightness)
            resting                   → light, just enough that the captions read
            a dense surface (brand review, the interview's topic list) → deep, so fields and long
                                        copy sit on a calm ground instead of over a moving net. */}
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: dense ? READ_SCRIM : talking ? 'transparent' : REST_SCRIM }]}
      />

      {/* TAP TO TALK. Rendered FIRST so every control below sits above it: taps on empty space
          reach this, taps on a button reach the button. This is the whole gesture surface — the
          wheel (P2) will attach its long-press here too. */}
      {session && !brand ? (
        <GestureDetector gesture={wheelGesture}>
          <View
            ref={wheelSurface}
            accessibilityRole="button"
            accessibilityLabel={talking ? `Stop talking to ${AI_NAME}` : `Talk to ${AI_NAME}`}
            accessibilityHint="Press and hold for the menu"
            style={StyleSheet.absoluteFill}
          />
        </GestureDetector>
      ) : null}

      {/* THE WHEEL — above her and the scrim, below the modals. Purely presentational: the gesture
          owns the selection, this draws it. */}
      {wheel ? (
        <EveWheel
          x={wheel.x}
          y={wheel.y}
          active={wheelPick}
          hasBrand={stores.length > 0}
          brandsKnown={storesKnown}
          talking={talking}
        />
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

      {/* box-none: this is a LAYOUT container, not a touch target. Without it the full-screen flex
          box swallows every tap on empty space and the gesture surface beneath it — tap-to-talk and
          the wheel's long-press — never sees a finger. Its children still receive normally. */}
      <KeyboardAvoidingView
        pointerEvents="box-none"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[styles.content, { paddingTop: insets.top + Spacing.four, paddingBottom: bottomPad }]}>
        <View style={styles.headerRow}>
          <ThemedText type="code" style={[styles.eyebrow, { color: p.dim }]}>
            EVE
          </ThemedText>
          <View style={styles.headerSpacer} />
          {/* Her state, always on screen, always at the safe-area top. Tapping it is the same
              toggle as tapping her — the discoverable version of the gesture. */}
          {session && !brand ? (
            <Pressable
              onPress={() => void toggleTalk()}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={talking ? `Stop talking to ${AI_NAME}` : `Talk to ${AI_NAME}`}
              style={[styles.statePill, { borderColor: pill.live ? `${p.accent}66` : p.line }]}>
              <View style={[styles.stateDot, { backgroundColor: pill.live ? p.accent : p.faint }]} />
              <ThemedText type="code" style={{ color: pill.live ? p.accent : p.dim, fontSize: 10.5, letterSpacing: 1.4 }}>
                {pill.label}
              </ThemedText>
            </Pressable>
          ) : null}
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
          <View pointerEvents="box-none" style={styles.guideWrap}>
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
          !meResolved ? (
            // Cold load: /api/me hasn't answered yet, so we don't know WHICH guide this is — a
            // returning creator used to flash the first-brand mic CTA for a beat. Hold her surface
            // quiet (no CTA, no greeting, no spinner over her) until the answer lands.
            <View pointerEvents="box-none" style={styles.guideView} />
          ) : (
          // She fills the middle; the caption block sits in the LOWER THIRD — near the eye and the
          // thumb, not tucked under the status bar (D-23 is P1, this is the half of it the new
          // silent copy needs). A CTA sits below it.
          <View pointerEvents="box-none" style={styles.guideView}>
            <View style={styles.subsLower}>
              {talking ? (
                <>
                  {heard ? (
                    <ThemedText type="code" style={[styles.heard, { color: p.dim }]} numberOfLines={2}>
                      {'you > ' + heard}
                    </ThemedText>
                  ) : null}
                  {/* ONLY her actual words (Joe, 2026-08-17). `line` mirrors live.venusText — the
                      real transcript — and it used to fall back to guidance.greeting or an ellipsis
                      while the socket was still connecting, so the caption showed a canned line she
                      never said. Nothing is a truer caption than nothing; the state pill already
                      says CONNECTING / THINKING, so the surface isn't silent about what's going on. */}
                  {line ? (
                    <ThemedText style={[styles.line, { color: p.ink }]} numberOfLines={3}>
                      {line}
                    </ThemedText>
                  ) : null}
                </>
              ) : (
                <>
                  <ThemedText style={[styles.line, { color: p.ink }]} numberOfLines={2}>
                    {micOk === false ? `${AI_NAME} can’t hear you` : `Tap to talk to ${AI_NAME}`}
                  </ThemedText>
                  <ThemedText type="code" style={[styles.restSub, { color: p.faint }]}>
                    {micOk === false ? 'TYPE INSTEAD, OR ENABLE THE MIC IN SETTINGS' : 'SHE STAYS QUIET UNTIL YOU DO'}
                  </ThemedText>
                </>
              )}
            </View>
            {/* Both CTAs are gone (Joe, 2026-08-17). "Build your brand" did exactly what tapping
                her does, and the digest button was the badly-placed one he flagged on day one —
                both are wheel spokes now, so the surface under her stays clear. */}
          </View>
          )
        ) : keyboardMode ? null : (
          <>
            {/* "What to talk about" — name, products, style, colors, logo, vibe; checks off as they go. */}
            <InterviewTopics messages={live.messages} onAsk={live.sendText} p={p} />
            <View pointerEvents="box-none" style={styles.entityArea}>
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
          // Anchored ABOVE the control zone: at bottomPad the toast sat exactly on the guide's
          // only button (the digest / build CTA) — an error must never eat the way forward.
          <Pressable onPress={() => setError(null)} style={[styles.errorBar, { bottom: Spacing.six * 2 }]}>
            <ThemedText type="code" style={styles.error}>{error}</ThemedText>
            <ThemedText type="code" style={styles.errorDismiss}>tap to dismiss</ThemedText>
          </Pressable>
        ) : null}
      </KeyboardAvoidingView>

      {/* Keyboard mode = a full-screen chat window over the overlay (text-only; her voice muted).
          Guide view gets it too — the TYPE spoke is the mic-denied path, and it used to mute her
          and then render NO input at all outside the interview (a dead end, 2026-08-17). Typed
          guide turns run through the same intent router as speech, so DESIGN-by-keyboard works. */}
      {session && (view === 'interview' || view === 'guide') && !brand && keyboardMode ? (
        <ChatInterview
          messages={live.messages}
          streaming={live.venusText}
          thinking={live.state === 'thinking' || live.state === 'connecting'}
          aiName={AI_NAME}
          onSend={(t) => live.sendText(t)}
          onVoice={() => setKeyboardMode(false)}
          onExit={view === 'interview' ? resetToGuide : () => setKeyboardMode(false)}
          onFinalize={live.finalize}
          finalizing={live.finalizing}
          canBuild={buildReady && view === 'interview'}
          p={p}
          bg={BG}
        />
      ) : null}

      {/* THE DIGEST — Eve's proactive status report. A real <Modal> (the mic-busy pattern), not an
          in-page overlay: absolute positioning only dimmed the page, leaving the tab bar below it
          bright and tappable under a supposedly modal card. */}
      <Modal visible={showDigest} animationType="fade" transparent onRequestClose={() => setShowDigest(false)}>
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
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flex: 1, paddingHorizontal: Spacing.four },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  eyebrow: { letterSpacing: 3 },
  headerSpacer: { flex: 1 },
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four, marginLeft: Spacing.three },

  statePill: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 5 },
  stateDot: { width: 6, height: 6, borderRadius: 3 },

  guideWrap: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: Spacing.six },
  guideTitle: { fontSize: 28, textAlign: 'center' },
  guideBody: { textAlign: 'center', maxWidth: 320, lineHeight: 22, marginTop: Spacing.two },
  ctaPrimary: { borderRadius: 14, paddingVertical: Spacing.three, paddingHorizontal: Spacing.six, alignItems: 'center', marginTop: Spacing.four },

  // The guide: Eve fills the middle; the caption block sits in the LOWER THIRD, with the CTA under
  // it. `justifyContent: flex-end` + the caption's reserved height keeps the CTA still while her
  // lines stream in.
  guideView: { flex: 1, justifyContent: 'flex-end' },
  subsLower: { alignItems: 'center', gap: Spacing.two, minHeight: 96, justifyContent: 'flex-end', marginBottom: Spacing.five },
  restSub: { fontSize: 10.5, letterSpacing: 1.4, textAlign: 'center' },

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
