import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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
// VOICE AUDITION lives here in ORB mode: pick a Gemini prebuilt voice, tap a line — /api/say
// synthesizes it and we (a) play the WAV, (b) push its PCM into the venus-speech-level bus, so
// the ORB'S VOICE LAYER reacts exactly as it does to the live session. Audition in the
// `talking` stage (the voice layer is gated on it). Simli (the old photoreal POC) is REMOVED.

const STAGES: VenusStage[] = ['pre-render', 'morphing', 'silence', 'talking'];
// Orb-mode shape morphs — the dots dissolve and re-form as the object (venus-orb-bus).
const SHAPES: VenusOrbShape[] = ['orb', 'tee', 'heart', 'bolt'];
// orb = the NEURAL CONSTELLATION (the DEFAULT embodiment app-wide); face = the Cortana-era
// humanoid build (kept for comparison).
type Mode = 'orb' | 'face';

// Quick lines to audition (so you can sample voices without typing each time).
const AUDITION_LINES = [
  "Hi, I'm Venus — how do I sound?",
  "Let's build your brand — what are we making today?",
  'Your store is live. Go check it out!',
];

// The FULL 30-voice Gemini catalog (matches the /api/say allowlist). 'Aoede' is today's
// default. Making a different one THE voice = change VENUS_VOICE in /api/say + LIVE_VOICE in
// studio.tsx (they must match). NB 'Sulafat' broke the LIVE session once — retest before live.
const VOICES = [
  'Aoede', 'Leda', 'Kore', 'Zephyr', 'Callirrhoe', 'Autonoe', 'Despina', 'Erinome', 'Laomedeia',
  'Vindemiatrix', 'Achernar', 'Sulafat', 'Puck', 'Charon', 'Fenrir', 'Orus', 'Enceladus',
  'Iapetus', 'Umbriel', 'Algieba', 'Algenib', 'Rasalgethi', 'Alnilam', 'Schedar', 'Gacrux',
  'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Sadachbia', 'Sadaltager',
];

