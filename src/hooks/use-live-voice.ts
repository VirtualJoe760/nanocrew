import { useCallback, useEffect, useRef, useState } from 'react';

import { LiveVoiceSession, type LiveState } from '@/lib/live-voice';
import type { BrandResult, ChatMessage } from '@/lib/interview';
import { apiUrl } from '@/lib/api';

export interface UseLiveVoice {
  state: LiveState;
  /** Running transcript of what Venus is saying (for captions). */
  venusText: string;
  /** Running transcript of what the user just said. */
  userText: string;
  /** The full committed conversation (completed turns) — for the keyboard chat view. */
  messages: ChatMessage[];
  error: string | null;
  /** Extracting the brand from the transcript (the "build my brand" step). */
  finalizing: boolean;
  start: () => void;
  stop: () => void;
  sendText: (text: string) => void;
  /** Push silent context into the session (no reply) — e.g. which site section was just circled. */
  sendContext: (text: string) => void;
  /** Text-only (keyboard chat) mode: mute the mic AND her voice playback. */
  mute: (m: boolean) => void;
  /** End the interview: extract the BrandResult from the transcript via /api/extract-brand. */
  finalize: () => void;
}

/**
 * React wrapper around LiveVoiceSession. Gemini Live is open-mic + VAD: once started, Venus
 * listens continuously, replies, and the user can interrupt by talking — a flowing conversation,
 * no push-to-talk. Caller controls start/stop (e.g. on interview focus / pause).
 */
export function useLiveVoice(opts: {
  accessToken: string | undefined;
  userName?: string;
  /** No stores yet → Venus introduces herself on her first line. */
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
  const sessionRef = useRef<LiveVoiceSession | null>(null);
  const onBrandRef = useRef(opts.onBrand);
  onBrandRef.current = opts.onBrand;

  const stop = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
  }, []);

  const start = useCallback(() => {
    if (sessionRef.current || !opts.accessToken) return;
    setError(null);
    setVenusText('');
    setUserText('');
    setMessages([]);
    const s = new LiveVoiceSession({
      accessToken: opts.accessToken,
      userName: opts.userName,
      firstTime: opts.firstTime,
      voiceName: opts.voiceName,
      instruction: opts.instruction,
      greeting: opts.greeting,
      enableBrandTool: opts.enableBrandTool,
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
    s.start().catch((e) => {
      setError(e instanceof Error ? e.message : 'Could not start voice');
      setState('error');
      sessionRef.current = null;
    });
  }, [opts.accessToken, opts.userName, opts.firstTime, opts.voiceName, opts.instruction, opts.greeting, opts.enableBrandTool]);

  const sendText = useCallback((text: string) => {
    sessionRef.current?.sendText(text);
  }, []);

  const sendContext = useCallback((text: string) => {
    sessionRef.current?.sendContext(text);
  }, []);

  const mute = useCallback((m: boolean) => {
    sessionRef.current?.setMuted(m);
  }, []);

  const [finalizing, setFinalizing] = useState(false);
  const finalize = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || finalizing || !opts.accessToken) return;
    const messages = s.getTranscript();
    if (!messages.length) { setError('Talk to Venus a bit first, then build your brand.'); return; }
    setFinalizing(true);
    setError(null);
    try {
      const r = await fetch(apiUrl('/api/extract-brand'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.accessToken}` },
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

  // Always tear down on unmount.
  useEffect(() => () => { sessionRef.current?.stop(); sessionRef.current = null; }, []);

  return { state, venusText, userText, messages, error, finalizing, start, stop, sendText, sendContext, mute, finalize };
}
