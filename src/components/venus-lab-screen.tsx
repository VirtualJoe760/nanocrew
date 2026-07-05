import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRef, useState } from 'react';

import VenusAvatar, { type VenusStage } from '@/components/venus-avatar';
import { setVenusOrbShape, type VenusOrbShape } from '@/components/backgrounds/venus-orb-bus';
import { apiFetch, readJson } from '@/lib/api';
import { pushSpeechChunk } from '@/lib/venus-speech-level';

// THE VENUS LAB — the live venus scenes full-screen, for iterating on Venus's appearance in
// isolation. Surfaced as a TEST tool from the Account screen (gated to the Venus-Lab tester
// email); `onBack` returns to the Account page. The avatar comes from <VenusAvatar>, a COMPONENT
// split: venus-avatar.web.tsx renders the real R3F scene on web, venus-avatar.tsx on native
// (expo-gl). Full guide: docs/studio/VENUS_AVATAR.md.
//
// UI: ONE slim bottom card with tabs (stage · shape · voice) — a single panel open at a time,
// horizontal scrollers instead of chip walls, and a collapse toggle so the avatar owns the
// screen ("clean up our lab testing ui — the ui is a complete mess").
//
// VOICE AUDITION (orb mode, web): pick a Gemini voice + a TONE direction, tap ▶ — /api/say
// synthesizes it and we (a) play the WAV, (b) push its PCM into the venus-speech-level bus, so
// the orb's voice layer (the nucleus) reacts exactly as it does to the live session. Audition
// in the `talking` stage.

const STAGES: VenusStage[] = ['pre-render', 'morphing', 'silence', 'talking'];
// Orb-mode shape morphs — the dots dissolve and re-form as the object (venus-orb-bus).
const SHAPES: VenusOrbShape[] = ['orb', 'tee', 'heart', 'bolt'];
// orb = the NEURAL CONSTELLATION (the DEFAULT embodiment app-wide); face = the Cortana-era
// humanoid build (kept for comparison).
type Mode = 'orb' | 'face';
type Panel = 'stage' | 'shape' | 'voice';

// Quick lines to audition (so you can sample voices without typing each time).
const AUDITION_LINES = [
  "Hi, I'm Venus — how do I sound?",
  "Let's build your brand — what are we making today?",
  'Your store is live. Go check it out!',
];

// The FULL 30-voice Gemini catalog (matches the /api/say allowlist), female-leaning first.
// HER VOICE IS 'Kore' × the 'british robot' tone (Joe, 2026-07-05) — VENUS_VOICE in /api/say,
// LIVE_VOICE + the DELIVERY instruction in studio.tsx/live-voice.ts all match. Changing it =
// change all three. NB 'Sulafat' broke the LIVE session once — retest before making it live.
const VOICES = [
  'Kore', 'Aoede', 'Leda', 'Zephyr', 'Callirrhoe', 'Autonoe', 'Despina', 'Erinome', 'Laomedeia',
  'Vindemiatrix', 'Achernar', 'Sulafat', 'Puck', 'Charon', 'Fenrir', 'Orus', 'Enceladus',
  'Iapetus', 'Umbriel', 'Algieba', 'Algenib', 'Rasalgethi', 'Alnilam', 'Schedar', 'Gacrux',
  'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Sadachbia', 'Sadaltager',
];

// TONE direction — Gemini TTS follows natural-language style instructions prefixed to the line
// (it performs the direction, it doesn't read it aloud). Every direction specifies a FEMALE
// character; the voice chip sets the underlying timbre (the first ~11 voices are the female-
// leaning ones), the tone makes her British/robotic. For the LIVE interview, the winning tone
// gets baked into the session's system instruction instead.
const TONES: { key: string; prefix: string }[] = [
  { key: 'natural', prefix: '' },
  {
    key: 'british robot',
    prefix:
      'Speak as a refined female British AI — a crisp received-pronunciation accent with a precise, calm, subtly robotic cadence, perfectly articulated: ',
  },
  {
    key: 'FRIDAY',
    prefix:
      'Speak like a polished female British AI assistant — composed, dry wit, quietly confident, measured pacing, warm but precise: ',
  },
  {
    key: 'synthetic',
    prefix:
      'Speak like an ethereal female synthetic intelligence — calm, precise, softly resonant, faintly otherworldly: ',
  },
  {
    key: 'computer',
    prefix:
      'Speak as a female starship computer — flat, clipped, machine-precise enunciation, even pitch: ',
  },
  {
    key: 'BBC',
    prefix: 'Speak like a formal female BBC news presenter, received pronunciation: ',
  },
];

