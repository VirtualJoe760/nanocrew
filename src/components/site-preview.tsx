import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, type LayoutChangeEvent, Linking, Modal, NativeModules, PanResponder, Platform, Pressable, ScrollView, StyleSheet, TextInput, TurboModuleRegistry, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line, Path, Polyline } from 'react-native-svg';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { VenusOrb } from '@/components/venus-orb';
import { WebFrame } from '@/components/web-frame';
import { Spacing } from '@/constants/theme';
import { useLiveVoice } from '@/hooks/use-live-voice';
import { apiUrl } from '@/lib/api';
import { CRITIQUE_GREETING, critiqueInstruction } from '@/lib/live-voice';

const IS_WEB = Platform.OS === 'web';

// react-native-view-shot is a NATIVE module. `require`-ing it runs the lib's internal
// TurboModuleRegistry.getEnforcing('RNViewShot') at module-eval time, which on a binary WITHOUT the
// module doesn't just throw — in dev it red-boxes regardless of any surrounding try/catch. So we
// must never even `require` it unless the native module is actually registered. Pre-check with the
// NON-throwing TurboModuleRegistry.get (and the classic NativeModules fallback); if absent, capture
// stays null and we fall back to the forge's server-side stroke re-render. Lights up automatically
// on a build that bundles the module.
type CaptureRef = (ref: unknown, opts: { format?: string; quality?: number; result?: string }) => Promise<string>;
let _captureRef: CaptureRef | null | undefined;
function getCaptureRef(): CaptureRef | null {
  if (_captureRef !== undefined) return _captureRef;
  _captureRef = null;
  try {
    const registered = (TurboModuleRegistry.get && TurboModuleRegistry.get('RNViewShot')) || NativeModules?.RNViewShot;
    if (registered) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      _captureRef = require('react-native-view-shot').captureRef as CaptureRef;
    }
  } catch {
    _captureRef = null; // belt-and-suspenders
  }
  return _captureRef;
}

// A live, navigable view of the creator's storefront — the in-app "iframe". In critique mode
// it becomes a turn-based editor driven by Venus: tap the orb to talk, tap the pen to circle a
// spot (one circle per tap, marks stay anchored to the page as you scroll), describe the change,
// tap the orb to finish. Each turn becomes one itemised edit; Submit ships the batch (markdown +
// circled regions) to Claude on the VPS, who applies it on a branch (preview → approve → main).

const BG = '#08080a';
const GOLD = '#cdd1d9';
const INK = '#f4f4f6';
const DIM = 'rgba(243,241,236,0.6)';
const FAINT = 'rgba(243,241,236,0.28)';

const COACHING = 'Circle anything you want to change and just say the adjustment — I’ll note each one. Tap me to pause. Submit when you’re done.';
const CRITIQUE_INSTRUCTION = critiqueInstruction();

type Pt = { x: number; y: number };
type Critique = { slug: string; token: string; onSent?: () => void };
type EditItem = { id: string; note: string; regions: string[]; strokes: Pt[][]; url: string; width: number; shots?: string[] };

