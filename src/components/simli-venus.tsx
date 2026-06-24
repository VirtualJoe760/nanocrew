import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { apiFetch, readJson } from '@/lib/api';
import { buildSimliHtml } from '@/components/simli-venus-html';

// NATIVE renderer for the Simli avatar. simli-client is browser/WebRTC-only (AudioContext + window),
// so on iOS/Android we run it inside a react-native-webview: the RN side mints the session token from
// our gated server route (SIMLI_API_KEY stays on the server), then injects ONLY that token into a tiny
// HTML page that loads simli-client from a CDN and connects over LiveKit. The key never enters the
// WebView. (Needs a dev build — WebRTC in WKWebView.) Web uses simli-venus.web.tsx with the SAME HTML.

export default function SimliVenus() {
  const [token, setToken] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await readJson<{ sessionToken?: string }>(
          await apiFetch('/api/venus/simli-session', { method: 'POST' }),
        );
        if (!data.sessionToken) throw new Error('no session token');
        if (!cancelled) setToken(data.sessionToken);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return (
      <View style={styles.center}>
        <Text style={styles.note}>Simli error: {err}</Text>
      </View>
    );
  }
  if (!token) {
    return (
      <View style={styles.center}>
        <Text style={styles.note}>[ connecting to Simli… ]</Text>
      </View>
    );
  }

  return (
    <WebView
      style={styles.web}
      source={{ html: buildSimliHtml(token) }}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
    />
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#06080f' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#06080f' },
  note: { color: '#7cc7df', fontFamily: 'Jost-Light', fontSize: 14, letterSpacing: 1 },
});
