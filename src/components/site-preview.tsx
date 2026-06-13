import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, type LayoutChangeEvent, Linking, Modal, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line, Path, Polyline } from 'react-native-svg';
import { WebView } from 'react-native-webview';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { apiUrl } from '@/lib/api';

// A live, navigable view of the creator's storefront — the in-app "iframe". When opened
// with critique props, the creator can DRAW on the page and TALK to Venus at the same
// time; her transcribed critique + the marked regions become a revision brief that Claude
// applies on a branch (preview → approve → main). Full-screen modal.

const BG = '#0a0a0c';
const GOLD = '#c9a86a';
const INK = '#f3f1ec';
const DIM = 'rgba(243,241,236,0.6)';

type Pt = { x: number; y: number };
type Critique = { slug: string; token: string; onSent?: () => void };

function host(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** Rough human label for where a stroke sits, so Claude knows the area without a screenshot. */
function regionLabel(stroke: Pt[], w: number, h: number): string {
  if (!stroke.length || !w || !h) return 'somewhere on the page';
  const xs = stroke.map((p) => p.x);
  const ys = stroke.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2 / w;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2 / h;
  const v = cy < 0.34 ? 'top' : cy > 0.66 ? 'bottom' : 'middle';
  const hpos = cx < 0.34 ? 'left' : cx > 0.66 ? 'right' : 'centre';
  return `${v}-${hpos}`;
}

export function SitePreview({
  visible,
  url,
  onClose,
  critique,
}: {
  visible: boolean;
  url: string;
  onClose: () => void;
  critique?: Critique;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaProvider>
        <PreviewContent url={url} onClose={onClose} critique={critique} />
      </SafeAreaProvider>
    </Modal>
  );
}

function PreviewContent({ url, onClose, critique }: { url: string; onClose: () => void; critique?: Critique }) {
  const insets = useSafeAreaInsets();
  const ref = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);

  // Critique mode
  const [drawing, setDrawing] = useState(false);
  const drawingRef = useRef(false);
  const [strokes, setStrokes] = useState<Pt[][]>([]);
  const cur = useRef<Pt[]>([]);
  const [, tick] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder, 300);
  const [recording, setRecording] = useState(false);

  const setMode = (on: boolean) => {
    drawingRef.current = on;
    setDrawing(on);
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => drawingRef.current,
        onMoveShouldSetPanResponder: () => drawingRef.current,
        onPanResponderGrant: (e) => {
          cur.current = [{ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }];
          tick((n) => n + 1);
        },
        onPanResponderMove: (e) => {
          cur.current.push({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY });
          tick((n) => n + 1);
        },
        onPanResponderRelease: () => {
          if (cur.current.length > 1) setStrokes((s) => [...s, cur.current]);
          cur.current = [];
          tick((n) => n + 1);
        },
      }),
    [],
  );

  const startRec = async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setNote('Microphone access is needed to talk to Venus.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      setNote(null);
    } catch {
      setNote('Could not start recording.');
    }
  };
  const stopRec = async () => {
    try {
      await recorder.stop();
    } catch {
      /* ignore */
    }
    setRecording(false);
  };

  const send = async () => {
    if (!critique) return;
    setSending(true);
    setNote(null);
    let spoken = '';
    try {
      if (recording) await stopRec();
      const uri = recorder.uri;
      if (uri) {
        const audio = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        const r = await fetch(apiUrl('/api/transcribe'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${critique.token}` },
          body: JSON.stringify({ audio }),
        });
        spoken = ((await r.json()) as { text?: string }).text?.trim() ?? '';
      }
    } catch {
      /* transcription best-effort */
    }

    const regions = strokes.map((s) => regionLabel(s, size.w, size.h));
    const parts = [
      spoken,
      regions.length ? `I marked these areas while talking: ${regions.join('; ')}.` : '',
      `(About the page: ${url})`,
    ].filter(Boolean);
    const md = parts.join('\n\n').trim();
    if (!md || (!spoken && !regions.length)) {
      setNote('Say something or mark the page first.');
      setSending(false);
      return;
    }

    try {
      const res = await fetch(apiUrl('/api/creator/revise'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${critique.token}` },
        body: JSON.stringify({ storeSlug: critique.slug, requestMd: md, screenshots: [] }),
      });
      if (!res.ok) throw new Error();
      setStrokes([]);
      setMode(false);
      critique.onSent?.();
      onClose();
    } catch {
      setNote('Could not send your critique. Try again.');
    } finally {
      setSending(false);
    }
  };

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  const toPath = (s: Pt[]) => s.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ');

  return (
    <View style={[styles.fill, { paddingTop: Math.max(insets.top, 12), paddingBottom: insets.bottom }]}>
      <View style={styles.bar}>
        <Pressable onPress={onClose} hitSlop={12} style={styles.iconBtn}>
          <Svg width={20} height={20}>
            <Line x1={5} y1={5} x2={15} y2={15} stroke={DIM} strokeWidth={1.6} strokeLinecap="round" />
            <Line x1={15} y1={5} x2={5} y2={15} stroke={DIM} strokeWidth={1.6} strokeLinecap="round" />
          </Svg>
        </Pressable>
        <Pressable onPress={() => canGoBack && ref.current?.goBack()} hitSlop={12} style={[styles.iconBtn, !canGoBack && { opacity: 0.3 }]}>
          <Svg width={20} height={20}>
            <Polyline points="12,4 6,10 12,16" fill="none" stroke={DIM} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
        <View style={styles.urlPill}>
          <ThemedText type="code" style={styles.urlText} numberOfLines={1}>
            {host(url)}
          </ThemedText>
        </View>
        {critique ? (
          <Pressable onPress={() => setMode(!drawing)} hitSlop={12} style={[styles.iconBtn, drawing && styles.iconBtnOn]}>
            <Svg width={20} height={20}>
              <Path d="M4 16 L12 8 L14 10 L6 18 Z" fill="none" stroke={drawing ? BG : GOLD} strokeWidth={1.6} strokeLinejoin="round" />
              <Line x1={12} y1={8} x2={15} y2={5} stroke={drawing ? BG : GOLD} strokeWidth={1.6} strokeLinecap="round" />
            </Svg>
          </Pressable>
        ) : null}
        <Pressable onPress={() => ref.current?.reload()} hitSlop={12} style={styles.iconBtn}>
          <Svg width={20} height={20}>
            <Path d="M5 10 a5 5 0 1 1 1.5 3.5" fill="none" stroke={DIM} strokeWidth={1.6} strokeLinecap="round" />
            <Polyline points="4,6 5,10 9,9" fill="none" stroke={DIM} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
        <Pressable onPress={() => Linking.openURL(url)} hitSlop={12} style={styles.iconBtn}>
          <Svg width={20} height={20}>
            <Path d="M8 4 H5 a1 1 0 0 0 -1 1 V15 a1 1 0 0 0 1 1 H15 a1 1 0 0 0 1 -1 V12" fill="none" stroke={DIM} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            <Line x1={10} y1={10} x2={16} y2={4} stroke={DIM} strokeWidth={1.5} strokeLinecap="round" />
            <Polyline points="12,4 16,4 16,8" fill="none" stroke={DIM} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
      </View>

      <View style={styles.webWrap} onLayout={onLayout}>
        <WebView
          ref={ref}
          source={{ uri: url }}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onNavigationStateChange={(s) => setCanGoBack(s.canGoBack)}
          style={styles.web}
          pointerEvents={drawing ? 'none' : 'auto'}
        />
        {/* Drawing layer — captures touches only in critique mode */}
        <View style={StyleSheet.absoluteFill} pointerEvents={drawing ? 'auto' : 'none'} {...pan.panHandlers}>
          <Svg style={StyleSheet.absoluteFill}>
            {strokes.map((s, i) => (
              <Polyline key={i} points={toPath(s)} fill="none" stroke={GOLD} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.95} />
            ))}
            {cur.current.length > 1 ? (
              <Polyline points={toPath(cur.current)} fill="none" stroke={GOLD} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
            ) : null}
          </Svg>
        </View>
        {loading ? (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator color={GOLD} />
          </View>
        ) : null}
      </View>

      {/* Critique toolbar */}
      {critique && drawing ? (
        <View style={[styles.tools, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          {note ? <ThemedText type="code" style={styles.note}>{note}</ThemedText> : null}
          <ThemedText type="code" style={styles.toolsHint}>
            {recording ? `● recording your critique… ${Math.round((recState.durationMillis ?? 0) / 1000)}s` : 'Draw on the page and talk Venus through the changes.'}
          </ThemedText>
          <View style={styles.toolsRow}>
            <Pressable onPress={recording ? stopRec : startRec} style={[styles.recBtn, recording && styles.recBtnOn]}>
              <ThemedText type="smallBold" style={{ color: recording ? BG : INK }}>{recording ? 'Stop' : '● Talk to Venus'}</ThemedText>
            </Pressable>
            {strokes.length ? (
              <Pressable onPress={() => setStrokes([])} hitSlop={8} style={styles.clearBtn}>
                <ThemedText type="code" style={styles.dim}>clear</ThemedText>
              </Pressable>
            ) : null}
            <View style={{ flex: 1 }} />
            <Pressable onPress={send} disabled={sending} style={[styles.sendBtn, sending && { opacity: 0.5 }]}>
              <ThemedText type="smallBold" style={{ color: BG }}>{sending ? 'Sending…' : 'Send →'}</ThemedText>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: BG },
  bar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  iconBtnOn: { backgroundColor: GOLD },
  urlPill: { flex: 1, backgroundColor: 'rgba(201,168,106,0.07)', borderWidth: 1, borderColor: 'rgba(201,168,106,0.2)', borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 6 },
  urlText: { color: DIM, fontSize: 12 },
  webWrap: { flex: 1, backgroundColor: '#fff' },
  web: { flex: 1 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },
  tools: { backgroundColor: BG, borderTopWidth: 1, borderTopColor: 'rgba(201,168,106,0.2)', paddingHorizontal: Spacing.four, paddingTop: Spacing.three, gap: Spacing.two },
  toolsHint: { color: DIM, fontSize: 12 },
  note: { color: '#e0a07a', fontSize: 12 },
  toolsRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  recBtn: { borderWidth: 1, borderColor: GOLD, borderRadius: 999, paddingHorizontal: Spacing.four, paddingVertical: Spacing.three },
  recBtnOn: { backgroundColor: GOLD, borderColor: GOLD },
  clearBtn: { paddingVertical: Spacing.two },
  sendBtn: { backgroundColor: GOLD, borderRadius: 999, paddingHorizontal: Spacing.five, paddingVertical: Spacing.three },
  dim: { color: DIM },
});
