import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { apiUrl } from '@/lib/api';
import { type StudioPalette, useStudioPalette } from '@/lib/studio-palette';

// The "cool short" composer: pick a product → a scene → format → a quality tier (Wan / Seedance /
// Veo) → generate. Nano Banana renders an on-model still, the chosen fal model animates it, and the
// short publishes straight to the brand site or the Nano Crew feed. Mirrors the post-composer shape.

type Product = { id: string; name: string; imageUrl: string | null };
type VideoModel = { key: string; label: string; blurb: string; credits: number; durationSec: number };

const SCENES = [
  'skateboarding down a sunlit city street',
  'walking along a beach at golden hour',
  'crossing a busy downtown intersection',
  'riding up in a glass elevator',
  'on an airplane by the window',
  'dancing in a neon-lit club',
  'leaning against a cocktail bar',
];
// Short chip labels for the presets above (same order).
const SCENE_LABELS = ['Skateboarding', 'Beach', 'Crosswalk', 'Elevator', 'Airplane', 'Club', 'Cocktail bar'];

// Sensible fallback if /credits hasn't loaded the catalog yet.
const FALLBACK_MODELS: VideoModel[] = [
  { key: 'wan', label: 'Wan 2.5', blurb: 'Best value · great motion', credits: 60, durationSec: 5 },
  { key: 'seedance', label: 'Seedance 2.0', blurb: 'Premium · cinematic + audio', credits: 160, durationSec: 5 },
  { key: 'veo3', label: 'Veo 3', blurb: 'Top-tier realism + native audio', credits: 400, durationSec: 8 },
];

type Phase = 'config' | 'generating' | 'done';

function VideoPreview({ url, aspect }: { url: string; aspect: '9:16' | '16:9' }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.muted = false;
    p.play();
  });
  const ratio = aspect === '9:16' ? 9 / 16 : 16 / 9;
  return <VideoView player={player} style={{ width: '100%', aspectRatio: ratio, borderRadius: 14, backgroundColor: '#000' }} contentFit="cover" nativeControls />;
}

