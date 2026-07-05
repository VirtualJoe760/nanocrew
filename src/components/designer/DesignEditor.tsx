import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiFetch } from '@/lib/api';

// Full-screen design EDITOR — opened by double-tapping a design on the canvas. One image +
// natural-language instruction → Nano Banana edit (/api/edit). Modes shape the instruction:
// semantic INPAINT (describe the region, no masks), TEXT (swap the words, keep the look),
// REMIX (new idea, same aesthetic), or CUSTOM. Every Apply saves a NEW design (non-destructive);
// the result becomes the next edit's source, so refinements iterate naturally.

type EditMode = 'inpaint' | 'text' | 'remix' | 'custom';
type EditedDesign = { id: string; url: string; prompt: string };

const EDIT_COST = 8; // display-only mirror of CREDIT_COSTS.design_edit (server is source of truth)

const MODES: { key: EditMode; icon: keyof typeof Ionicons.glyphMap; label: string; placeholder: string }[] = [
  { key: 'inpaint', icon: 'color-wand-outline', label: 'Retouch', placeholder: 'Describe the part to change — "make the background a night sky"' },
  { key: 'text', icon: 'text-outline', label: 'Words', placeholder: 'Swap the lettering — "change STAY GOLD to STAY BOLD"' },
  { key: 'remix', icon: 'bulb-outline', label: 'Remix idea', placeholder: 'New concept, same style — "a phoenix instead of a skater"' },
  { key: 'custom', icon: 'create-outline', label: 'Custom', placeholder: 'Describe any edit in your own words' },
];

export function DesignEditor({
  design,
  catalogueId,
  initialInstruction,
  onClose,
  onSaved,
}: {
  /** The design being edited (null = closed). */
  design: { id: string; image: string; prompt: string } | null;
  catalogueId?: string;
  /** Command-bus prefill (deep links / Venus): a suggested instruction, applied on open. */
  initialInstruction?: string;
  onClose: () => void;
  /** Fired for every successful edit — the new design row (caller adds it to the dock). */
  onSaved: (d: EditedDesign) => void;
}) {
  const theme = useTheme();
  const [mode, setMode] = useState<EditMode>('inpaint');
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The latest edit result — shown large, and used as the SOURCE of the next edit (iteration).
  const [result, setResult] = useState<EditedDesign | null>(null);

  // Fresh session whenever a different design opens (bus-suggested instruction lands here).
  useEffect(() => {
    setMode(initialInstruction ? 'custom' : 'inpaint');
    setInstruction(initialInstruction ?? '');
    setError(null);
    setResult(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design?.id]);

  if (!design) return null;
  const source = result ?? { id: design.id, url: design.image, prompt: design.prompt };

  const apply = async () => {
    const instr = instruction.trim();
    if (!instr || busy || !catalogueId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ designId: source.id, catalogueId, instruction: instr, mode }),
      });
      const data = (await res.json().catch(() => ({}))) as { image?: string; id?: string; prompt?: string; error?: string; needed?: number };
      if (res.status === 402) throw new Error(`Not enough credits — need ${data.needed ?? EDIT_COST}. Top up in Account.`);
      if (!res.ok || !data.image || !data.id) throw new Error(data.error || 'Edit failed');
      const d: EditedDesign = { id: data.id, url: data.image, prompt: data.prompt ?? `Edit — ${instr.slice(0, 80)}` };
      setResult(d);
      setInstruction('');
      onSaved(d); // lands in the dock immediately; unwanted iterations can be drag-trashed
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Edit failed');
    } finally {
      setBusy(false);
    }
  };

  const active = MODES.find((m) => m.key === mode) ?? MODES[0];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ThemedView type="background" style={styles.sheet}>
          <View style={styles.header}>
            <ThemedText type="smallBold">Edit design</ThemedText>
            <Pressable onPress={onClose} hitSlop={10}>
              <ThemedText type="small" themeColor="textSecondary">Done</ThemedText>
            </Pressable>
          </View>

          {/* The working image — the original, or the latest edit (which the next edit builds on). */}
          <View style={[styles.stage, { backgroundColor: theme.backgroundElement }]}>
            <Image source={{ uri: source.url }} style={styles.stageImg} contentFit="contain" />
            {busy ? (
              <View style={styles.stageBusy}>
                <ActivityIndicator color="#fff" />
                <ThemedText type="small" style={styles.busyText}>Editing…</ThemedText>
              </View>
            ) : null}
          </View>
          {result ? (
            <ThemedText type="small" themeColor="textSecondary">
              Saved to your designs — keep editing to refine, or Done.
            </ThemedText>
          ) : null}

          {/* Edit modes — square tiles, same language as the composer strips. */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modeStrip}>
            {MODES.map((m) => {
              const on = m.key === mode;
              return (
                <Pressable key={m.key} onPress={() => setMode(m.key)} accessibilityLabel={m.label}>
                  <ThemedView
                    type={on ? 'backgroundSelected' : 'backgroundElement'}
                    style={[styles.modeTile, on ? { borderColor: theme.tint } : null]}>
                    <Ionicons name={m.icon} size={22} color={on ? theme.text : theme.textSecondary} />
                    <ThemedText type="code" themeColor={on ? 'text' : 'textSecondary'} style={styles.modeLabel} numberOfLines={1}>
                      {m.label}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              );
            })}
          </ScrollView>

          <TextInput
            value={instruction}
            onChangeText={(t) => {
              setInstruction(t);
              setError(null);
            }}
            placeholder={active.placeholder}
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            multiline
          />
          {error ? (
            <ThemedText type="small" themeColor="textSecondary">{error}</ThemedText>
          ) : null}

          <Pressable onPress={apply} disabled={busy || !instruction.trim()}>
            <View style={[styles.apply, { backgroundColor: theme.text, opacity: busy || !instruction.trim() ? 0.5 : 1 }]}>
              <ThemedText type="smallBold" style={{ color: theme.background }}>
                {busy ? 'Editing…' : `✦ Apply edit · ${EDIT_COST}`}
              </ThemedText>
            </View>
          </Pressable>
        </ThemedView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: Spacing.four, gap: Spacing.three },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stage: { height: 320, borderRadius: 14, overflow: 'hidden' },
  stageImg: { flex: 1 },
  stageBusy: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.45)' },
  busyText: { color: '#fff' },
  modeStrip: { flexDirection: 'row', gap: Spacing.two, paddingVertical: Spacing.one },
  modeTile: { width: 76, height: 62, borderRadius: 14, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 4 },
  modeLabel: { fontSize: 9, letterSpacing: 0.2 },
  input: { minHeight: 64, borderRadius: 14, padding: Spacing.three, textAlignVertical: 'top' },
  apply: { borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center' },
});
