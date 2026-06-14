import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { PlacementEditorBody } from '@/components/designer/PlacementEditor';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';
import { apiFetch } from '@/lib/api';
import { minRetailCents } from '@/lib/pricing';

// Finalize & publish (port of stephen-lawyer's FinalizeForm): pick colors, set one retail
// price (default ≈ 2× base cost), name it → creates the live Printful sync product.

type Variant = { id: number; size: string; color: string; colorCode: string; priceCents: number };

export function FinalizeSheet({
  compositionId,
  templateKey,
  defaultName,
  designs,
  onClose,
  onPublished,
  onPreview,
}: {
  compositionId: string;
  templateKey: string;
  defaultName: string;
  designs: { id: string; prompt: string; image?: string }[];
  onClose: () => void;
  onPublished: (printfulSyncProductId: string) => void;
  onPreview?: (previewUrl: string) => void;
}) {
  const theme = useTheme();
  // Placement stays fully adjustable right up to publish — the same WYSIWYG editor
  // (drag/resize/multi-placement/real mockups, hard-clamped to Printful's print areas).
  const [step, setStep] = useState<'placement' | 'pricing'>('placement');
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState(defaultName);
  const [price, setPrice] = useState('');
  const [maxBaseCents, setMaxBaseCents] = useState(0); // highest Printful base cost → sets the floor
  const [selectedColors, setSelectedColors] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishedId, setPublishedId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch(`/api/blank/${templateKey}/variants`)
      .then((r) => r.json())
      .then((d: { variants?: Variant[] }) => {
        if (!alive || !d.variants?.length) return;
        setVariants(d.variants);
        // Pricing standard: the floor is the highest base cost + margin; default to it.
        const maxBase = Math.max(...d.variants.map((v) => v.priceCents));
        setMaxBaseCents(maxBase);
        setPrice((minRetailCents(maxBase) / 100).toFixed(2));
        const first = d.variants[0]?.color;
        if (first) setSelectedColors(new Set([first]));
      })
      .catch(() => setError('Failed to load variants'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [templateKey]);

  const colorGroups = useMemo(() => {
    const m = new Map<string, Variant[]>();
    for (const v of variants) {
      const list = m.get(v.color);
      if (list) list.push(v);
      else m.set(v.color, [v]);
    }
    return [...m.entries()].map(([color, vs]) => ({ color, colorCode: vs[0].colorCode, vs }));
  }, [variants]);

  const toggleColor = (color: string) => {
    setSelectedColors((s) => {
      const next = new Set(s);
      if (next.has(color)) next.delete(color);
      else next.add(color);
      return next;
    });
  };

  const selectedCount = colorGroups
    .filter((g) => selectedColors.has(g.color))
    .reduce((sum, g) => sum + g.vs.length, 0);
  const priceCents = Math.round(parseFloat(price || '0') * 100);
  const minPriceCents = minRetailCents(maxBaseCents);
  const belowFloor = priceCents < minPriceCents;
  const canPublish = !!name.trim() && priceCents > 0 && !belowFloor && selectedCount > 0 && !publishing;

  const publish = () => {
    if (!canPublish) return;
    setPublishing(true);
    setError(null);
    const chosen = variants.filter((v) => selectedColors.has(v.color));
    apiFetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        compositionId,
        name: name.trim(),
        variants: chosen.map((v) => ({
          printfulVariantId: v.id,
          retailPriceCents: priceCents,
          size: v.size,
          color: v.color,
        })),
      }),
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; printfulSyncProductId?: string; error?: string }) => {
        if (!d.ok || !d.printfulSyncProductId) throw new Error(d.error || 'Publish failed');
        setPublishedId(d.printfulSyncProductId);
        onPublished(d.printfulSyncProductId);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Publish failed'))
      .finally(() => setPublishing(false));
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.backdrop}>
        <ThemedView type="background" style={styles.sheet}>
          <View style={styles.header}>
            <ThemedText type="smallBold">Review & finalize</ThemedText>
            <Pressable onPress={onClose} hitSlop={10}>
              <ThemedText type="small" themeColor="textSecondary">
                Close
              </ThemedText>
            </Pressable>
          </View>

          {/* Linear steps: review the print → price → publish. Step 1 is tappable from
              step 2 so you can go back and tweak; you can't skip ahead. */}
          {!publishedId ? (
            <View style={styles.stepRow}>
              {(
                [
                  ['placement', '1 · Review'],
                  ['pricing', '2 · Pricing'],
                ] as const
              ).map(([key, label]) => (
                <Pressable
                  key={key}
                  onPress={() => key === 'placement' && setStep('placement')}
                  style={styles.stepBtn}>
                  <ThemedView
                    type={step === key ? 'backgroundSelected' : 'backgroundElement'}
                    style={styles.stepChip}>
                    <ThemedText type="small" themeColor={step === key ? 'text' : 'textSecondary'}>
                      {label}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              ))}
            </View>
          ) : null}

          {step === 'placement' && !publishedId ? (
            <>
              <PlacementEditorBody
                compositionId={compositionId}
                templateKey={templateKey}
                designs={designs}
                onPreview={(url) => onPreview?.(url)}
              />
              <Pressable onPress={() => setStep('pricing')}>
                <View style={[styles.publish, { backgroundColor: theme.text }]}>
                  <ThemedText type="smallBold" style={{ color: theme.background }}>
                    Move on to pricing →
                  </ThemedText>
                </View>
              </Pressable>
            </>
          ) : loading ? (
            <ActivityIndicator style={{ marginVertical: Spacing.six }} />
          ) : publishedId ? (
            <View style={styles.doneWrap}>
              <ThemedText type="title">🎉 Live on Printful</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Sync product #{publishedId} · {selectedCount} variants
              </ThemedText>
              <Pressable onPress={onClose}>
                <View style={[styles.publish, { backgroundColor: theme.text }]}>
                  <ThemedText type="smallBold" style={{ color: theme.background }}>
                    Done
                  </ThemedText>
                </View>
              </Pressable>
            </View>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ gap: Spacing.three }}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Product name"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <View style={styles.priceRow}>
                <ThemedText type="small" themeColor="textSecondary">
                  Retail price $
                </ThemedText>
                <TextInput
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="decimal-pad"
                  style={[styles.priceInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
                <ThemedText type="small" themeColor={belowFloor ? undefined : 'textSecondary'} style={belowFloor ? { color: '#e24b4a' } : undefined}>
                  min ${(minPriceCents / 100).toFixed(2)}
                </ThemedText>
              </View>

              <ThemedText type="small" themeColor="textSecondary">
                Colours · {selectedCount} variants selected
              </ThemedText>
              <View style={styles.colorWrap}>
                {colorGroups.map((g) => {
                  const on = selectedColors.has(g.color);
                  return (
                    <Pressable key={g.color} onPress={() => toggleColor(g.color)}>
                      <ThemedView
                        type={on ? 'backgroundSelected' : 'backgroundElement'}
                        style={styles.colorChip}>
                        <View style={[styles.swatch, { backgroundColor: g.colorCode }]} />
                        <ThemedText type="small" themeColor={on ? 'text' : 'textSecondary'}>
                          {g.color} · {g.vs.length}
                        </ThemedText>
                      </ThemedView>
                    </Pressable>
                  );
                })}
              </View>

              {error ? (
                <ThemedText type="small" style={{ color: '#e24b4a' }}>
                  {error}
                </ThemedText>
              ) : null}

              <Pressable onPress={publish} disabled={!canPublish}>
                <View style={[styles.publish, { backgroundColor: theme.text, opacity: canPublish ? 1 : 0.4 }]}>
                  {publishing ? (
                    <ActivityIndicator color={theme.background} />
                  ) : (
                    <ThemedText type="smallBold" style={{ color: theme.background }}>
                      Publish product
                    </ThemedText>
                  )}
                </View>
              </Pressable>
            </ScrollView>
          )}
        </ThemedView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    padding: Spacing.four,
    paddingBottom: Spacing.six,
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    gap: Spacing.three,
    maxHeight: '88%',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stepRow: { flexDirection: 'row', gap: Spacing.two },
  stepBtn: { flex: 1 },
  stepChip: { alignItems: 'center', paddingVertical: Spacing.two, borderRadius: 999 },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 15 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  priceInput: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    fontSize: 15,
    minWidth: 84,
    textAlign: 'center',
  },
  colorWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  colorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: 999,
  },
  swatch: { width: 14, height: 14, borderRadius: 7, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(128,128,128,0.5)' },
  doneWrap: { alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.four },
  publish: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.three, borderRadius: 999, minHeight: 44 },
});