function host(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

// In continuous capture, skip obvious conversational closers so "no, that's it" doesn't become an
// edit. (Anything missed is still removable in the review list.)
function isCloser(raw: string): boolean {
  let t = raw.trim().toLowerCase().replace(/[.!?,]+/g, ' ').replace(/'/g, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(no|nope|nah|ok|okay|yeah|yep|cool|um|uh)\s+/, '');
  if (!t || /^(no|nope|nah|ok|okay|yeah|yep)$/.test(t)) return true;
  return /^(that(s| is)?\s*)?(it|all|everything)$|^(im good|all good|were good|all set|good to go|done|submit|finished|nothing( else)?|stop|thats it|thats all|thats everything)$/.test(t);
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

type Hit = { __nanoHit?: boolean; i?: number; block?: string; tag?: string; btnTag?: string; btnText?: string; heading?: string; text?: string; img?: boolean; nanoImage?: string; imgSrc?: string };

// Injected on every load: report the page's scroll position so native marks can stay anchored
// to the content as it scrolls (rAF-throttled).
const SCROLL_SCRIPT = `(function(){if(window.__nanoScrollWired)return;window.__nanoScrollWired=true;
function P(){window.ReactNativeWebView.postMessage(JSON.stringify({__nanoScroll:true,y:window.scrollY||window.pageYOffset||0}));}
var t=false;window.addEventListener('scroll',function(){if(t)return;t=true;requestAnimationFrame(function(){t=false;P();});},{passive:true});P();})();true;`;

/** A WebView hit-test: resolve a circled point to what it lands on — the most SPECIFIC thing first
 *  (a button/link + its label), then the block/section, nearest heading, or nearby text — so Venus
 *  can tell Claude WHAT was circled ("the 'Shop the drop' button"), not just where. */
function hitScript(i: number, x: number, y: number): string {
  return `(function(){function P(o){o.__nanoHit=true;o.i=${i};window.ReactNativeWebView.postMessage(JSON.stringify(o));}
try{var el=document.elementFromPoint(${x},${y});if(!el){P({});return;}
var n=el,blk=null,sec=null,btn=null,img=null;
while(n&&n!==document.body){
  if(!btn){var tg=(n.tagName||'').toLowerCase();var role=n.getAttribute&&n.getAttribute('role');
    if(tg==='button'||tg==='a'||role==='button'||(tg==='input'&&['submit','button'].indexOf(n.getAttribute('type')||'')>=0))btn=n;}
  if(!img){var tgi=(n.tagName||'').toLowerCase();var bg='';try{bg=n.nodeType===1?getComputedStyle(n).backgroundImage:'';}catch(e2){}
    if(tgi==='img'||tgi==='picture'||(bg&&bg!=='none'&&bg.indexOf('url(')>=0))img=n;}
  if(n.getAttribute&&n.getAttribute('data-block')){blk=n;break;}
  var t=(n.tagName||'').toLowerCase();if(!sec&&['section','header','footer','nav','main','article','form'].indexOf(t)>=0)sec=n;
  n=n.parentElement;}
var nano='',isrc='';
if(img){var ix=img;while(ix&&ix!==document.body){if(ix.getAttribute&&ix.getAttribute('data-nano-image')){nano=ix.getAttribute('data-nano-image');break;}ix=ix.parentElement;}
  isrc=img.currentSrc||img.src||'';
  if(!isrc){try{var bg2=getComputedStyle(img).backgroundImage;var m=bg2&&bg2.match(/url\\(["']?([^"')]+)/);if(m)isrc=m[1];}catch(e3){}}}
var ctx=blk||sec||el;var h=ctx.querySelector?ctx.querySelector('h1,h2,h3'):null;
P({block:blk?blk.getAttribute('data-block'):'',tag:(ctx.tagName||'').toLowerCase(),
img:img?true:false,nanoImage:nano,imgSrc:(isrc||'').slice(0,300),
btnTag:btn?(btn.tagName||'').toLowerCase():'',btnText:btn?((btn.textContent||btn.value||'').replace(/\\s+/g,' ').trim().slice(0,40)):'',
heading:h?(h.textContent||'').replace(/\\s+/g,' ').trim().slice(0,80):'',
text:(el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,60)});
}catch(e){P({});}})();true;`;
}

/** Turn a resolved hit into a phrase for the brief. Most specific (a circled button/link) wins.
 *  null → fall back to a positional label. */
function describeHit(d: Hit): string | null {
  const kind = (t?: string) => (t === 'a' ? 'link' : 'button');
  // An actual image is the most specific target for image edits — name it from its identity.
  if (d.img && !d.btnText) {
    const ni = d.nanoImage || '';
    if (ni === 'hero') return 'the hero (main background) image';
    if (ni === 'logo') return 'the logo';
    if (ni === 'og') return 'the social share image';
    if (ni.startsWith('section:')) return `the ${ni.slice(8).replace(/[-_]/g, ' ')} section image`;
    if (ni.startsWith('product:')) return 'a product photo';
    return 'the image they circled';
  }
  if (d.btnText) return `the "${d.btnText}" ${kind(d.btnTag)}`;
  if (d.btnTag) return `a ${kind(d.btnTag)}`;
  if (d.block) return `the "${d.block}" section${d.heading ? ` ("${d.heading}")` : ''}`;
  if (d.heading) return `the ${d.tag || 'section'} headed "${d.heading}"`;
  if (d.text) return `the ${d.tag || 'area'} near the text "${d.text}"`;
  return null;
}

// Review mode: a read-only preview of a pending change with two choices — keep editing (which loads
// the Venus editor) or approve. NO Venus until the creator opts in via "Continue editing".
type Review = { onContinueEditing: () => void; onApprove: () => void; approving?: boolean };

export function SitePreview({
  visible,
  url,
  onClose,
  critique,
  review,
}: {
  visible: boolean;
  url: string;
  onClose: () => void;
  critique?: Critique;
  review?: Review;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaProvider>
        <PreviewContent url={url} onClose={onClose} critique={critique} review={review} />
      </SafeAreaProvider>
    </Modal>
  );
}

function PreviewContent({ url, onClose, critique, review }: { url: string; onClose: () => void; critique?: Critique; review?: Review }) {
  const insets = useSafeAreaInsets();
  const ref = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0); // web: remount the iframe to reload
  const [canGoBack, setCanGoBack] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(url); // the page each edit is drawn on (may navigate)

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
  // A real screenshot (page + the drawn mark) captured the instant each mark lands — this is the
  // "proof" fed to Claude on the backend, who reads a marked-up screenshot far more reliably than
  // coordinates. Best-effort: capture failures fall back to the forge's server-side stroke render.
  const [draftShots, setDraftShots] = useState<string[]>([]);
  const shotRef = useRef<View>(null);
  const cur = useRef<Pt[]>([]);
  const [, tick] = useState(0);

  // Talk + Venus's voice — continuous Gemini Live (no more record→transcribe→TTS). The session
  // listens the whole time this view is open; whatever the creator says becomes an edit (below),
  // and Venus converses in real time. Tap the orb to pause/resume listening.
  const [paused, setPaused] = useState(false);
  const venus = useLiveVoice({
    accessToken: critique?.token,
    instruction: CRITIQUE_INSTRUCTION,
    greeting: CRITIQUE_GREETING,
    enableBrandTool: false,
    onBrand: () => {},
  });
  const speaking = venus.state === 'speaking';
  const recording = venus.state === 'listening' && !paused; // orb "active" while she's hearing you

  // No raw audio meter on the Live path — drive a gentle state-based pulse for the orb.
  const level = useSharedValue(0);
  useEffect(() => {
    if (venus.state === 'speaking' || venus.state === 'listening') {
      level.value = withRepeat(withSequence(withTiming(0.6, { duration: 460 }), withTiming(0.18, { duration: 460 })), -1, true);
    } else {
      level.value = withTiming(0, { duration: 400 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venus.state]);

  // Run the session while the critique view is open (native only — mic needs the dev build).
  // Depend on the STABLE slug/token, NOT the `critique` object — the parent rebuilds that object every
  // render, which would otherwise stop+start the session (and re-trigger her greeting) on every
  // re-render, stacking voices. Now it starts once and stops on unmount.
  useEffect(() => {
    if (!critique || IS_WEB) return;
    venus.start();
    return () => venus.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [critique?.slug, critique?.token]);
  // Tap-to-pause mutes the mic + her voice; re-applied on state changes so it sticks on reconnect.
  useEffect(() => { venus.mute(paused); }, [paused, venus.state, venus.mute]);

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
        // Claim the gesture at the CAPTURE phase so the WebView/iframe underneath never gets it.
        onStartShouldSetPanResponder: () => armedRef.current,
        onStartShouldSetPanResponderCapture: () => armedRef.current,
        onMoveShouldSetPanResponder: () => armedRef.current,
        onMoveShouldSetPanResponderCapture: () => armedRef.current,
        // CRITICAL: never yield mid-draw. Without these the web layer's scroll responder steals the
        // gesture after the first touch, so the stroke never accumulates points (the "won't draw" bug).
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: (e) => {
          if (!armedRef.current) return;
          cur.current = [{ x: e.nativeEvent.locationX ?? 0, y: (e.nativeEvent.locationY ?? 0) + scrollYRef.current }];
          tick((n) => n + 1);
        },
        onPanResponderMove: (e) => {
          if (!armedRef.current) return;
          cur.current.push({ x: e.nativeEvent.locationX ?? 0, y: (e.nativeEvent.locationY ?? 0) + scrollYRef.current });
          tick((n) => n + 1);
        },
        onPanResponderRelease: () => {
          // One-shot: after a real circle, DISARM the pen so you can scroll/navigate the site again.
          // (A fumbled tap — too few points — leaves the pen armed so it isn't silently lost.)
          if (cur.current.length > 1) {
            setDraftStrokes((s) => [...s, cur.current]);
            arm(false);
          }
          cur.current = [];
          tick((n) => n + 1);
        },
        onPanResponderTerminate: () => {
          if (cur.current.length > 1) {
            setDraftStrokes((s) => [...s, cur.current]);
            arm(false);
          }
          cur.current = [];
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
    // Capture the page + this fresh mark while it's on screen — the proof we send to Claude. Lazily
    // resolved; null on a binary without the native module → we just skip (forge re-renders strokes).
    const capture = IS_WEB ? null : getCaptureRef();
    if (capture) {
      capture(shotRef, { format: 'jpg', quality: 0.6, result: 'data-uri' })
        .then((uri) => setDraftShots((prev) => { const next = prev.slice(); next[i] = uri; return next; }))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftStrokes.length]);

  // Surface Venus's connection errors as the on-screen note.
  useEffect(() => { if (venus.error) setNote(venus.error); }, [venus.error]);

  // Close one itemised edit (note = what was said / typed) anchored to the circled regions.
  const commitEdit = (note: string) => {
    const text = note.trim();
    if (!text && !draftStrokes.length) {
      setNote('Circle something or say a change first.');
      return;
    }
    const regions = draftStrokes.map((s, i) => draftHits[i] || regionLabel(s, size.w, size.h));
    const item: EditItem = { id: String(editSeq.current++), note: text || '(no description)', regions, strokes: draftStrokes, url: currentUrl, width: size.w || 390, shots: draftShots.filter(Boolean) };
    setEdits((e) => [...e, item]);
    setDraftStrokes([]);
    setDraftHits({});
    setDraftShots([]);
  };
  const commitRef = useRef(commitEdit);
  commitRef.current = commitEdit;

  // Continuous capture: each substantive thing the creator SAYS becomes an edit (anchored to whatever
  // they've circled). We skip obvious closers ("no, that's it") and they can remove any in review.
  const committedUsers = useRef(0);
  useEffect(() => {
    const said = venus.messages.filter((m) => m.role === 'user');
    if (said.length < committedUsers.current) committedUsers.current = said.length; // session reset
    for (let i = committedUsers.current; i < said.length; i++) {
      const t = said[i].text.trim();
      if (t && !isCloser(t)) commitRef.current(t);
    }
    committedUsers.current = said.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venus.messages]);

  const addTyped = () => {
    commitEdit(draftText);
    setDraftText('');
    setTyping(false);
  };

  // Orb tap: type on web (no mic); otherwise pause/resume the live conversation.
  const toggleTalk = () => {
    if (IS_WEB) {
      setTyping(true);
      setNote('Voice editing is in the app — here, tap ⌨ to type your change.');
      return;
    }
    setPaused((p) => !p);
  };

  const removeEdit = (id: string) => setEdits((e) => e.filter((x) => x.id !== id));

  // Undo the last circle drawn in the current (un-committed) turn — for stray/accidental marks.
  const undoStroke = () => {
    setDraftStrokes((s) => s.slice(0, -1));
    setDraftShots((s) => s.slice(0, -1));
    setDraftHits((h) => {
      const keys = Object.keys(h).map(Number);
      if (!keys.length) return h;
      const n = { ...h };
      delete n[Math.max(...keys)];
      return n;
    });
    tick((n) => n + 1);
  };

  const submit = async () => {
    if (!critique || !edits.length) return;
    setSending(true);
    setNote(null);
    // Snapshot the edits up front — the async pipeline below (plan → generate → revise) takes a while
    // and the user can remove edits mid-flight; using the live array would desync the request.
    const snap = edits;
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${critique.token}` };
    const annotations = snap.filter((e) => e.strokes.length).map((e) => ({ url: e.url, width: e.width, strokes: e.strokes, shots: e.shots ?? [] }));
    const rawMd = () => {
      const body = snap.map((e, i) => `${i + 1}. ${e.note}${e.regions.length ? `\n   (circled: ${e.regions.join('; ')})` : ''}`).join('\n\n');
      return `The creator requested these changes to their live storefront, in their own words:\n\n${body}\n\n(About the page: ${url})`;
    };
    try {
      // 1. Distill the conversation into image-generations (hero/logo/og), forge edits (imperative
      //    strings), and `assets` — NEW images a structural edit (carousel/gallery/"add images")
      //    needs the app to generate and hand to the forge as URLs.
      let images: { slot: 'hero' | 'logo' | 'og'; prompt: string }[] = [];
      let editTexts: string[] = [];
      let assets: string[] = [];
      let planned = false;
      try {
        const msgs = venus.messages.length ? venus.messages : snap.map((e) => ({ role: 'user' as const, text: e.note }));
        const pr = await fetch(apiUrl('/api/creator/plan-site-edits'), { method: 'POST', headers: auth, body: JSON.stringify({ messages: msgs }) });
        if (pr.ok) {
          const pd = (await pr.json()) as { images?: typeof images; edits?: string[]; assets?: string[] };
          images = pd.images ?? [];
          editTexts = pd.edits ?? [];
          assets = pd.assets ?? [];
          planned = true;
        }
      } catch {
        /* planning unavailable → fall back to forging the raw notes below */
      }

      // 2. Generate + place each new image straight onto the site (no forge — that can't make images).
      //    Record the per-image OUTCOME so a silent failure (generate/place) is debuggable, not lost.
      type ImageOutcome = { slot: string; prompt: string; generated: boolean; placed: boolean; error: string | null };
      const imageOutcomes: ImageOutcome[] = [];
      for (const img of images) {
        setNote(`Generating the ${img.slot} image…`);
        const outcome: ImageOutcome = { slot: img.slot, prompt: img.prompt, generated: false, placed: false, error: null };
        try {
          const gr = await fetch(apiUrl('/api/generate'), { method: 'POST', headers: auth, body: JSON.stringify({ prompt: img.prompt, background: 'filled', aspectRatio: img.slot === 'logo' ? '1:1' : '16:9', purpose: img.slot === 'logo' ? 'logo' : 'design' }) });
          const gd = (await gr.json().catch(() => ({}))) as { image?: string; error?: string };
          if (!gr.ok || !gd.image) {
            outcome.error = gd.error || `generate failed (${gr.status})`;
          } else {
            outcome.generated = true;
            const sr = await fetch(apiUrl('/api/creator/site-assets'), { method: 'POST', headers: auth, body: JSON.stringify({ storeSlug: critique.slug, slot: img.slot, url: gd.image }) });
            if (sr.ok) outcome.placed = true;
            else outcome.error = `placement failed (${sr.status})`;
          }
        } catch (e) {
          outcome.error = e instanceof Error ? e.message : 'network error';
        }
        imageOutcomes.push(outcome);
      }

      // 2b. Generate the NEW images a STRUCTURAL edit needs (carousel/gallery/"add images") and hand
      //     the URLs to the forge — the forge can't make images, so the app generates (metered) and
      //     the forge builds the structure with them. Partial failures are noted, not blocking.
      const forgeAssetUrls: string[] = [];
      for (const prompt of assets) {
        setNote('Generating images for your change…');
        try {
          const gr = await fetch(apiUrl('/api/generate'), { method: 'POST', headers: auth, body: JSON.stringify({ prompt, background: 'filled', aspectRatio: '16:9', purpose: 'design' }) });
          const gd = (await gr.json().catch(() => ({}))) as { image?: string };
          if (gr.ok && gd.image) forgeAssetUrls.push(gd.image);
        } catch {
          /* skip a failed asset — the forge proceeds with whatever generated */
        }
      }

      // 3. The forge edits, with any generated image URLs appended for structural changes. If planning
      //    failed entirely, forge the raw notes.
      const md = editTexts.length
        ? `The creator requested these changes to their live storefront:\n\n${editTexts.map((t, i) => `${i + 1}. ${t}`).join('\n')}${
            forgeAssetUrls.length ? `\n\nUse these generated images (already hosted) where the changes call for new pictures: ${forgeAssetUrls.join(', ')}` : ''
          }\n\n(About the page: ${url})`
        : images.length
          ? ''
          : rawMd();

      // 4. Record ONE durable row for the whole submit — full transcript + structured per-request
      //    outcomes — so an edit is debuggable end to end. See docs/studio/EDIT_PIPELINE.md.
      const transcript = venus.messages.map((m) => ({ role: m.role, text: m.text }));
      const editPlan = {
        images: imageOutcomes,
        // When planning failed we still forged the raw notes; surface that as the edit list.
        edits: editTexts.length ? editTexts : md && !planned ? snap.map((e) => e.note) : [],
      };
      setNote('Saving your changes…');
      const res = await fetch(apiUrl('/api/creator/revise'), {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ storeSlug: critique.slug, requestMd: md, transcript, editPlan, annotations }),
      });
      if (!res.ok) throw new Error();

      // Tell the creator honestly if an image part failed (it used to fail silently).
      const failedImg = imageOutcomes.filter((o) => !o.placed);
      if (failedImg.length) {
        setNote(`Couldn't apply the ${failedImg.map((o) => o.slot).join(', ')} image — try rewording what you want it to look like.`);
        setSending(false);
        return; // keep the editor open so they can retry the image
      }

      setEdits([]);
      setReviewing(false);
      critique.onSent?.();
      onClose();
    } catch {
      setReviewing(false); // dismiss the review panel so the creator can edit/retry, not get stuck
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
          <Pressable onPress={() => { if (IS_WEB) { setLoading(true); setReloadKey((k) => k + 1); } else ref.current?.reload(); }} hitSlop={12} style={styles.iconBtn}>
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

        <View ref={shotRef} collapsable={false} style={styles.webWrap} onLayout={onLayout}>
          {IS_WEB ? (
            // react-native-webview has no web build → use a real <iframe> so the site actually loads.
            <WebFrame url={url} reloadKey={reloadKey} onLoad={() => setLoading(false)} blocked={armed} />
          ) : (
            <WebView
              ref={ref}
              source={{ uri: url }}
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
              onNavigationStateChange={(s) => { setCanGoBack(s.canGoBack); if (s.url) setCurrentUrl(s.url); }}
              onMessage={onWebMessage}
              injectedJavaScript={SCROLL_SCRIPT}
              style={styles.web}
              pointerEvents={armed ? 'none' : 'auto'}
            />
          )}
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

        {/* Review mode — read-only preview + two choices. NO Venus here; she only wakes on "Continue
            editing", which swaps this for the critique panel below. */}
        {review && !critique ? (
          <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <ThemedText type="code" style={styles.hint}>Reviewing your change — approve it, or keep editing.</ThemedText>
            <View style={styles.reviewRow}>
              <Pressable onPress={review.onContinueEditing} style={styles.reviewSecondary}>
                <ThemedText type="smallBold" style={styles.reviewSecondaryText}>Continue editing</ThemedText>
              </Pressable>
              <Pressable onPress={review.onApprove} disabled={review.approving} style={[styles.reviewPrimary, review.approving && { opacity: 0.6 }]}>
                <ThemedText type="smallBold" style={styles.reviewPrimaryText}>{review.approving ? 'Approving…' : 'Approve edits'}</ThemedText>
              </Pressable>
            </View>
          </View>
        ) : null}

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
                {draftStrokes.length ? (
                  <Pressable onPress={undoStroke} hitSlop={8} style={styles.undoBtn}>
                    <ThemedText type="code" style={styles.undoText}>↶  undo last circle</ThemedText>
                  </Pressable>
                ) : null}
                <View style={styles.controlsRow}>
                  <Pressable onPress={() => arm(!armed)} hitSlop={12} style={[styles.sideBtn, armed && styles.sideBtnOn]}>
                    <Svg width={22} height={22}>
                      {/* draw a squiggly line — what marking the page actually feels like */}
                      <Path d="M3 13 Q 6 7 9 13 T 15 13 T 21 13" fill="none" stroke={armed ? BG : GOLD} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  </Pressable>
                  <VenusOrb active={recording || speaking} level={level} size={86} onPress={toggleTalk} />
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
                  {paused ? 'Paused — tap the orb to resume' : venus.venusText || (venus.userText ? `you: ${venus.userText}` : subtitle)}
                </ThemedText>
                <ThemedText type="code" style={styles.hint} numberOfLines={1}>
                  {armed ? 'mark any spot (circle or arrow), then tap 〰 to finish' : 'tap 〰 to mark · just speak · orb to pause · ⌨ to type'}
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
  urlPill: { flex: 1, backgroundColor: 'rgba(205,209,217,0.07)', borderWidth: 1, borderColor: 'rgba(205,209,217,0.2)', borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 6 },
  urlText: { color: DIM, fontSize: 12 },
  webWrap: { flex: 1, backgroundColor: '#fff' },
  web: { flex: 1 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },

  panel: { backgroundColor: BG, borderTopWidth: 1, borderTopColor: 'rgba(205,209,217,0.2)', paddingHorizontal: Spacing.four, paddingTop: Spacing.three, gap: Spacing.two, alignItems: 'center' },
  submitBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', backgroundColor: 'rgba(205,209,217,0.1)', borderWidth: 1, borderColor: 'rgba(205,209,217,0.3)', borderRadius: 999, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
  submitCount: { color: DIM },
  submitCta: { color: GOLD },
  undoBtn: { alignSelf: 'center', borderWidth: 1, borderColor: 'rgba(205,209,217,0.3)', borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 6 },
  undoText: { color: GOLD, fontSize: 12 },
  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.six },
  sideBtn: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(205,209,217,0.3)' },
  sideBtnOn: { backgroundColor: GOLD, borderColor: GOLD },
  subtitle: { color: INK, textAlign: 'center', minHeight: 18 },
  hint: { color: FAINT, fontSize: 11, textAlign: 'center' },
  noteText: { color: '#e0a07a', fontSize: 12, textAlign: 'center' },
  reviewRow: { flexDirection: 'row', alignSelf: 'stretch', gap: Spacing.three, marginTop: Spacing.one },
  reviewSecondary: { flex: 1, borderWidth: 1, borderColor: 'rgba(205,209,217,0.4)', borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center' },
  reviewSecondaryText: { color: GOLD },
  reviewPrimary: { flex: 1, backgroundColor: GOLD, borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center' },
  reviewPrimaryText: { color: '#0b0b0d' },

  typeRow: { flexDirection: 'row', alignItems: 'flex-end', alignSelf: 'stretch', gap: Spacing.two },
  typeInput: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderColor: 'rgba(205,209,217,0.3)', borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, color: INK, fontSize: 15, textAlignVertical: 'top' },
  addBtn: { backgroundColor: GOLD, borderRadius: 999, paddingHorizontal: Spacing.four, paddingVertical: Spacing.three },

  reviewWrap: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  reviewCard: { backgroundColor: BG, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: 'rgba(205,209,217,0.25)', padding: Spacing.four, gap: Spacing.three },
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
