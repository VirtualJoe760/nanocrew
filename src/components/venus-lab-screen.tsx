import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRef, useState } from 'react';

import VenusAvatar, { type VenusStage } from '@/components/venus-avatar';
import { setVenusOrbShape, type VenusOrbShape } from '@/components/backgrounds/venus-orb-bus';
import SimliVenus from '@/components/simli-venus';
import type { SimliVenusHandle } from '@/components/simli-venus-html';

// THE VENUS LAB — the live venus-head-scene full-screen, for iterating on Venus's appearance in
// isolation. Now surfaced as a TEST tool from the Account screen (gated to the Venus-Lab tester
// email), not a tab. `onBack` returns to wherever it was opened from (the Account page). The avatar
// comes from <VenusAvatar>, a COMPONENT split: venus-avatar.web.tsx renders the real R3F scene on
// web, venus-avatar.tsx on native (expo-gl). A `mode` toggle also lets us compare the current 3D
// build against the **Simli** photoreal renderer (web: simli-client; native: WebView). Full guide:
// docs/studio/VENUS_AVATAR.md.

const STAGES: VenusStage[] = ['pre-render', 'morphing', 'silence', 'talking'];
// Orb-mode shape morphs — the dots dissolve and re-form as the object (venus-orb-bus).
const SHAPES: VenusOrbShape[] = ['orb', 'tee', 'heart', 'bolt'];
// orb = the JARVIS-style sphere of light (the DEFAULT embodiment app-wide); face = the Cortana-era
// humanoid build (kept for comparison); simli = the photoreal renderer POC.
type Mode = 'orb' | 'face' | 'simli';

// Quick lines to tap in Simli mode (so you can sample her voice without typing each time).
const SIMLI_LINES = [
  "Hi, I'm Venus — how do I sound?",
  "Let's build your brand — what are we making today?",
  'Your store is live. Go check it out!',
];

// VOICE AUDITION — Gemini prebuilt voices to try (must match the tts route's allowlist).
// Tap a voice, then a line: she speaks it in that voice. 'Aoede' is today's default; to make a
// different one THE voice, change VENUS_VOICE in /api/say + /api/simli/tts and LIVE_VOICE in
// studio.tsx (they must all match).
const VOICES = ['Aoede', 'Leda', 'Kore', 'Zephyr', 'Callirrhoe', 'Despina', 'Erinome', 'Laomedeia'];

export default function VenusLabScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<VenusStage>('talking');
  const [mode, setMode] = useState<Mode>('orb');
  const [shape, setShape] = useState<VenusOrbShape>('orb');
  const simliRef = useRef<SimliVenusHandle>(null);
  const [line, setLine] = useState("Hi, I'm Venus — how do I sound?");
  const [speaking, setSpeaking] = useState(false);
  const [voice, setVoice] = useState('Aoede');

  // Simli mode: make Venus speak in the SELECTED Gemini voice (voice audition). Pass a preset,
  // or use the input. Re-pressing while she's talking interrupts (the frame supersedes it).
  const speak = async (textArg?: string) => {
    const text = (textArg ?? line).trim();
    if (!text || speaking) return;
    if (textArg) setLine(textArg);
    setSpeaking(true);
    try {
      await simliRef.current?.speak(text, voice);
    } catch {
      // any failure surfaces inside the Simli frame; keep the Lab UI quiet
    } finally {
      setSpeaking(false);
    }
  };

  // No Skia <AppBackground> here: the UNIFIED LATTICE inside the transparent avatar canvas IS the
  // dot-field background (one field that becomes her), over the near-black bed.
  return (
    <View style={styles.root}>
      {mode === 'simli' ? <SimliVenus ref={simliRef} /> : <VenusAvatar stage={stage} variant={mode} />}

      {/* top chrome */}
      <View style={[styles.topBar, { paddingTop: insets.top + 12 }]} pointerEvents="box-none">
        <Pressable onPress={onBack} hitSlop={16} style={styles.back}>
          <Text style={styles.backText}>‹ back</Text>
        </Pressable>
        <Text style={styles.title}>VENUS · LAB</Text>
        {/* embodiment toggle: the JARVIS orb (default) vs the Cortana face vs the Simli renderer */}
        <View style={styles.modeRow}>
          {(['orb', 'face', 'simli'] as Mode[]).map((m) => {
            const active = mode === m;
            return (
              <Pressable key={m} onPress={() => setMode(m)} style={[styles.modePill, active && styles.pillActive]}>
                <Text style={[styles.pillText, active && styles.pillTextActive]}>
                  {m === 'orb' ? 'Orb' : m === 'face' ? 'Face' : 'Simli'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* stage control — toggle her lifecycle stage to test each phase (3D builds only) */}
      {mode !== 'simli' ? (
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

      {/* simli mode — pick a VOICE, then tap a preset or type your own to audition it */}
      {mode === 'simli' ? (
        <View style={[styles.simliControls, { bottom: insets.bottom + 42 }]} pointerEvents="box-none">
          <View style={styles.presetRow}>
            {VOICES.map((v) => {
              const active = voice === v;
              return (
                <Pressable key={v} onPress={() => setVoice(v)} style={[styles.pill, active && styles.pillActive]}>
                  <Text style={[styles.pillText, active && styles.pillTextActive]}>{v}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.presetRow}>
            {SIMLI_LINES.map((p, i) => (
              <Pressable key={i} onPress={() => speak(p)} disabled={speaking} style={styles.preset}>
                <Text numberOfLines={1} style={styles.presetText}>
                  {p}
                </Text>
              </Pressable>
            ))}
          </View>
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
              style={[styles.speakBtn, speaking && styles.pillActive]}>
              <Text style={[styles.pillText, styles.pillTextActive]}>{speaking ? '…' : 'Speak'}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

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
  simliControls: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
  },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
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
  speakBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'stretch' },
  speakInput: {
    flex: 1,
    maxWidth: 360,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(124,199,223,0.25)',
    backgroundColor: 'rgba(8,12,18,0.7)',
    color: '#dff4ff',
    fontFamily: 'Jost-Light',
    fontSize: 13,
  },
  speakBtn: {
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#5fd0e0',
    backgroundColor: 'rgba(95,208,224,0.18)',
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
