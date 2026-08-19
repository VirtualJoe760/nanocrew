import { useCallback, useEffect, useRef, useState } from 'react';

import { LiveVoiceSession, AudioSessionBusyError, type LiveState } from '@/lib/live-voice';
import type { BrandResult, ChatMessage } from '@/lib/interview';
import { apiUrl } from '@/lib/api';
import { supabase } from '@/lib/supabase';

export interface UseLiveVoice {
  state: LiveState;
  /** Running transcript of what Eve is saying (for captions). */
  venusText: string;
  /** Running transcript of what the user just said. */
  userText: string;
  /** The full committed conversation (completed turns) — for the keyboard chat view. */
  messages: ChatMessage[];
  error: string | null;
  /** The mic couldn't be claimed because another app (an active phone/FaceTime call) holds the audio
   *  session. The UI shows a "end your call, then come back" modal — NOT the generic error path. */
  audioBusy: boolean;
  /** Dismiss the audio-busy modal (does NOT restart — the caller decides whether to retry). */
  dismissAudioBusy: () => void;
  /** Extracting the brand from the transcript (the "build my brand" step). */
  finalizing: boolean;
  /** Open the session. `greet` false re-opens under an ongoing conversation without re-introducing.
   *  `greeting` overrides her opening line's instruction for THIS open only (e.g. the DESIGN spoke:
   *  she asks what to make instead of the general hello). */
  start: (greet?: boolean, greeting?: string) => void;
  stop: () => void;
  /** Go quiet WITHOUT tearing down: mute in both directions and hold the socket for a grace period,
   *  so glancing at another surface and coming back is instant, free, and keeps the transcript.
   *  The socket is closed only if the grace expires. */
  suspend: () => void;
  /** Come back from a suspend. Returns false if the socket has already been released — the caller
   *  then decides whether to `start(false)` a fresh one. */
  resume: () => boolean;
  /** Is a live socket currently held (open or suspended)? */
  isLive: () => boolean;
  sendText: (text: string) => void;
  /** Make her SPEAK now — a stage direction sent as a completed turn (she replies out loud, no
   *  transcript trace). sendContext can never voice anything; this is the ask-spokes' channel. */
  prompt: (text: string, onSent?: () => void) => void;
  /** Push silent context into the session (no reply) — e.g. which site section was just circled. */
  sendContext: (text: string) => void;
  /** Let her SEE something — a settled design, a product shot. Base64 + mime, optional note. */
  sendImage: (base64: string, mimeType: string, note?: string) => void;
  /** Text-only (keyboard chat) mode: mute the mic AND her voice playback. */
  mute: (m: boolean) => void;
  /** End the interview: extract the BrandResult from the transcript via /api/extract-brand. */
  finalize: () => void;
}

/** How long a suspended session is held before the socket is released. Long enough to cover a
 *  glance at the brand console or a hop to another tab; short enough that walking away doesn't
 *  leave a paid connection open. */
const SUSPEND_GRACE_MS = 45_000;

/** How long queued context stays worth sending. A digest briefing is a snapshot of the numbers;
 *  handing her a stale one when she finally wakes is worse than handing her nothing. */
const CONTEXT_TTL_MS = 5 * 60_000;

/**
 * React wrapper around LiveVoiceSession. Gemini Live is open-mic + VAD: once started, Eve
 * listens continuously, replies, and the user can interrupt by talking — a flowing conversation,
 * no push-to-talk. Caller controls start/stop (e.g. on interview focus / pause).
 *
 * THREE levels of "not talking", and the difference is money:
 *   mute()    — text mode; socket open, both directions silenced.
 *   suspend() — she's covered or the app is backgrounded; socket HELD for SUSPEND_GRACE_MS so
 *               coming back is instant and the transcript survives, then released.
 *   stop()    — done; socket closed now.
 * A session is only ever opened by an explicit start(), never by a surface merely appearing.
 */
