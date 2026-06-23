import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { Palette } from '@/components/nc-screen';
import type { ChatMessage } from '@/lib/interview';
import { Spacing } from '@/constants/theme';

// The "what to talk about" aid for the Venus interview. New creators often don't know what to SAY —
// this surfaces the things Venus wants to cover (name · products · style · colors · logo · vibe), each
// with a tap-to-ask example prompt, and quietly checks a topic off once the conversation touches it.
// It's a NUDGE, not a gate (Venus still leads): coverage is a forgiving keyword heuristic on the
// transcript — over-marking "covered" is harmless, the value is the example prompts.

type Topic = { key: string; label: string; example: string; kws: string[] };

const TOPICS: Topic[] = [
  { key: 'name', label: 'Brand name', example: 'I want to call it ___ — it stands for ___', kws: ['name', 'call it', 'called', 'brand is', 'named', "it's called"] },
  { key: 'products', label: 'Products', example: 'I want to sell oversized tees and hoodies', kws: ['tee', 't-shirt', 'shirt', 'hoodie', 'hat', 'cap', 'sell', 'product', 'apparel', 'merch', 'crewneck', 'sweat', 'jacket', 'tote'] },
  { key: 'style', label: 'Style & look', example: 'Clean and minimal — not loud', kws: ['minimal', 'bold', 'street', 'elegant', 'vintage', 'clean', 'edgy', 'luxe', 'retro', 'modern', 'aesthetic', 'look', 'style', 'grunge', 'y2k'] },
  { key: 'colors', label: 'Colors', example: 'Mostly black and white, with a pop of red', kws: ['color', 'colour', 'black', 'white', 'red', 'blue', 'green', 'pink', 'neon', 'pastel', 'monochrome', 'palette', 'gold', 'silver', 'cream', 'beige'] },
  { key: 'logo', label: 'Logo', example: 'A simple wordmark — no icon', kws: ['logo', 'wordmark', 'icon', 'mark', 'symbol', 'emblem', 'monogram', 'lettering'] },
  { key: 'vibe', label: 'Vibe & feel', example: 'It should feel premium and a little rebellious', kws: ['vibe', 'feel', 'mood', 'tone', 'energy', 'audience', 'premium', 'luxury', 'playful', 'rebellious', 'cozy', 'confident'] },
];

export function InterviewTopics({
  messages,
  onAsk,
  p,
}: {
  messages: ChatMessage[];
  /** Send an example prompt as the creator's turn (Venus answers it). Optional. */
  onAsk?: (text: string) => void;
  p: Palette;
}) {
  const [open, setOpen] = useState(false);

  // Forgiving coverage: did the whole transcript touch this topic's keywords?
  const covered = useMemo(() => {
    const text = messages.map((m) => m.text.toLowerCase()).join(' · ');
    const out: Record<string, boolean> = {};
    for (const t of TOPICS) out[t.key] = t.kws.some((k) => text.includes(k));
    return out;
  }, [messages]);
  const doneCount = TOPICS.filter((t) => covered[t.key]).length;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable onPress={() => setOpen((o) => !o)} hitSlop={8} style={[styles.header, { borderColor: `${p.dim}55` }]}>
        <ThemedText type="code" style={{ color: p.accent, fontSize: 12, letterSpacing: 0.5 }}>
          ✦ What to talk about
        </ThemedText>
        <ThemedText type="code" style={{ color: p.faint, fontSize: 11 }}>
          {doneCount}/{TOPICS.length}  {open ? '▾' : '▸'}
        </ThemedText>
      </Pressable>

      {open ? (
        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: Spacing.two }} showsVerticalScrollIndicator={false}>
          {TOPICS.map((t) => {
            const done = covered[t.key];
            return (
              <View key={t.key} style={styles.row}>
                <ThemedText type="code" style={{ color: done ? p.accent : `${p.dim}88`, fontSize: 13, width: 18 }}>
                  {done ? '✓' : '○'}
                </ThemedText>
                <View style={styles.rowBody}>
                  <ThemedText type="smallBold" style={{ color: done ? p.dim : p.ink }}>
                    {t.label}
                  </ThemedText>
                  <Pressable onPress={() => onAsk?.(t.example)} disabled={!onAsk} hitSlop={6}>
                    <ThemedText type="code" style={{ color: p.faint, fontSize: 12, marginTop: 2 }}>
                      {onAsk ? '“' + t.example + '”  ⟶' : '“' + t.example + '”'}
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
            );
          })}
          <ThemedText type="code" style={{ color: p.faint, fontSize: 11, marginTop: Spacing.two, lineHeight: 16 }}>
            Just talk naturally — Venus leads. Tap a line to have her dig into it.
          </ThemedText>
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two,
  },
  list: { maxHeight: 230, marginTop: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start', paddingVertical: 7 },
  rowBody: { flex: 1 },
});
