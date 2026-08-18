import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EveCaptions, EveEar } from '@/components/eve/eve-ear';
import { ThemedText } from '@/components/themed-text';
import { usePalette } from '@/components/nc-screen';
import { glow } from '@/constants/glow';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { apiUrl } from '@/lib/api';
import { armNextTurn } from '@/lib/eve-edit-bus';
import { recentTranscript } from '@/lib/eve-transcript-bus';
import { sayEve } from '@/lib/eve-say-bus';
import { showEve } from '@/lib/eve-vision-bus';

// EVE'S SITE-ASSETS PIPELINE — the ASSETS spoke, voice-first like the DESIGN spoke (Joe,
// 2026-08-18: "update the site assets button on the wheel to act more like the design button").
// No Design-tab redirect, ever: pick the spot (hero / logo / social) → she asks enhance-or-as-is
// → generate with slot-appropriate framing → the same review tools → SET IT ON THE SITE
// (/api/creator/site-assets, a direct DB write + storefront revalidate). She stays live throughout.

const BG = '#08080a';

type SlotKey = 'hero' | 'logo' | 'mark' | 'favicon' | 'og';
const SLOTS: Record<SlotKey, { label: string; desc: string; aspectRatio: string; background: 'transparent' | 'filled' }> = {
  hero: { label: 'Website hero', desc: 'the big image at the top of the site', aspectRatio: '16:9', background: 'filled' },
  logo: { label: 'Wordmark', desc: 'the wide logo (header + footer)', aspectRatio: '16:9', background: 'transparent' },
  mark: { label: 'App icon', desc: 'the square mark — favicon, app tile, avatar', aspectRatio: '1:1', background: 'transparent' },
  favicon: { label: 'Favicon', desc: 'the little browser-tab icon', aspectRatio: '1:1', background: 'transparent' },
  og: { label: 'Social card', desc: 'the preview card when the site is shared', aspectRatio: '16:9', background: 'filled' },
};

type Step = 'slot' | 'style' | 'busy' | 'review' | 'done' | 'error';
type Design = { id: string; url: string; prompt: string };

