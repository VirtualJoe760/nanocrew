import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, type LayoutChangeEvent, Linking, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line, Path, Polyline } from 'react-native-svg';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';

import { ThemedText } from '@/components/themed-text';
import { VenusOrb } from '@/components/venus-orb';
import { Spacing } from '@/constants/theme';
import { apiUrl } from '@/lib/api';

// A live, navigable view of the creator's storefront — the in-app "iframe". In critique mode
// it becomes a turn-based editor driven by Venus: tap the orb to talk, tap the pen to circle a
// spot (one circle per tap, marks stay anchored to the page as you scroll), describe the change,
// tap the orb to finish. Each turn becomes one itemised edit; Submit ships the batch (markdown +
// circled regions) to Claude on the VPS, who applies it on a branch (preview → approve → main).

const BG = '#0a0a0c';
const GOLD = '#c9a86a';
const INK = '#f3f1ec';
const DIM = 'rgba(243,241,236,0.6)';
const FAINT = 'rgba(243,241,236,0.28)';

const COACHING = 'Tap me to talk, circle what you want to change, tell me the adjustment, then tap me to stop. Submit when you’re done.';

type Pt = { x: number; y: number };
type Critique = { slug: string; token: string; onSent?: () => void };
type EditItem = { id: string; note: string; regions: string[]; strokes: Pt[][] };

function host(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** Rough human label for where a stroke sits — the fallback when the DOM hit-test can't resolve. */
function regionLabel(stroke: Pt[], w: number, h: number): string {
  if (!stroke.length || !w || !h) return 'somewhere on the page';
  const xs = stroke.map((p) => p.x);
  const ys = stroke.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2 / w;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2 / (h || 1);
  const v = cy < 0.34 ? 'top' : cy > 0.66 ? 'bottom' : 'middle';
  const hpos = cx < 0.34 ? 'left' : cx > 0.66 ? 'right' : 'centre';
  return `the ${v}-${hpos} of the page`;
}

// Enable the mic meter so Venus's orb can ride the live audio level while she listens.
const REC_OPTS = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };

type Hit = { __nanoHit?: boolean; i?: number; block?: string; tag?: string; heading?: string; text?: string };

// Injected on every load: report the page's scroll position so native marks can stay anchored
// to the content as it scrolls (rAF-throttled).
const SCROLL_SCRIPT = `(function(){if(window.__nanoScrollWired)return;window.__nanoScrollWired=true;
function P(){window.ReactNativeWebView.postMessage(JSON.stringify({__nanoScroll:true,y:window.scrollY||window.pageYOffset||0}));}
var t=false;window.addEventListener('scroll',function(){if(t)return;t=true;requestAnimationFrame(function(){t=false;P();});},{passive:true});P();})();true;`;

/** A WebView hit-test: resolve a circled point to the page section it lands on — by block name,
 *  nearest heading, or nearby text — so Venus can tell Claude WHAT was circled, not just where. */
function hitScript(i: number, x: number, y: number): string {
  return `(function(){function P(o){o.__nanoHit=true;o.i=${i};window.ReactNativeWebView.postMessage(JSON.stringify(o));}
try{var el=document.elementFromPoint(${x},${y});if(!el){P({});return;}
var n=el,blk=null,sec=null;
while(n&&n!==document.body){if(n.getAttribute&&n.getAttribute('data-block')){blk=n;break;}
var t=(n.tagName||'').toLowerCase();if(!sec&&['section','header','footer','nav','main','article','form'].indexOf(t)>=0)sec=n;n=n.parentElement;}
var ctx=blk||sec||el;var h=ctx.querySelector?ctx.querySelector('h1,h2,h3'):null;
P({block:blk?blk.getAttribute('data-block'):'',tag:(ctx.tagName||'').toLowerCase(),
heading:h?(h.textContent||'').replace(/\\s+/g,' ').trim().slice(0,80):'',
text:(el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,60)});
}catch(e){P({});}})();true;`;
}

