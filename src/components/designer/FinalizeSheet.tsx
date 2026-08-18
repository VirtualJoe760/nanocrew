import { useEffect, useMemo, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { Image } from 'expo-image';

import { PlacementEditorBody } from '@/components/designer/PlacementEditor';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';
import { apiFetch } from '@/lib/api';
import { minRetailCents } from '@/lib/pricing';

// Finalize & publish (port of stephen-lawyer's FinalizeForm): pick colors, set one retail
// price (default ≈ 2× base cost), name it → creates the live Printful sync product.

const MODEL_SHOTS_COST = 25; // display-only mirror of CREDIT_COSTS.model_shots (server is source of truth)

type Variant = { id: number; size: string; color: string; colorCode: string; priceCents: number };

export function FinalizeSheet({
  compositionId,
  templateKey,
  defaultName,
  designs,
  onClose,
  onPublished,
  onPreview,
  badge,
  captions,
}: {
  compositionId: string;
  templateKey: string;
  defaultName: string;
  designs: { id: string; prompt: string; image?: string }[];
  onClose: () => void;
  onPublished: (printfulSyncProductId: string) => void;
  onPreview?: (previewUrl: string) => void;
  /** Optional header ornament — Eve's flow shows her listening badge here (EveEar). */
  badge?: React.ReactNode;
  /** Optional absolute overlay — Eve's flow pins her subtitles here (EveCaptions). */
  captions?: React.ReactNode;
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
  // Non-blocking POD-provider policy notes (e.g. third-party IP) surfaced AT LAUNCH — the creator
  // owns the design + any copyright, but we tell them the print provider may decline it.
  const [warnings, setWarnings] = useState<string[]>([]);
  // One-tap model shots right after publish — /api/publish returns the local product id, so the
  // success screen can kick off on-model advertising photos without leaving the sheet.
  const [productId, setProductId] = useState<string | null>(null);
  const [shots, setShots] = useState<string[]>([]);
  const [shotsBusy, setShotsBusy] = useState(false);
  const [shotsErr, setShotsErr] = useState<string | null>(null);

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
    setWarnings([]);
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
      .then(async (r) => {
        // The launch-time POD policy gate lives server-side (checkProviderPolicy). A hard block comes
        // back 422 with a human `message` (prefer it over the `provider_policy` code); a successful
        // publish may carry non-blocking `warnings` (e.g. third-party IP) to surface to the creator.
        const d = (await r.json().catch(() => ({}))) as {
          ok?: boolean;
          printfulSyncProductId?: string;
          product?: { id: string; slug: string; modelShots?: string[] | null } | null;
          error?: string;
          message?: string;
          warnings?: { reason: string }[];
        };
        if (!r.ok || !d.ok || !d.printfulSyncProductId) {
          throw new Error(d.message || d.error || 'Publish failed');
        }
        setWarnings((d.warnings ?? []).map((w) => w.reason).filter(Boolean));
        setProductId(d.product?.id ?? null);
        // A re-publish of an already-live product carries its existing shots — show the saved
        // state instead of re-offering the paid generation.
        setShots(d.product?.modelShots ?? []);
        setPublishedId(d.printfulSyncProductId);
        onPublished(d.printfulSyncProductId);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Publish failed'))
      .finally(() => setPublishing(false));
  };

  // One-tap advertising: on-model photos of the freshly published product (Nano Banana,
  // server-side). Saved to products.model_shots — the store page and the market pick them up.
  const generateShots = () => {
    if (!productId || shotsBusy) return;
    setShotsBusy(true);
    setShotsErr(null);
    apiFetch('/api/creator/model-shots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId }),
    })
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as {
          modelShots?: string[];
          error?: string;
          needed?: number;
          balance?: number;
        };
        if (r.status === 402) {
          throw new Error(
            `Not enough credits — need ${d.needed ?? MODEL_SHOTS_COST}, you have ${d.balance ?? 0}. Top up in Account.`,
          );
        }
        if (!r.ok || !d.modelShots?.length) throw new Error(d.error || 'Model shots failed');
        setShots(d.modelShots);
      })
      .catch((e) => setShotsErr(e instanceof Error ? e.message : 'Model shots failed'))
      .finally(() => setShotsBusy(false));
  };

  // Full screen (Joe, 2026-08-17) — manual insets; the header never sits under the Dynamic Island.
  const insets = useSafeAreaInsets();

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ThemedView
        type="background"
        style={[styles.screen, { paddingTop: insets.top + Spacing.two, paddingBottom: Math.max(insets.bottom, Spacing.three) }]}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
          {captions}
          <View style={styles.header}>
            <ThemedText type="smallBold">Review & finalize</ThemedText>
            {badge}
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
              <View style={styles.bodyFill}>
                <PlacementEditorBody
                  compositionId={compositionId}
                  templateKey={templateKey}
                  designs={designs}
                  onPreview={(url) => onPreview?.(url)}
                />
              </View>
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
            <ScrollView style={styles.bodyFill} showsVerticalScrollIndicator={false} contentContainerStyle={styles.doneWrap}>
              {/* The brand font ships no COLOR EMOJI, so 🎉 drew as a missing-glyph box (B17).
                  ✓ is in the face — the same glyph the shots hint below already uses. */}
              <ThemedText type="title" style={styles.doneTitle}>
                ✓ Live on Printful
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.doneTitle}>
                Sync product #{publishedId} · {selectedCount} variants
              </ThemedText>
              {warnings.length ? (
                <View style={styles.warnBox}>
                  {warnings.map((w, i) => (
                    <ThemedText key={i} type="small" themeColor="textSecondary" style={styles.warnText}>
                      ⚠ {w}
                    </ThemedText>
                  ))}
                </View>
              ) : null}
              {/* One-tap model shots — the easy advertising step, right where publish lands. */}
              {productId ? (
                <View style={styles.shotsBlock}>
                  {shots.length ? (
                    <>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.shotsStrip}>
                        {shots.map((uri) => (
                          <Image key={uri} source={{ uri }} style={styles.shot} contentFit="cover" />
                        ))}
                      </ScrollView>
                      <ThemedText type="small" themeColor="textSecondary" style={styles.shotsHint}>
                        ✓ Model shots saved — they’ll show on your store and in the market.
                      </ThemedText>
                    </>
                  ) : (
                    <>
                      <Pressable onPress={generateShots} disabled={shotsBusy}>
                        <ThemedView
                          type="backgroundElement"
                          style={[styles.shotsBtn, shotsBusy ? { opacity: 0.6 } : null]}>
                          {shotsBusy ? (
                            <>
                              <ActivityIndicator color={theme.text} size="small" />
                              <ThemedText type="small" themeColor="textSecondary">
                                Shooting on a model…
                              </ThemedText>
                            </>
                          ) : (
                            <ThemedText type="small" themeColor="text">
                              ✦ Generate model shots · {MODEL_SHOTS_COST}
                            </ThemedText>
                          )}
                        </ThemedView>
                      </Pressable>
                      <ThemedText type="small" themeColor="textSecondary" style={styles.shotsHint}>
                        AI shots of a model wearing it — used across your store and the market.
                      </ThemedText>
                    </>
                  )}
                  {shotsErr ? (
                    <ThemedText type="small" style={styles.shotsErr}>
                      {shotsErr}
                    </ThemedText>
                  ) : null}
                </View>
              ) : null}
              <Pressable onPress={onClose} style={styles.doneBtn}>
                <View style={[styles.publish, { backgroundColor: theme.text }]}>
                  <ThemedText type="smallBold" style={{ color: theme.background }}>
                    Done
                  </ThemedText>
                </View>
              </Pressable>
            </ScrollView>
          ) : (
            <ScrollView
              style={styles.bodyFill}
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
        </KeyboardAvoidingView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: Spacing.four },
  kav: { flex: 1, gap: Spacing.three },
  bodyFill: { flex: 1 },
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
  doneTitle: { textAlign: 'center' },
  // Full-width so the pill isn't squeezed to the label's width (B17).
  doneBtn: { alignSelf: 'stretch', marginTop: Spacing.one },
  shotsBlock: { alignSelf: 'stretch', gap: Spacing.two },
  shotsStrip: { gap: Spacing.two, paddingVertical: Spacing.one },
  shot: { width: 108, height: 138, borderRadius: Spacing.two, backgroundColor: 'rgba(255,255,255,0.04)' },
  shotsBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, paddingVertical: Spacing.three, borderRadius: 999 },
  shotsHint: { textAlign: 'center' },
  shotsErr: { color: '#e24b4a', textAlign: 'center' },
  warnBox: { gap: Spacing.one, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: 10, backgroundColor: 'rgba(180,140,0,0.10)', alignSelf: 'stretch' },
  warnText: { textAlign: 'center' },
  publish: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.three, borderRadius: 999, minHeight: 44 },
});