export function SceneShortComposer({
  visible,
  onClose,
  token,
  slug,
  onPublished,
}: {
  visible: boolean;
  onClose: () => void;
  token: string;
  slug: string;
  onPublished?: () => void;
}) {
  const pal = useStudioPalette();
  const styles = useMemo(() => makeStyles(pal), [pal]);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const [products, setProducts] = useState<Product[]>([]);
  const [models, setModels] = useState<VideoModel[]>(FALLBACK_MODELS);
  const [credits, setCredits] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const [productId, setProductId] = useState<string | null>(null);
  const [scene, setScene] = useState('');
  const [aspect, setAspect] = useState<'9:16' | '16:9'>('9:16');
  const [modelKey, setModelKey] = useState('seedance');
  const [target] = useState<'website' | 'feed'>('website'); // feed target hidden for v1 (see POST TO)

  const [phase, setPhase] = useState<Phase>('config');
  const [result, setResult] = useState<{ videoUrl: string; aspect: '9:16' | '16:9' } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const model = models.find((m) => m.key === modelKey) ?? models[0];

  const reset = useCallback(() => {
    setPhase('config');
    setResult(null);
    setNote(null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, cRes] = await Promise.all([
        fetch(apiUrl(`/api/creator/products?storeSlug=${encodeURIComponent(slug)}`), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(apiUrl('/api/creator/credits'), { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const pd = (await pRes.json()) as { products?: Product[] };
      const list = (pd.products ?? []).filter((p) => p.imageUrl);
      setProducts(list);
      setProductId((id) => id ?? list[0]?.id ?? null);
      const cd = (await cRes.json()) as { balance?: number; videoModels?: VideoModel[] };
      if (typeof cd.balance === 'number') setCredits(cd.balance);
      if (cd.videoModels?.length) setModels(cd.videoModels);
    } catch {
      setNote('Could not load your products.');
    } finally {
      setLoading(false);
    }
  }, [slug, token]);

  useEffect(() => {
    if (visible) {
      reset();
      void load();
    }
  }, [visible, load, reset]);

  const canGenerate = !!productId && !!scene.trim() && phase === 'config';

  const generate = async () => {
    if (!canGenerate) return;
    if (credits !== null && model && credits < model.credits) {
      setNote(`You need ${model.credits} credits for a ${model.label} short — you have ${credits}.`);
      return;
    }
    setPhase('generating');
    setNote(null);
    try {
      const res = await fetch(apiUrl('/api/creator/scene-video'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ productId, scene: scene.trim(), aspectRatio: aspect, target, model: modelKey }),
      });
      const d = (await res.json()) as { videoUrl?: string; aspectRatio?: '9:16' | '16:9'; error?: string; needed?: number; balance?: number };
      if (res.status === 402) {
        setCredits(d.balance ?? credits);
        setNote(`Not enough credits — this short costs ${d.needed ?? model?.credits}.`);
        setPhase('config');
        return;
      }
      if (res.status === 429) {
        setNote('Slow down a moment — shorts are rate-limited. Try again shortly.');
        setPhase('config');
        return;
      }
      if (!res.ok || !d.videoUrl) throw new Error(d.error ?? 'failed');
      setResult({ videoUrl: d.videoUrl, aspect: d.aspectRatio ?? aspect });
      setPhase('done');
      if (typeof model?.credits === 'number' && credits !== null) setCredits(credits - model.credits);
      onPublished?.();
    } catch {
      setNote('Could not make the short — your credits were not charged.');
      setPhase('config');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <ThemedText type="subtitle" style={styles.title} numberOfLines={1}>Make a scene short</ThemedText>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose} hitSlop={12}>
              <ThemedText type="code" style={styles.dim}>close ✕</ThemedText>
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator style={styles.center} color={pal.accent} />
          ) : !products.length ? (
            <View style={styles.center}>
              <ThemedText type="small" style={styles.dim}>No products with images yet — create a drop in Design first.</ThemedText>
            </View>
          ) : phase === 'generating' ? (
            <View style={styles.center}>
              <ActivityIndicator color={pal.accent} />
              <ThemedText type="subtitle" style={styles.white}>Filming your short…</ThemedText>
              <ThemedText type="small" style={styles.dim}>Venus is rendering an on-model scene and animating it with {model?.label}. This takes a few minutes — keep this open.</ThemedText>
            </View>
          ) : phase === 'done' && result ? (
            <ScrollView contentContainerStyle={styles.scroll}>
              <VideoPreview url={result.videoUrl} aspect={result.aspect} />
              <ThemedText type="smallBold" style={styles.green}>
                Published to {target === 'feed' ? 'the Nano Crew feed' : 'your website'} ✓
              </ThemedText>
              <ThemedText type="small" style={styles.dim}>
                {target === 'feed' ? 'It’s live on your product in the feed.' : 'It’s on your product’s on-model gallery (newest 3 kept).'}
              </ThemedText>
              <View style={styles.row}>
                <Pressable onPress={reset} style={styles.primaryBtn}>
                  <ThemedText type="smallBold" style={{ color: pal.onAccent }}>Make another</ThemedText>
                </Pressable>
                <Pressable onPress={onClose} hitSlop={8}>
                  <ThemedText type="code" style={styles.dim}>done</ThemedText>
                </Pressable>
              </View>
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
              {/* Product */}
              <ThemedText type="code" style={styles.sectionLabel}>PRODUCT</ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbRow}>
                {products.map((p) => (
                  <Pressable key={p.id} onPress={() => setProductId(p.id)} style={[styles.thumbWrap, productId === p.id && styles.thumbOn]}>
                    {p.imageUrl ? <Image source={{ uri: p.imageUrl }} style={styles.thumb} contentFit="cover" /> : <View style={styles.thumb} />}
                  </Pressable>
                ))}
              </ScrollView>

              {/* Scene */}
              <ThemedText type="code" style={styles.sectionLabel}>SCENE</ThemedText>
              <View style={styles.chipWrap}>
                {SCENES.map((s, i) => (
                  <Pressable key={s} onPress={() => setScene(s)} style={[styles.chip, scene === s && styles.chipOn]}>
                    <ThemedText type="code" style={scene === s ? styles.chipTextOn : styles.chipText}>{SCENE_LABELS[i]}</ThemedText>
                  </Pressable>
                ))}
              </View>
              <TextInput
                style={styles.input}
                placeholder="…or describe your own scene"
                placeholderTextColor={pal.dim}
                value={scene}
                onChangeText={setScene}
              />

              {/* Format */}
              <ThemedText type="code" style={styles.sectionLabel}>FORMAT</ThemedText>
              <View style={styles.toggleRow}>
                {(['9:16', '16:9'] as const).map((a) => (
                  <Pressable key={a} onPress={() => setAspect(a)} style={[styles.toggle, aspect === a && styles.toggleOn]}>
                    <ThemedText type="code" style={aspect === a ? styles.chipTextOn : styles.chipText}>{a === '9:16' ? '9:16 · Mobile' : '16:9 · Desktop'}</ThemedText>
                  </Pressable>
                ))}
              </View>

              {/* Quality / model tier */}
              <ThemedText type="code" style={styles.sectionLabel}>QUALITY</ThemedText>
              <View style={styles.toggleRow}>
                {models.map((m) => (
                  <Pressable key={m.key} onPress={() => setModelKey(m.key)} style={[styles.tier, modelKey === m.key && styles.toggleOn]}>
                    <ThemedText type="code" style={modelKey === m.key ? styles.chipTextOn : styles.chipText}>{m.label}</ThemedText>
                    <ThemedText type="code" style={modelKey === m.key ? styles.tierCreditsOn : styles.tierCredits}>{m.credits} cr · {m.durationSec}s</ThemedText>
                  </Pressable>
                ))}
              </View>
              {model ? <ThemedText type="small" style={styles.dim}>{model.blurb}</ThemedText> : null}

              {/* Target — the social feed is hidden for v1, so scene shorts post to the website
                  (the on-model gallery). The feed target returns in v2. `target` stays 'website'. */}

              {note ? <ThemedText type="small" style={styles.warn}>{note}</ThemedText> : null}

              <Pressable onPress={generate} disabled={!canGenerate} style={[styles.primaryBtn, !canGenerate && { opacity: 0.4 }]}>
                <ThemedText type="smallBold" style={{ color: pal.onAccent }}>
                  Generate · {model?.credits ?? ''} credits
                </ThemedText>
              </Pressable>
              {credits !== null ? <ThemedText type="code" style={[styles.dim, { textAlign: 'center' }]}>balance: {credits} credits</ThemedText> : null}
            </ScrollView>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function makeStyles(pal: StudioPalette) {
  return StyleSheet.create({
    fill: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
    sheet: { flex: 1, marginTop: Spacing.six, backgroundColor: pal.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: pal.line, overflow: 'hidden' },
    headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.four, paddingVertical: Spacing.four },
    title: { color: pal.ink, fontFamily: 'Jost-Light' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.six },
    scroll: { padding: Spacing.four, gap: Spacing.two, paddingBottom: Spacing.six },
    sectionLabel: { color: pal.accent, letterSpacing: 1.5, fontSize: 11, marginTop: Spacing.three },
    thumbRow: { gap: Spacing.two, paddingVertical: Spacing.one },
    thumbWrap: { borderRadius: 12, borderWidth: 2, borderColor: 'transparent', padding: 2 },
    thumbOn: { borderColor: pal.accent },
    thumb: { width: 64, height: 64, borderRadius: 10, backgroundColor: pal.surface },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
    chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: 999, borderWidth: 1, borderColor: pal.line },
    chipOn: { backgroundColor: pal.accent, borderColor: pal.accent },
    chipText: { color: pal.dim, fontSize: 12 },
    chipTextOn: { color: pal.onAccent, fontSize: 12 },
    input: { borderWidth: 1, borderColor: pal.line, backgroundColor: pal.field, borderRadius: 10, padding: Spacing.three, color: pal.ink, fontSize: 15, marginTop: Spacing.one },
    toggleRow: { flexDirection: 'row', gap: Spacing.two },
    toggle: { flex: 1, alignItems: 'center', paddingVertical: Spacing.three, borderRadius: 12, borderWidth: 1, borderColor: pal.line },
    toggleOn: { backgroundColor: pal.accent, borderColor: pal.accent },
    tier: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: Spacing.three, paddingHorizontal: Spacing.one, borderRadius: 12, borderWidth: 1, borderColor: pal.line },
    tierCredits: { color: pal.dim, fontSize: 10 },
    tierCreditsOn: { color: pal.onAccent, fontSize: 10, opacity: 0.85 },
    primaryBtn: { backgroundColor: pal.accent, borderRadius: 10, paddingVertical: Spacing.three, paddingHorizontal: Spacing.four, alignItems: 'center', marginTop: Spacing.three },
    row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four, marginTop: Spacing.two },
    white: { color: pal.ink, textAlign: 'center' },
    dim: { color: pal.dim },
    green: { color: pal.accent },
    warn: { color: pal.warn },
  });
}