/** Decode the /api/say WAV (base64, 44-byte header, PCM16 mono 24kHz) into samples. */
function wavToPcm(b64: string): Int16Array {
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // header is 44 bytes (even) → an aligned Int16 view over the data chunk
  return new Int16Array(bytes.buffer, 44, (bytes.length - 44) >> 1);
}

export default function VenusLabScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<VenusStage>('talking');
  const [mode, setMode] = useState<Mode>('orb');
  const [shape, setShape] = useState<VenusOrbShape>('orb');
  const [panel, setPanel] = useState<Panel>('stage');
  const [collapsed, setCollapsed] = useState(false);
  const [line, setLine] = useState("Hi, I'm Venus — how do I sound?");
  const [voice, setVoice] = useState('Kore');
  const [tone, setTone] = useState('british robot');
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const voicePanelAvailable = mode === 'orb' && Platform.OS === 'web';

  // Audition: synth the line in the selected voice + TONE direction, play it, and feed the PCM
  // into the speech-level bus so the orb's voice layer (the nucleus) reacts to it.
  const speak = async (textArg?: string) => {
    const base = (textArg ?? line).trim();
    if (!base || speaking) return;
    if (textArg) setLine(textArg);
    const prefix = TONES.find((t) => t.key === tone)?.prefix ?? '';
    const text = prefix ? `${prefix}"${base}"` : base;
    setSpeaking(true);
    try {
      const synth = () =>
        apiFetch('/api/say', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice }),
        });
      let res = await synth();
      if (!res.ok) res = await synth(); // the preview TTS model flakes occasionally — one retry
      const { audio } = await readJson<{ audio?: string }>(res);
      if (!audio) return;
      if (Platform.OS === 'web') {
        const el = audioRef.current ?? new Audio();
        audioRef.current = el;
        el.src = `data:audio/wav;base64,${audio}`;
        const pcm = wavToPcm(audio);
        const durMs = (pcm.length / 24000) * 1000;
        await el.play();
        pushSpeechChunk(pcm, Date.now(), durMs); // the orb hears her through the shared bus
        await new Promise((r) => setTimeout(r, durMs + 200));
      }
      // native: the Lab audition is web-first (the Studio live session already drives native).
    } catch {
      // keep the Lab quiet on failure — the network tab tells the story
    } finally {
      setSpeaking(false);
    }
  };

  const chip = (label: string, active: boolean, onPress: () => void, key?: string, dim?: boolean) => (
    <Pressable key={key ?? label} onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive, dim && styles.chipTextDim]}>{label}</Text>
    </Pressable>
  );

  // No Skia <AppBackground> here: the UNIFIED LATTICE inside the transparent avatar canvas IS the
  // dot-field background (one field that becomes her), over the near-black bed.
  return (
    <View style={styles.root}>
      <VenusAvatar stage={stage} variant={mode} />

      {/* top chrome */}
      <View style={[styles.topBar, { paddingTop: insets.top + 12 }]} pointerEvents="box-none">
        <Pressable onPress={onBack} hitSlop={16} style={styles.back}>
          <Text style={styles.backText}>‹ back</Text>
        </Pressable>
        <Text style={styles.title}>VENUS · LAB</Text>
        {/* embodiment toggle: the neural constellation (default) vs the Cortana face */}
        <View style={styles.modeRow}>
          {(['orb', 'face'] as Mode[]).map((m) =>
            chip(m === 'orb' ? 'Orb' : 'Face', mode === m, () => setMode(m), m),
          )}
        </View>
      </View>

      {/* the ONE control card — or, collapsed, a single floating reopen pill */}
      {collapsed ? (
        <Pressable
          onPress={() => setCollapsed(false)}
          style={[styles.reopenPill, { bottom: insets.bottom + 18 }]}>
          <Text style={styles.chipText}>▴ lab controls</Text>
        </Pressable>
      ) : (
        <View style={[styles.card, { bottom: insets.bottom + 14 }]}>
          {/* header: tabs + collapse */}
          <View style={styles.cardHeader}>
            <View style={styles.tabRow}>
              {(['stage', 'shape', 'voice'] as Panel[]).map((p) => {
                if (p === 'shape' && mode !== 'orb') return null;
                if (p === 'voice' && !voicePanelAvailable) return null;
                const active = panel === p;
                return (
                  <Pressable key={p} onPress={() => setPanel(p)} style={[styles.tab, active && styles.tabActive]}>
                    <Text style={[styles.tabText, active && styles.tabTextActive]}>{p}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable onPress={() => setCollapsed(true)} hitSlop={10} style={styles.collapseBtn}>
              <Text style={styles.chipText}>▾</Text>
            </Pressable>
          </View>

          {/* stage panel — her lifecycle */}
          {panel === 'stage' ? (
            <View style={styles.rowWrap}>
              {STAGES.map((s) => chip(s, stage === s, () => setStage(s), s))}
            </View>
          ) : null}

          {/* shape panel — the dots re-form as an object */}
          {panel === 'shape' && mode === 'orb' ? (
            <View style={styles.rowWrap}>
              {SHAPES.map((s) =>
                chip(s === 'orb' ? '● orb' : s, shape === s, () => {
                  setShape(s);
                  setVenusOrbShape(s);
                }, s),
              )}
            </View>
          ) : null}

          {/* voice panel — voice × tone × line, all in slim scrollers */}
          {panel === 'voice' && voicePanelAvailable ? (
            <View style={styles.voicePanel}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollRow}>
                {VOICES.map((v) => chip(v, voice === v, () => setVoice(v), v))}
              </ScrollView>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollRow}>
                {TONES.map((t) => chip(`♪ ${t.key}`, tone === t.key, () => setTone(t.key), t.key))}
              </ScrollView>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollRow}>
                {AUDITION_LINES.map((p, i) => chip(p, false, () => speak(p), `line-${i}`, true))}
              </ScrollView>
              <View style={styles.speakBar}>
                <TextInput
                  value={line}
                  onChangeText={setLine}
                  placeholder="Type a line for Venus…"
                  placeholderTextColor="rgba(207,232,243,0.4)"
                  style={styles.speakInput}
                  returnKeyType="send"
                  onSubmitEditing={() => speak()}
                />
                <Pressable
                  onPress={() => speak()}
                  disabled={speaking}
                  style={[styles.playBtn, speaking && styles.chipActive]}>
                  <Text style={styles.chipTextActive}>{speaking ? '…' : '▶'}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#06080f' }, // brand navy — shows once the dot-field fades
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: { paddingVertical: 4, paddingHorizontal: 4 },
  backText: { color: 'rgba(244,244,246,0.7)', fontFamily: 'Jost-Light', fontSize: 15 },
  title: { color: '#f4f4f6', fontFamily: 'Jost-Thin', fontSize: 16, letterSpacing: 3 },
  modeRow: { flexDirection: 'row', gap: 6 },

  card: {
    position: 'absolute',
    left: 14,
    right: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(124,199,223,0.16)',
    backgroundColor: 'rgba(6,10,16,0.82)',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tabRow: { flexDirection: 'row', gap: 4 },
  tab: { paddingVertical: 5, paddingHorizontal: 14, borderRadius: 999 },
  tabActive: { backgroundColor: 'rgba(95,208,224,0.14)' },
  tabText: { color: 'rgba(207,232,243,0.5)', fontFamily: 'Jost-Light', fontSize: 12, letterSpacing: 1.5 },
  tabTextActive: { color: '#dff4ff', fontFamily: 'Jost-Medium' },
  collapseBtn: { paddingHorizontal: 8, paddingVertical: 2 },
  reopenPill: {
    position: 'absolute',
    alignSelf: 'center',
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(124,199,223,0.25)',
    backgroundColor: 'rgba(6,10,16,0.82)',
  },

  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  scrollRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 2 },
  voicePanel: { gap: 8 },

  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(124,199,223,0.22)',
    backgroundColor: 'rgba(8,12,18,0.55)',
  },
  chipActive: {
    borderColor: '#5fd0e0',
    backgroundColor: 'rgba(95,208,224,0.18)',
  },
  chipText: { color: 'rgba(207,232,243,0.65)', fontFamily: 'Jost-Light', fontSize: 12, letterSpacing: 0.4 },
  chipTextActive: { color: '#dff4ff', fontFamily: 'Jost-Medium', fontSize: 12 },
  chipTextDim: { color: 'rgba(207,232,243,0.45)', fontSize: 11 },

  speakBar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  speakInput: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(124,199,223,0.22)',
    backgroundColor: 'rgba(8,12,18,0.7)',
    color: '#dff4ff',
    fontFamily: 'Jost-Light',
    fontSize: 13,
  },
  playBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#5fd0e0',
    backgroundColor: 'rgba(95,208,224,0.18)',
  },
});