// TONE direction — Gemini TTS follows natural-language style instructions prefixed to the
// line (it performs the direction, it doesn't read it aloud). The tone applies to ANY voice,
// so hunt the combo: e.g. "british robot" × Erinome/Kore/Charon/Schedar. For the LIVE
// interview, the winning tone gets baked into the session's system instruction instead.
// Every direction specifies a FEMALE character (Joe: "the british robot and jarvis are awesome…
// but i'd prefer a female") — the voice chip sets the underlying timbre (the first ~11 voices
// are the female-leaning ones), the tone makes her British/robotic.
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
  const [line, setLine] = useState("Hi, I'm Venus — how do I sound?");
  const [voice, setVoice] = useState('Aoede');
  const [tone, setTone] = useState('natural');
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
          {(['orb', 'face'] as Mode[]).map((m) => {
            const active = mode === m;
            return (
              <Pressable key={m} onPress={() => setMode(m)} style={[styles.modePill, active && styles.pillActive]}>
                <Text style={[styles.pillText, active && styles.pillTextActive]}>{m === 'orb' ? 'Orb' : 'Face'}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* VOICE AUDITION (orb mode, web) — pick a voice + tone, tap a line; the orb reacts */}
      {mode === 'orb' && Platform.OS === 'web' ? (
        <View style={[styles.auditionBlock, { bottom: insets.bottom + 142 }]} pointerEvents="box-none">
          <View style={styles.voiceRow}>
            {VOICES.map((v) => {
              const active = voice === v;
              return (
                <Pressable key={v} onPress={() => setVoice(v)} style={[styles.voiceChip, active && styles.pillActive]}>
                  <Text style={[styles.voiceText, active && styles.pillTextActive]}>{v}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.voiceRow}>
            {TONES.map((tn) => {
              const active = tone === tn.key;
              return (
                <Pressable
                  key={tn.key}
                  onPress={() => setTone(tn.key)}
                  style={[styles.voiceChip, styles.toneChip, active && styles.pillActive]}>
                  <Text style={[styles.voiceText, active && styles.pillTextActive]}>♪ {tn.key}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.presetRow}>
            {AUDITION_LINES.map((p, i) => (
              <Pressable key={i} onPress={() => speak(p)} disabled={speaking} style={styles.preset}>
                <Text numberOfLines={1} style={styles.presetText}>
                  {p}
                </Text>
              </Pressable>
            ))}
            <Pressable onPress={() => speak()} disabled={speaking} style={[styles.preset, speaking && styles.pillActive]}>
              <Text style={styles.presetText}>{speaking ? '…' : '▶ speak input'}</Text>
            </Pressable>
          </View>
          <TextInput
            value={line}
            onChangeText={setLine}
            placeholder="Type a line for Venus…"
            placeholderTextColor="rgba(207,232,243,0.4)"
            style={styles.speakInput}
            returnKeyType="send"
            onSubmitEditing={() => speak()}
          />
        </View>
      ) : null}

      {/* shape morphs — orb mode only: her dots dissolve and re-form as the object */}
      {mode === 'orb' ? (
        <View style={[styles.stageBar, { bottom: insets.bottom + 92 }]} pointerEvents="box-none">
          {SHAPES.map((s) => {
            const active = shape === s;
            return (
              <Pressable
                key={s}
                onPress={() => {
                  setShape(s);
                  setVenusOrbShape(s);
                }}
                style={[styles.pill, active && styles.pillActive]}>
                <Text style={[styles.pillText, active && styles.pillTextActive]}>{s === 'orb' ? '● orb' : s}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* stage control — toggle her lifecycle stage to test each phase */}
      <View style={[styles.stageBar, { bottom: insets.bottom + 42 }]} pointerEvents="box-none">
        {STAGES.map((s) => {
          const active = stage === s;
          return (
            <Pressable key={s} onPress={() => setStage(s)} style={[styles.pill, active && styles.pillActive]}>
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{s}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.foot, { bottom: insets.bottom + 16 }]}>
        venus avatar lab · docs/studio/VENUS_AVATAR.md
      </Text>
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
  stageBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  auditionBlock: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
  },
  voiceRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 5 },
  voiceChip: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(124,199,223,0.25)',
    backgroundColor: 'rgba(8,12,18,0.55)',
  },
  voiceText: { color: 'rgba(207,232,243,0.6)', fontFamily: 'Jost-Light', fontSize: 11, letterSpacing: 0.4 },
  pill: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(124,199,223,0.25)',
    backgroundColor: 'rgba(8,12,18,0.55)',
  },
  pillActive: {
    borderColor: '#5fd0e0',
    backgroundColor: 'rgba(95,208,224,0.18)',
  },
  pillText: { color: 'rgba(207,232,243,0.6)', fontFamily: 'Jost-Light', fontSize: 12, letterSpacing: 0.5 },
  pillTextActive: { color: '#dff4ff', fontFamily: 'Jost-Medium' },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  toneChip: { borderColor: 'rgba(199,125,255,0.35)' }, // violet ring — tones are DIRECTION, not voices
  preset: {
    maxWidth: 220,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(124,199,223,0.25)',
    backgroundColor: 'rgba(8,12,18,0.6)',
  },
  presetText: { color: 'rgba(207,232,243,0.7)', fontFamily: 'Jost-Light', fontSize: 11 },
  speakInput: {
    alignSelf: 'center',
    minWidth: 280,
    maxWidth: 360,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(124,199,223,0.25)',
    backgroundColor: 'rgba(8,12,18,0.7)',
    color: '#dff4ff',
    fontFamily: 'Jost-Light',
    fontSize: 13,
  },
  modeRow: { flexDirection: 'row', gap: 6 },
  modePill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(124,199,223,0.25)',
    backgroundColor: 'rgba(8,12,18,0.55)',
  },
  foot: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: 'rgba(124,199,223,0.6)',
    fontFamily: 'Jost-Light',
    fontSize: 12,
    letterSpacing: 1.5,
  },
});