export function useLiveVoice(opts: {
  accessToken: string | undefined;
  userName?: string;
  /** No stores yet → Eve introduces herself on her first line. */
  firstTime?: boolean;
  voiceName?: string;
  /** Override the persona/greeting + drop the brand tool — for non-build flows (e.g. editing a site). */
  instruction?: string;
  greeting?: string;
  enableBrandTool?: boolean;
  /** transcript is the full spoken conversation — pass it to /api/store so provisioning gets context. */
  onBrand: (b: BrandResult, transcript?: ChatMessage[]) => void;
}): UseLiveVoice {
  const [state, setState] = useState<LiveState>('idle');
  const [venusText, setVenusText] = useState('');
  const [userText, setUserText] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [audioBusy, setAudioBusy] = useState(false);
  const sessionRef = useRef<LiveVoiceSession | null>(null);
  const onBrandRef = useRef(opts.onBrand);
  onBrandRef.current = opts.onBrand;

  // Mute has two independent owners — keyboard mode and a suspend — so track them separately and
  // apply the OR. Letting either one write `setMuted` directly means whichever fires last wins, and
  // resuming from a suspend would un-mute a keyboard-mode session.
  const mutedByKeyboard = useRef(false);
  const mutedBySuspend = useRef(false);
  const applyMute = useCallback(() => {
    sessionRef.current?.setMuted(mutedByKeyboard.current || mutedBySuspend.current);
  }, []);

  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearGrace = useCallback(() => {
    if (graceTimer.current) {
      clearTimeout(graceTimer.current);
      graceTimer.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    clearGrace();
    mutedBySuspend.current = false;
    sessionRef.current?.stop();
    sessionRef.current = null;
  }, [clearGrace]);

  const suspend = useCallback(() => {
    if (!sessionRef.current || mutedBySuspend.current) return;
    mutedBySuspend.current = true;
    applyMute();
    clearGrace();
    graceTimer.current = setTimeout(() => {
      graceTimer.current = null;
      // Grace expired — release the socket (and the iOS audio session with it) rather than holding
      // a paid connection open for someone who has moved on.
      sessionRef.current?.stop();
      sessionRef.current = null;
      mutedBySuspend.current = false;
    }, SUSPEND_GRACE_MS);
  }, [applyMute, clearGrace]);

  const resume = useCallback(() => {
    clearGrace();
    if (!sessionRef.current) {
      mutedBySuspend.current = false;
      return false;
    }
    mutedBySuspend.current = false;
    applyMute();
    return true;
  }, [applyMute, clearGrace]);

  const isLive = useCallback(() => !!sessionRef.current, []);

  // Context queued while she's SILENT, flushed when a session next opens.
  //
  // This exists because of the silent-by-default change: `sendContext` is a no-op with no socket
  // (live-voice.ts drops it on `this.session?.`), and before P0 she was always live so it always
  // landed. Now the common case is a creator opening the digest while she's quiet — the briefing
  // was being thrown away, so the first thing she'd be asked about her numbers she'd guess at,
  // silently undoing the whole point of digestBriefing().
  //
  // TTL'd because a briefing is a snapshot: handing her twenty-minute-old revenue when she finally
  // wakes is worse than handing her nothing.
  const pendingContext = useRef<{ text: string; at: number }[]>([]);
  const flushContext = useCallback(() => {
    const fresh = pendingContext.current.filter((c) => Date.now() - c.at < CONTEXT_TTL_MS);
    pendingContext.current = [];
    for (const c of fresh) sessionRef.current?.sendContext(c.text);
  }, []);

  const sendContext = useCallback((text: string) => {
    if (sessionRef.current) {
      sessionRef.current.sendContext(text);
      return;
    }
    pendingContext.current.push({ text, at: Date.now() });
    // Keep only the most recent few — this is context, not a log.
    if (pendingContext.current.length > 4) pendingContext.current.shift();
  }, []);

  const start = useCallback((greet = true, greeting?: string) => {
    if (sessionRef.current || !opts.accessToken) return;
    clearGrace();
    mutedBySuspend.current = false;
    setError(null);
    setAudioBusy(false);
    setVenusText('');
    setUserText('');
    setMessages([]);
    const s = new LiveVoiceSession({
      accessToken: opts.accessToken,
      userName: opts.userName,
      firstTime: opts.firstTime,
      voiceName: opts.voiceName,
      instruction: opts.instruction,
      greeting: greeting ?? opts.greeting,
      enableBrandTool: opts.enableBrandTool,
      greetOnOpen: greet,
      callbacks: {
        onState: setState,
        // session emits the FULL current utterance (with per-turn resets), so just replace.
        onVenusTranscript: (t) => setVenusText(t),
        onUserTranscript: (t) => setUserText(t),
        onTranscript: (msgs) => setMessages(msgs),
        onBrand: (b) => onBrandRef.current(b),
        onError: (m) => setError(m),
      },
    });
    sessionRef.current = s;
    s.start().then(flushContext).catch((e) => {
      sessionRef.current = null;
      // On a call → show the dedicated "mic busy" modal, not the generic error banner.
      if (e instanceof AudioSessionBusyError) {
        setAudioBusy(true);
        setState('idle');
        return;
      }
      setError(e instanceof Error ? e.message : 'Could not start voice');
      setState('error');
    });
  }, [opts.accessToken, opts.userName, opts.firstTime, opts.voiceName, opts.instruction, opts.greeting, opts.enableBrandTool, clearGrace, flushContext]);

  const sendText = useCallback((text: string) => {
    sessionRef.current?.sendText(text);
  }, []);

  const prompt = useCallback((text: string, onSent?: () => void) => {
    if (!sessionRef.current) { onSent?.(); return; } // no session → don't strand the caller
    sessionRef.current.prompt(text, onSent);
  }, []);


  const sendImage = useCallback((base64: string, mimeType: string, note?: string) => {
    sessionRef.current?.sendImage(base64, mimeType, note);
  }, []);

  const mute = useCallback((m: boolean) => {
    mutedByKeyboard.current = m;
    applyMute();
  }, [applyMute]);

  const dismissAudioBusy = useCallback(() => setAudioBusy(false), []);

  const [finalizing, setFinalizing] = useState(false);
  const finalize = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || finalizing || !opts.accessToken) return;
    const messages = s.getTranscript();
    if (!messages.length) { setError('Talk to Eve a bit first, then build your brand.'); return; }
    setFinalizing(true);
    setError(null);
    try {
      // FRESH token: supabase-js pauses auto-refresh in hidden/unfocused web tabs, so the prop
      // can be expired by build time (2026-08-18: Build → 'unauthorized'). getSession() refreshes
      // an expired token on demand.
      let token = opts.accessToken;
      try {
        const { data } = await supabase.auth.getSession();
        token = data.session?.access_token ?? token;
      } catch { /* fall back to the prop */ }
      const r = await fetch(apiUrl('/api/extract-brand'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages }),
      });
      const d = (await r.json()) as { brand?: BrandResult; error?: string };
      if (d.brand) {
        s.stop();
        sessionRef.current = null;
        onBrandRef.current(d.brand, messages);
      } else {
        setError(d.error || 'Could not build the brand yet — keep chatting and try again.');
      }
    } catch {
      setError('Could not build the brand — try again.');
    } finally {
      setFinalizing(false);
    }
  }, [finalizing, opts.accessToken]);

  // Always tear down on unmount — including a pending suspend grace timer, which would otherwise
  // fire against a dead session.
  useEffect(() => () => { clearGrace(); sessionRef.current?.stop(); sessionRef.current = null; }, [clearGrace]);

  return { state, venusText, userText, messages, error, audioBusy, dismissAudioBusy, finalizing, start, stop, suspend, resume, isLive, sendText, prompt, sendContext, sendImage, mute, finalize };
}
