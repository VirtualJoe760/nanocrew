import { useCallback, useEffect, useRef, useState } from 'react';

import { LiveVoiceSession, type LiveState } from '@/lib/live-voice';
import type { BrandResult } from '@/lib/interview';

export interface UseLiveVoice {
  state: LiveState;
  /** Running transcript of what Venus is saying (for captions). */
  venusText: string;
  /** Running transcript of what the user just said. */
  userText: string;
  error: string | null;
  start: () => void;
  stop: () => void;
}

/**
 * React wrapper around LiveVoiceSession. Gemini Live is open-mic + VAD: once started, Venus
 * listens continuously, replies, and the user can interrupt by talking — a flowing conversation,
 * no push-to-talk. Caller controls start/stop (e.g. on interview focus / pause).
 */
export function useLiveVoice(opts: {
  accessToken: string | undefined;
  userName?: string;
  voiceName?: string;
  onBrand: (b: BrandResult) => void;
}): UseLiveVoice {
  const [state, setState] = useState<LiveState>('idle');
  const [venusText, setVenusText] = useState('');
  const [userText, setUserText] = useState('');
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
    const s = new LiveVoiceSession({
      accessToken: opts.accessToken,
      userName: opts.userName,
      voiceName: opts.voiceName,
      callbacks: {
        onState: setState,
        // transcripts arrive in fragments — append within a turn, reset when she starts a new one
        onVenusTranscript: (t) => setVenusText((prev) => prev + t),
        onUserTranscript: (t) => setUserText((prev) => prev + t),
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
  }, [opts.accessToken, opts.userName, opts.voiceName]);

  // Always tear down on unmount.
  useEffect(() => () => { sessionRef.current?.stop(); sessionRef.current = null; }, []);

  return { state, venusText, userText, error, start, stop };
}