/** Turn a resolved hit into a phrase for the brief. null → fall back to a positional label. */
function describeHit(d: Hit): string | null {
  if (d.block) return `the "${d.block}" section${d.heading ? ` ("${d.heading}")` : ''}`;
  if (d.heading) return `the ${d.tag || 'section'} headed "${d.heading}"`;
  if (d.text) return `the ${d.tag || 'area'} near the text "${d.text}"`;
  return null;
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

  // Document-anchored marks: track the page's live scroll so strokes stay on their section.
  const scrollYRef = useRef(0);
  const [scrollY, setScrollY] = useState(0);

  // Pen is a one-shot: tap to arm, draw a single circle, then it disarms so you can scroll again.
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // The edit currently being composed (strokes in DOCUMENT coordinates).
  const [draftStrokes, setDraftStrokes] = useState<Pt[][]>([]);
  const [draftHits, setDraftHits] = useState<Record<number, string | null>>({});
  const cur = useRef<Pt[]>([]);
  const [, tick] = useState(0);

  // Talk
  const recorder = useAudioRecorder(REC_OPTS);
  const recState = useAudioRecorderState(recorder, 100);
  const [recording, setRecording] = useState(false);
  const level = recording && typeof recState.metering === 'number' ? Math.max(0, Math.min(1, (recState.metering + 50) / 50)) : 0;

  // Type instead of talk
  const [typing, setTyping] = useState(false);
  const [draftText, setDraftText] = useState('');

  // Captured edits + review
  const [edits, setEdits] = useState<EditItem[]>([]);
  const editSeq = useRef(0);
  const [reviewing, setReviewing] = useState(false);
  const [sending, setSending] = useState(false);

  const [subtitle, setSubtitle] = useState(COACHING);
  const [note, setNote] = useState<string | null>(null);

  const arm = (on: boolean) => {
    armedRef.current = on;
    setArmed(on);
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => armedRef.current,
        onMoveShouldSetPanResponder: () => armedRef.current,
        onPanResponderGrant: (e) => {
          if (!armedRef.current) return;
          cur.current = [{ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY + scrollYRef.current }];
          tick((n) => n + 1);
        },
        onPanResponderMove: (e) => {
          if (!armedRef.current) return;
          cur.current.push({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY + scrollYRef.current });
          tick((n) => n + 1);
        },
        onPanResponderRelease: () => {
          if (armedRef.current && cur.current.length > 1) setDraftStrokes((s) => [...s, cur.current]);
          cur.current = [];
          arm(false); // one-shot: disarm after the circle so the user can scroll/browse
          tick((n) => n + 1);
        },
      }),
    [],
  );

  const onWebMessage = (e: WebViewMessageEvent) => {
    try {
      const d = JSON.parse(e.nativeEvent.data) as Hit & { __nanoScroll?: boolean; y?: number };
      if (d?.__nanoScroll === true && typeof d.y === 'number') {
        scrollYRef.current = d.y;
        setScrollY(d.y);
        return;
      }
      if (d?.__nanoHit === true && typeof d.i === 'number') {
        setDraftHits((h) => ({ ...h, [d.i as number]: describeHit(d) }));
      }
    } catch {
      /* not one of ours */
    }
  };

  // Resolve each newly-drawn circle to the page section under its centre (best-effort).
  useEffect(() => {
    if (!critique || !draftStrokes.length) return;
    const i = draftStrokes.length - 1;
    if (i in draftHits) return;
    const s = draftStrokes[i];
    const xs = s.map((p) => p.x);
    const ys = s.map((p) => p.y);
    const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
    const cyDoc = (Math.min(...ys) + Math.max(...ys)) / 2;
    const vy = Math.round(cyDoc - scrollYRef.current); // back to viewport coords for elementFromPoint
    ref.current?.injectJavaScript(hitScript(i, cx, vy));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftStrokes.length]);

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
      setSubtitle('Listening… tell me the change, then tap me to stop.');
    } catch {
      setNote('Could not start recording.');
    }
  };

  const transcribe = async (): Promise<string> => {
    try {
      const uri = recorder.uri;
      if (!uri || !critique) return '';
      const audio = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const r = await fetch(apiUrl('/api/transcribe'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${critique.token}` },
        body: JSON.stringify({ audio }),
      });
      return ((await r.json()) as { text?: string }).text?.trim() ?? '';
    } catch {
      return '';
    }
  };

  // Close the current turn into one itemised edit (note = what was said / typed).
  const commitEdit = (note: string) => {
    const text = note.trim();
    if (!text && !draftStrokes.length) {
      setNote('Talk or circle something first.');
      setSubtitle(COACHING);
      return;
    }
    const regions = draftStrokes.map((s, i) => draftHits[i] || regionLabel(s, size.w, size.h));
    const item: EditItem = { id: String(editSeq.current++), note: text || '(no description)', regions, strokes: draftStrokes };
    setEdits((e) => [...e, item]);
    setDraftStrokes([]);
    setDraftHits({});
    setSubtitle('Got it — added. Circle your next change, or tap Submit when you’re done.');
  };

  const toggleTalk = async () => {
    if (recording) {
      setRecording(false);
      try {
        await recorder.stop();
      } catch {
        /* ignore */
      }
      setSubtitle('One sec — writing that down…');
      const said = await transcribe();
      commitEdit(said);
    } else {
      void startRec();
    }
  };

  const addTyped = () => {
    commitEdit(draftText);
    setDraftText('');
    setTyping(false);
  };

  const removeEdit = (id: string) => setEdits((e) => e.filter((x) => x.id !== id));

  const submit = async () => {
    if (!critique || !edits.length) return;
    setSending(true);
    setNote(null);
    const body = edits
      .map((e, i) => `${i + 1}. ${e.note}${e.regions.length ? `\n   (circled: ${e.regions.join('; ')})` : ''}`)
      .join('\n\n');
    const md = `The creator requested these changes to their live storefront, in their own words:\n\n${body}\n\n(About the page: ${url})`;
    try {
      const res = await fetch(apiUrl('/api/creator/revise'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${critique.token}` },
        body: JSON.stringify({ storeSlug: critique.slug, requestMd: md, screenshots: [] }),
      });
      if (!res.ok) throw new Error();
      setEdits([]);
      setReviewing(false);
      critique.onSent?.();
      onClose();
    } catch {
      setNote('Could not send your changes. Try again.');
    } finally {
      setSending(false);
    }
  };

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  const toScreenPath = (s: Pt[]) => s.map((p) => `${Math.round(p.x)},${Math.round(p.y - scrollY)}`).join(' ');

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
      <View style={[styles.fill, { paddingTop: Math.max(insets.top, 12) }]}>
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
            onMessage={onWebMessage}
            injectedJavaScript={SCROLL_SCRIPT}
            style={styles.web}
            pointerEvents={armed ? 'none' : 'auto'}
          />
          {/* Drawing layer — captures touches only while the pen is armed */}
          <View style={StyleSheet.absoluteFill} pointerEvents={armed ? 'auto' : 'none'} {...pan.panHandlers}>
            <Svg style={StyleSheet.absoluteFill}>
              {edits.flatMap((ed) =>
                ed.strokes.map((s, i) => (
                  <Polyline key={`${ed.id}-${i}`} points={toScreenPath(s)} fill="none" stroke={GOLD} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" opacity={0.32} />
                )),
              )}
              {draftStrokes.map((s, i) => (
                <Polyline key={`d${i}`} points={toScreenPath(s)} fill="none" stroke={GOLD} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.95} />
              ))}
              {cur.current.length > 1 ? (
                <Polyline points={toScreenPath(cur.current)} fill="none" stroke={GOLD} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
              ) : null}
            </Svg>
          </View>
          {loading ? (
            <View style={styles.loadingOverlay} pointerEvents="none">
              <ActivityIndicator color={GOLD} />
            </View>
          ) : null}
        </View>

        {/* Venus panel — the orb is the focus; subtitles below; a faint control hint */}
        {critique ? (
          <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            {edits.length ? (
              <Pressable style={styles.submitBar} onPress={() => setReviewing(true)}>
                <ThemedText type="code" style={styles.submitCount}>{edits.length} change{edits.length > 1 ? 's' : ''} captured</ThemedText>
                <ThemedText type="smallBold" style={styles.submitCta}>Submit →</ThemedText>
              </Pressable>
            ) : null}

            {note ? <ThemedText type="code" style={styles.noteText}>{note}</ThemedText> : null}

            {typing ? (
              <View style={styles.typeRow}>
                <TextInput
                  style={styles.typeInput}
                  placeholder="Describe the change…"
                  placeholderTextColor={DIM}
                  value={draftText}
                  onChangeText={setDraftText}
                  autoFocus
                  multiline
                />
                <Pressable onPress={addTyped} disabled={!draftText.trim()} style={[styles.addBtn, !draftText.trim() && { opacity: 0.4 }]}>
                  <ThemedText type="smallBold" style={{ color: BG }}>Add</ThemedText>
                </Pressable>
                <Pressable onPress={() => { setTyping(false); setDraftText(''); }} hitSlop={8}>
                  <ThemedText type="code" style={styles.dim}>cancel</ThemedText>
                </Pressable>
              </View>
            ) : (
              <>
                <View style={styles.controlsRow}>
                  <Pressable onPress={() => arm(!armed)} hitSlop={12} style={[styles.sideBtn, armed && styles.sideBtnOn]}>
                    <Svg width={22} height={22}>
                      <Path d="M4 18 L14 8 L16 10 L6 20 Z" fill="none" stroke={armed ? BG : GOLD} strokeWidth={1.7} strokeLinejoin="round" />
                      <Line x1={14} y1={8} x2={17} y2={5} stroke={armed ? BG : GOLD} strokeWidth={1.7} strokeLinecap="round" />
                    </Svg>
                  </Pressable>
                  <VenusOrb active={recording} level={level} size={86} onPress={toggleTalk} />
                  <Pressable onPress={() => setTyping(true)} hitSlop={12} style={styles.sideBtn}>
                    <Svg width={22} height={22}>
                      <Path d="M3 6 H19 a1 1 0 0 1 1 1 V15 a1 1 0 0 1 -1 1 H3 a1 1 0 0 1 -1 -1 V7 a1 1 0 0 1 1 -1 Z" fill="none" stroke={GOLD} strokeWidth={1.4} strokeLinejoin="round" />
                      <Line x1={6} y1={9} x2={6} y2={9.5} stroke={GOLD} strokeWidth={1.6} strokeLinecap="round" />
                      <Line x1={9} y1={9} x2={9} y2={9.5} stroke={GOLD} strokeWidth={1.6} strokeLinecap="round" />
                      <Line x1={12} y1={9} x2={12} y2={9.5} stroke={GOLD} strokeWidth={1.6} strokeLinecap="round" />
                      <Line x1={15} y1={9} x2={15} y2={9.5} stroke={GOLD} strokeWidth={1.6} strokeLinecap="round" />
                      <Line x1={7} y1={12.5} x2={15} y2={12.5} stroke={GOLD} strokeWidth={1.6} strokeLinecap="round" />
                    </Svg>
                  </Pressable>
                </View>
                <ThemedText type="small" style={styles.subtitle} numberOfLines={3}>
                  {recording ? `Listening… ${Math.round((recState.durationMillis ?? 0) / 1000)}s` : subtitle}
                </ThemedText>
                <ThemedText type="code" style={styles.hint} numberOfLines={1}>
                  {armed ? 'circle the area, then talk' : 'tap ✎ to circle · orb to talk · ⌨ to type'}
                </ThemedText>
              </>
            )}
          </View>
        ) : null}
      </View>

      {/* Review & submit */}
      {reviewing ? (
        <View style={styles.reviewWrap}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setReviewing(false)} />
          <View style={[styles.reviewCard, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.reviewHead}>
              <ThemedText type="subtitle" style={styles.white}>Send to Venus</ThemedText>
              <Pressable onPress={() => setReviewing(false)} hitSlop={12}>
                <ThemedText type="code" style={styles.dim}>close ✕</ThemedText>
              </Pressable>
            </View>
            <ThemedText type="code" style={styles.dim}>Review your changes — remove any you don’t want, then send them to be built.</ThemedText>
            <ScrollView style={styles.reviewList} contentContainerStyle={{ gap: Spacing.two }}>
              {edits.map((e, i) => (
                <View key={e.id} style={styles.reviewItem}>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="small" style={styles.white}>{i + 1}. {e.note}</ThemedText>
                    {e.regions.length ? <ThemedText type="code" style={styles.reviewRegion}>circled: {e.regions.join('; ')}</ThemedText> : null}
                  </View>
                  <Pressable onPress={() => removeEdit(e.id)} hitSlop={10} style={styles.removeBtn}>
                    <ThemedText type="code" style={styles.warn}>remove</ThemedText>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
            {note ? <ThemedText type="code" style={styles.noteText}>{note}</ThemedText> : null}
            <Pressable onPress={submit} disabled={sending || !edits.length} style={[styles.sendBtn, (sending || !edits.length) && { opacity: 0.5 }]}>
              <ThemedText type="smallBold" style={{ color: BG }}>
                {sending ? 'Sending…' : `Send ${edits.length} change${edits.length > 1 ? 's' : ''} →`}
              </ThemedText>
            </Pressable>
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: BG },
  bar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  urlPill: { flex: 1, backgroundColor: 'rgba(201,168,106,0.07)', borderWidth: 1, borderColor: 'rgba(201,168,106,0.2)', borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 6 },
  urlText: { color: DIM, fontSize: 12 },
  webWrap: { flex: 1, backgroundColor: '#fff' },
  web: { flex: 1 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },

  panel: { backgroundColor: BG, borderTopWidth: 1, borderTopColor: 'rgba(201,168,106,0.2)', paddingHorizontal: Spacing.four, paddingTop: Spacing.three, gap: Spacing.two, alignItems: 'center' },
  submitBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', backgroundColor: 'rgba(201,168,106,0.1)', borderWidth: 1, borderColor: 'rgba(201,168,106,0.3)', borderRadius: 999, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
  submitCount: { color: DIM },
  submitCta: { color: GOLD },
  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.six },
  sideBtn: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(201,168,106,0.3)' },
  sideBtnOn: { backgroundColor: GOLD, borderColor: GOLD },
  subtitle: { color: INK, textAlign: 'center', minHeight: 18 },
  hint: { color: FAINT, fontSize: 11, textAlign: 'center' },
  noteText: { color: '#e0a07a', fontSize: 12, textAlign: 'center' },

  typeRow: { flexDirection: 'row', alignItems: 'flex-end', alignSelf: 'stretch', gap: Spacing.two },
  typeInput: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderColor: 'rgba(201,168,106,0.3)', borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, color: INK, fontSize: 15, textAlignVertical: 'top' },
  addBtn: { backgroundColor: GOLD, borderRadius: 999, paddingHorizontal: Spacing.four, paddingVertical: Spacing.three },

  reviewWrap: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  reviewCard: { backgroundColor: BG, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: 'rgba(201,168,106,0.25)', padding: Spacing.four, gap: Spacing.three },
  reviewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reviewList: { maxHeight: 280 },
  reviewItem: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three, paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(243,241,236,0.1)' },
  reviewRegion: { color: DIM, fontSize: 11, marginTop: 2 },
  removeBtn: { paddingVertical: Spacing.one },
  sendBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: Spacing.three, alignItems: 'center' },

  white: { color: INK },
  dim: { color: DIM },
  warn: { color: '#e0a07a' },
});
