import { useEffect, useState } from 'react';

import { apiFetch, readJson } from '@/lib/api';
import { buildSimliHtml } from '@/components/simli-venus-html';

// WEB renderer for the Simli avatar. We mint the session token from our gated server route (the
// SIMLI_API_KEY stays on the server), then run simli-client inside an <iframe srcDoc> that loads the
// SDK from a CDN — so Metro never has to bundle the browser-only package. Native (simli-venus.tsx)
// does the same via a WebView with the SAME HTML builder. See docs/studio/VENUS_AVATAR.md.

type Status = 'connecting' | 'ready' | 'error';

export default function SimliVenus() {
  const [html, setHtml] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [err, setErr] = useState<string>('');

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

  return (
    <div style={wrap}>
      {status === 'ready' && html ? (
        <iframe title="Simli Venus" srcDoc={html} allow="autoplay" style={frame} />
      ) : (
        <div style={overlay}>{status === 'error' ? `Simli error: ${err}` : '[ connecting to Simli… ]'}</div>
      )}
    </div>
  );
}

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