export function EveAssets({
  idea,
  slot: slotProp,
  storeSlug,
  onExit,
}: {
  /** The concept to make (from the routed spoken intent). */
  idea?: string;
  /** Which site spot, when they already named it ("new hero for my site"). */
  slot?: SlotKey;
  /** The brand's store; falls back to the creator's first store. */
  storeSlug?: string;
  /** Back to Eve's home state. */
  onExit: () => void;
}) {
  const insets = useSafeAreaInsets();
  const p = usePalette();
  const { session } = useAuth();
  const token = session?.access_token;

  const [slot, setSlot] = useState<SlotKey | null>(slotProp ?? null);
  const [step, setStep] = useState<Step>(slotProp ? 'style' : 'slot');
  const [design, setDesign] = useState<Design | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const catalogueRef = useRef<string | null>(null);
  const slugRef = useRef<string | null>(storeSlug ?? null);

  const authHeaders = useCallback(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token],
  );

  // The generated graphic still lives in a catalogue (that's where designs persist); the SITE
  // assignment is by storeSlug. Resolve both up front, quietly.
  const resolveHomes = useCallback(async () => {
    try {
      if (!slugRef.current) {
        const r = await fetch(apiUrl('/api/me'), { headers: authHeaders() });
        const d = (await r.json().catch(() => ({}))) as { stores?: { slug: string }[] };
        slugRef.current = d.stores?.[0]?.slug ?? null;
      }
      if (!catalogueRef.current) {
        const r = await fetch(apiUrl('/api/catalogues'), { headers: authHeaders() });
        const d = (await r.json().catch(() => ({}))) as { catalogues?: { id: string }[] };
        let id = d.catalogues?.[0]?.id;
        if (!id) {
          const c = await fetch(apiUrl('/api/catalogues'), { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name: 'Designs' }) });
          const cd = (await c.json().catch(() => ({}))) as { catalogue?: { id: string } };
          id = cd.catalogue?.id;
        }
        catalogueRef.current = id ?? null;
      }
    } catch {
      /* surfaced when generate/assign actually needs them */
    }
  }, [authHeaders]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void resolveHomes();
    sayEve(
      slotProp
        ? `(Their site-graphic surface just opened for the ${SLOTS[slotProp].label.toLowerCase()} — in ONE short sentence, ask if you should enhance the idea first or make it exactly as said.)`
        : '(Their site-graphic surface just opened — in ONE short sentence, ask which spot this is for: the hero banner, the wordmark, the app icon, or the social card.)',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const failFrom = (status: number, d: { error?: string; needed?: number }): string => {
    if (status === 402) return `Not enough credits${d.needed ? ` — need ${d.needed}` : ''}. Top up in Account.`;
    if (status === 401) return 'Sign in to create graphics.';
    return d.error || 'That didn’t work — try rephrasing.';
  };

  const generate = useCallback(
    async (prompt: string) => {
      if (!token || !slot) return;
      setStep('busy');
      setError(null);
      await resolveHomes();
      const cfg = SLOTS[slot];
      try {
        const r = await fetch(apiUrl('/api/generate'), {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            prompt,
            catalogueId: catalogueRef.current,
            background: cfg.background,
            aspectRatio: cfg.aspectRatio,
          }),
        });
        const d = (await r.json().catch(() => ({}))) as { image?: string; id?: string; error?: string; needed?: number };
        if (!r.ok || !d.image || !d.id) throw new Error(failFrom(r.status, d));
        const made = { id: d.id, url: d.image, prompt };
        setDesign(made);
        setStep('review');
        showEve({
          url: made.url,
          note: `(This is the ${cfg.label.toLowerCase()} you just made from: "${prompt}". You can SEE it — react in one short sentence, then ask if it should go on the site or if they want another take.)`,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Generation failed');
        setStep(design ? 'review' : 'error');
      }
    },
    [token, slot, authHeaders, resolveHomes, design],
  );

  const applyEdit = useCallback(
    async (instruction: string) => {
      if (!design || !token || !slot) return;
      setStep('busy');
      setError(null);
      try {
        const r = await fetch(apiUrl('/api/edit'), {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            designId: design.id,
            catalogueId: catalogueRef.current,
            instruction,
            mode: 'custom',
            background: SLOTS[slot].background,
          }),
        });
        const d = (await r.json().catch(() => ({}))) as { image?: string; id?: string; error?: string; needed?: number };
        if (!r.ok || !d.image || !d.id) throw new Error(failFrom(r.status, d));
        setDesign({ id: d.id, url: d.image, prompt: design.prompt });
        setStep('review');
        showEve({ url: d.image, note: `(They asked for: "${instruction}". This is the RESULT — react in one short sentence.)` });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Edit failed');
        setStep('review');
      }
    },
    [design, token, slot, authHeaders],
  );

  const CLEANUP =
    'Clean up and refine this graphic: remove stray lines, specks and artifacts, smooth ragged or noisy outlines, sharpen intended edges, and improve colour separation. Do NOT change the composition, elements, style or any text.';

  const [listeningForEdit, setListeningForEdit] = useState(false);
  const disarmRef = useRef<(() => void) | null>(null);
  const tellEve = useCallback(() => {
    if (listeningForEdit) {
      disarmRef.current?.();
      setListeningForEdit(false);
      return;
    }
    setListeningForEdit(true);
    sayEve('(They tapped "Tell Eve" on their graphic — in a few words, ask what to change. Their NEXT sentence is applied to the artwork directly.)');
    disarmRef.current = armNextTurn((turn) => {
      setListeningForEdit(false);
      void applyEdit(turn);
    });
  }, [listeningForEdit, applyEdit]);
  useEffect(() => () => disarmRef.current?.(), []);

  const enhanceAndGenerate = useCallback(async () => {
    if (!idea || !slot) return;
    setStep('busy');
    try {
      const r = await fetch(apiUrl('/api/enhance'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ prompt: `${idea} — for the brand website's ${SLOTS[slot].label.toLowerCase()}`, context: recentTranscript() }),
      });
      const d = (await r.json().catch(() => ({}))) as { enhanced?: string };
      await generate(d.enhanced?.trim() || idea);
    } catch {
      await generate(idea);
    }
  }, [idea, slot, authHeaders, generate]);

  // SET IT ON THE SITE — the direct write (never the forge), then the storefront revalidates.
  const assign = useCallback(async () => {
    if (!design || !slot || assigning) return;
    setAssigning(true);
    setError(null);
    await resolveHomes();
    try {
      if (!slugRef.current) throw new Error('No store to assign to yet.');
      const r = await fetch(apiUrl('/api/creator/site-assets'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ storeSlug: slugRef.current, slot, url: design.url }),
      });
      const d = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) throw new Error(d.error ?? 'Could not set it on the site');
      setStep('done');
      sayEve(`(The new ${SLOTS[slot].label.toLowerCase()} is LIVE on their site — one warm sentence.)`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set it on the site');
    } finally {
      setAssigning(false);
    }
  }, [design, slot, assigning, authHeaders, resolveHomes]);

  return (
    <View style={[styles.fill, { paddingTop: insets.top + Spacing.four, paddingBottom: insets.bottom + Spacing.three }]}>
      <EveCaptions />
      <View style={styles.headerRow}>
        <EveEar />
        <View style={styles.flex} />
        <Pressable onPress={onExit} hitSlop={10} accessibilityLabel="Back to Eve">
          <ThemedText type="code" style={{ color: p.dim, fontSize: 14 }}>‹ back</ThemedText>
        </Pressable>
      </View>

      {/* 1 — which spot on the site (she asks aloud; these blocks are the answer). */}
      {step === 'slot' ? (
        <View style={styles.stage}>
          <View style={styles.avatarWindow} />
          {idea ? <ThemedText style={[styles.line, { color: p.ink }]}>“{idea}”</ThemedText> : null}
          <View style={styles.slotCol}>
            {(Object.keys(SLOTS) as SlotKey[]).map((k) => (
              <Pressable
                key={k}
                onPress={() => {
                  setSlot(k);
                  setStep('style');
                  sayEve(`(They picked the ${SLOTS[k].label.toLowerCase()}. Ask ONE short question: enhance the idea first, or make it exactly as said?)`);
                }}
                style={[styles.slotCard, { borderColor: `${p.dim}55` }]}
                hitSlop={4}>
                <ThemedText type="smallBold" style={{ color: p.ink }}>{SLOTS[k].label}</ThemedText>
                <ThemedText type="small" style={{ color: p.dim }}>{SLOTS[k].desc}</ThemedText>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {/* 2 — enhance or as-is. */}
      {step === 'style' && slot ? (
        <View style={styles.stage}>
          <View style={styles.avatarWindow} />
          <ThemedText style={[styles.line, { color: p.ink }]}>“{idea ?? SLOTS[slot].label}”</ThemedText>
          <ThemedText type="small" style={{ color: p.dim }}>for the {SLOTS[slot].label.toLowerCase()}</ThemedText>
          <View style={styles.actions}>
            <Pressable onPress={() => void enhanceAndGenerate()} style={[styles.action, styles.actionPrimary, { backgroundColor: p.accent }, glow(p.accent, 12, 0.4)]} hitSlop={6}>
              <ThemedText type="smallBold" style={{ color: BG }}>✦ Enhance it</ThemedText>
            </Pressable>
            <Pressable onPress={() => idea && void generate(idea)} style={[styles.action, { borderColor: `${p.dim}66` }]} hitSlop={6}>
              <ThemedText type="code" style={{ color: p.ink }}>Make as-is</ThemedText>
            </Pressable>
          </View>
        </View>
      ) : null}

      {step === 'busy' ? (
        <View style={styles.stage}>
          <View style={styles.avatarWindow} />
          <ActivityIndicator color="#dff4ff" />
        </View>
      ) : null}

      {/* 3 — review with the same tools, then set it live. */}
      {step === 'review' && design && slot ? (
        <>
          <View style={styles.stage}>
            <Image source={{ uri: design.url }} style={styles.image} contentFit="contain" />
          </View>
          {error ? <ThemedText type="code" style={styles.error} numberOfLines={2}>{error}</ThemedText> : null}
          <View style={styles.actions}>
            <Pressable onPress={() => void applyEdit(CLEANUP)} style={[styles.action, { borderColor: `${p.dim}66` }]} hitSlop={6}>
              <ThemedText type="code" style={{ color: p.ink }}>✦ Clean up</ThemedText>
            </Pressable>
            <Pressable onPress={tellEve} style={[styles.action, listeningForEdit ? { borderColor: p.accent, backgroundColor: `${p.accent}22` } : { borderColor: `${p.dim}66` }]} hitSlop={6}>
              <ThemedText type="code" style={{ color: listeningForEdit ? p.accent : p.ink }}>{listeningForEdit ? '🎙 Listening…' : '🎙 Tell Eve'}</ThemedText>
            </Pressable>
            <Pressable onPress={() => design && void generate(design.prompt)} style={[styles.action, { borderColor: `${p.dim}66` }]} hitSlop={6}>
              <ThemedText type="code" style={{ color: p.dim }}>↻ Redo</ThemedText>
            </Pressable>
          </View>
          <View style={styles.actions}>
            <Pressable onPress={() => void assign()} disabled={assigning} style={[styles.action, styles.actionPrimary, { backgroundColor: p.accent, opacity: assigning ? 0.6 : 1 }, glow(p.accent, 12, 0.4)]} hitSlop={6}>
              {assigning ? (
                <ActivityIndicator color={BG} size="small" />
              ) : (
                <ThemedText type="smallBold" style={{ color: BG }}>Set as {SLOTS[slot].label.toLowerCase()} ›</ThemedText>
              )}
            </Pressable>
          </View>
        </>
      ) : null}

      {/* 4 — live. */}
      {step === 'done' && slot ? (
        <View style={styles.stage}>
          {design ? <Image source={{ uri: design.url }} style={styles.doneImage} contentFit="contain" /> : null}
          <ThemedText style={[styles.line, { color: p.ink }]}>It’s live — your site’s {SLOTS[slot].label.toLowerCase()} is updated.</ThemedText>
          <Pressable onPress={onExit} style={[styles.action, styles.actionPrimary, { backgroundColor: p.accent }, glow(p.accent, 12, 0.4)]} hitSlop={6}>
            <ThemedText type="smallBold" style={{ color: BG }}>Done</ThemedText>
          </Pressable>
        </View>
      ) : null}

      {step === 'error' ? (
        <View style={styles.stage}>
          <ThemedText type="code" style={styles.error} numberOfLines={3}>{error ?? 'Something went wrong.'}</ThemedText>
          <Pressable onPress={onExit} style={[styles.action, { borderColor: `${p.dim}66` }]} hitSlop={6}>
            <ThemedText type="code" style={{ color: p.dim }}>‹ Back to Eve</ThemedText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, paddingHorizontal: Spacing.four },
  flex: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, marginVertical: Spacing.three },
  avatarWindow: { width: 160, height: 160 },
  slotCol: { alignSelf: 'stretch', gap: Spacing.two },
  slotCard: { borderWidth: 1, borderRadius: 14, paddingVertical: Spacing.three, paddingHorizontal: Spacing.four, gap: 2 },
  image: { width: '100%', height: '78%' },
  doneImage: { width: '80%', height: '45%' },
  line: { fontSize: 16, lineHeight: 22, fontFamily: 'Jost-Regular', textAlign: 'center' },
  error: { color: '#ff8a8a', marginTop: 4, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  action: { flex: 1, borderWidth: 1, borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  actionPrimary: { borderWidth: 0 },
});
