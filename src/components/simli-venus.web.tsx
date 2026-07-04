import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { apiFetch, readJson } from '@/lib/api';
import { buildSimliHtml, synthSimliPcm, type SimliVenusHandle } from '@/components/simli-venus-html';

// WEB renderer for the Simli avatar. We mint the session token from our gated server route (the
// SIMLI_API_KEY stays on the server), then run simli-client inside an <iframe srcDoc> that loads the
// SDK from a CDN — so Metro never has to bundle the browser-only package. The `speak(text)` handle
// (used by the Venus Lab) fetches Venus's Gemini-voice PCM and postMessages it into the frame.
// Native (simli-venus.tsx) does the same via a WebView. See docs/studio/VENUS_AVATAR.md.

type Status = 'connecting' | 'ready' | 'error';

const SimliVenus = forwardRef<SimliVenusHandle>(function SimliVenus(_props, ref) {
  const [html, setHtml] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [err, setErr] = useState<string>('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await readJson<{ sessionToken?: string }>(
          await apiFetch('/api/venus/simli-session', { method: 'POST' }),
        );
        if (!data.sessionToken) throw new Error('no session token');
        if (cancelled) return;
        setHtml(buildSimliHtml(data.sessionToken));
        setStatus('ready');
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : String(e));
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      async speak(text: string, voice?: string) {
        const pcm = await synthSimliPcm(text, voice);
        if (pcm) iframeRef.current?.contentWindow?.postMessage({ type: 'simli-speak', pcm }, '*');
      },
    }),
    [],
  );

  return (
    <div style={wrap}>
      {status === 'ready' && html ? (
        <iframe ref={iframeRef} title="Simli Venus" srcDoc={html} allow="autoplay" style={frame} />
      ) : (
        <div style={overlay}>{status === 'error' ? `Simli error: ${err}` : '[ connecting to Simli… ]'}</div>
      )}
    </div>
  );
});

export default SimliVenus;

const wrap: React.CSSProperties = { position: 'absolute', inset: 0, background: '#06080f' };
const frame: React.CSSProperties = { width: '100%', height: '100%', border: 0, background: '#06080f' };
const overlay: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#7cc7df',
  fontFamily: 'Jost-Light, sans-serif',
  fontSize: 14,
  letterSpacing: 1,
};
