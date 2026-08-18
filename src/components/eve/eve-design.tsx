import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FinalizeSheet } from '@/components/designer/FinalizeSheet';
import { PlacementEditor } from '@/components/designer/PlacementEditor';
import { ProductPicker } from '@/components/designer/ProductPicker';
import { EveCaptions, EveEar } from '@/components/eve/eve-ear';
import { ThemedText } from '@/components/themed-text';
import { usePalette } from '@/components/nc-screen';
import { glow } from '@/constants/glow';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { apiFetch, apiUrl, readJson } from '@/lib/api';
import { armNextTurn } from '@/lib/eve-edit-bus';
import { recentTranscript } from '@/lib/eve-transcript-bus';
import { sayEve } from '@/lib/eve-say-bus';
import { showEve } from '@/lib/eve-vision-bus';
import type { CatalogBlank } from '@/lib/printful';

// EVE'S DESIGN PIPELINE — voice-first, product-first, START to FINISH inside her tab (Joe's
// california-flag-tee walkthrough, 2026-08-17):
//   idea (spoken, routed here) → ProductPicker modal (pick the actual product) → she asks
//   "enhance or as-is?" → generate a print-ready graphic → approve → PlacementEditor →
//   FinalizeSheet (pricing) → PUBLISHED to the catalogue + live site. No redirects, ever —
//   the Design tab is one tap away for hand-editing; Eve finishes what she starts.
//
// She stays LIVE underneath (the overlay renders over EveHome): her cues go out on the say-bus
// (she ASKS at each fork) and every settled image goes to her eyes on the vision bus.

const BG = '#08080a';
const GENERATE_COST = 8; // display mirror of CREDIT_COSTS.design_generate (server is source of truth)

type Step = 'loading' | 'pick' | 'style' | 'busy' | 'review' | 'place' | 'finalize' | 'done' | 'error';
type Design = { id: string; url: string; prompt: string };

export function EveDesign({
  idea,
  onExit,
}: {
  /** The concept to make (from the routed spoken intent). */
  idea?: string;
  /** Back to Eve's home state. */
  onExit: () => void;
}) {
  const insets = useSafeAreaInsets();
  const p = usePalette();
  const { session } = useAuth();
  const token = session?.access_token;

  const [step, setStep] = useState<Step>('loading');
  const [blanks, setBlanks] = useState<CatalogBlank[]>([]);
  const [blanksError, setBlanksError] = useState(false);
  const [blank, setBlank] = useState<CatalogBlank | null>(null);
  const [design, setDesign] = useState<Design | null>(null);
  const [compositionId, setCompositionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const catalogueRef = useRef<string | null>(null);

  const authHeaders = useCallback(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token],
  );

  // Resolve the collection to persist into: the primary store's first catalogue, or create "Designs".
  const resolveCatalogue = useCallback(async (): Promise<string | null> => {
    if (catalogueRef.current) return catalogueRef.current;
    try {
      const r = await fetch(apiUrl('/api/catalogues'), { headers: authHeaders() });
      const d = (await r.json().catch(() => ({}))) as { catalogues?: { id: string }[] };
      let id = d.catalogues?.[0]?.id;
      if (!id) {
        const c = await fetch(apiUrl('/api/catalogues'), { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name: 'Designs' }) });
        const cd = (await c.json().catch(() => ({}))) as { catalogue?: { id: string } };
        id = cd.catalogue?.id;
      }
      catalogueRef.current = id ?? null;
      return catalogueRef.current;
    } catch {
      return null;
    }
  }, [authHeaders]);

  const loadBlanks = useCallback(() => {
    setBlanksError(false);
    return apiFetch('/api/blanks')
      .then(readJson<{ blanks?: CatalogBlank[] }>)
      .then((d) => {
        if (d.blanks?.length) { setBlanks(d.blanks); setStep('pick'); }
        else setBlanksError(true);
      })
      .catch(() => setBlanksError(true));
  }, []);

  // Open: catalogue + the product catalogue, straight into the picker. She narrates the fork.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void resolveCatalogue();
    void loadBlanks();
    sayEve('(Their design surface just opened with the product catalogue — in ONE short sentence, tell them to pick the product this goes on.)');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const failFrom = (status: number, d: { error?: string; needed?: number }): string => {
    if (status === 402) return `Not enough credits${d.needed ? ` — need ${d.needed}` : ''}. Top up in Account.`;
    if (status === 401) return 'Sign in to create designs.';
    return d.error || 'That didn’t work — try rephrasing.';
  };

  const generate = useCallback(
    async (prompt: string) => {
      if (!token) { setError('Sign in to create designs.'); setStep('error'); return; }
      setStep('busy');
      setError(null);
      const catalogueId = await resolveCatalogue();
      try {
        const r = await fetch(apiUrl('/api/generate'), {
          method: 'POST',
          headers: authHeaders(),
          // 'transparent' = the chroma-key pipeline: a print-ready cutout graphic, never a photo
          // OF the product (the Design tab's product default).
          body: JSON.stringify({ prompt, catalogueId, background: 'transparent', aspectRatio: '1:1' }),
        });
        const d = (await r.json().catch(() => ({}))) as { image?: string; id?: string; error?: string; needed?: number };
        if (!r.ok || !d.image || !d.id) throw new Error(failFrom(r.status, d));
        const made = { id: d.id, url: d.image, prompt };
        setDesign(made);
        setStep('review');
        showEve({
          url: made.url,
          note: `(This is the design you just made from: "${prompt}". You can SEE it — react in one short sentence, then ask if they want it placed on the ${blank?.name ?? 'product'} or another take.)`,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Generation failed');
        setStep(design ? 'review' : 'error');
      }
    },
    [token, authHeaders, resolveCatalogue, blank?.name, design],
  );

  /** Apply an edit instruction to the CURRENT design via /api/edit (custom mode, die-cut gated). */
  const applyEdit = useCallback(
    async (instruction: string) => {
      if (!design || !token) return;
      setStep('busy');
      setError(null);
      try {
        const r = await fetch(apiUrl('/api/edit'), {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ designId: design.id, catalogueId: catalogueRef.current, instruction, mode: 'custom', background: 'transparent' }),
        });
        const d = (await r.json().catch(() => ({}))) as { image?: string; id?: string; error?: string; needed?: number };
        if (!r.ok || !d.image || !d.id) throw new Error(failFrom(r.status, d));
        const made = { id: d.id, url: d.image, prompt: design.prompt };
        setDesign(made);
        setStep('review');
        showEve({ url: made.url, note: `(They asked for: "${instruction}". This is the RESULT — react in one short sentence.)` });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Edit failed');
        setStep('review');
      }
    },
    [design, token, authHeaders],
  );

  // ◐ Feather — deterministic edge soften (no AI, no credits); the design updates in place.
  const feather = useCallback(async () => {
    if (!design || !token) return;
    setStep('busy');
    try {
      const r = await fetch(apiUrl('/api/creator/design-feather'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ designId: design.id }),
      });
      const d = (await r.json().catch(() => ({}))) as { image?: string; error?: string };
      if (!r.ok || !d.image) throw new Error(d.error ?? 'Feather failed');
      setDesign({ ...design, url: d.image });
      setStep('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Feather failed');
      setStep('review');
    }
  }, [design, token, authHeaders]);

  // ✦ Clean up — the canned refinement pass (stray lines, ragged edges, artifacts).
  const CLEANUP =
    'Clean up and refine this print graphic: remove stray lines, specks and artifacts, smooth ragged or noisy outlines, sharpen intended edges, and improve colour separation. Do NOT change the composition, elements, style or any text.';

  // 🎙 Tell Eve — the NEXT thing they say is the edit. She acknowledges aloud; the utterance
  // routes here instead of the intent router (eve-edit-bus).
  const [listeningForEdit, setListeningForEdit] = useState(false);
  const disarmRef = useRef<(() => void) | null>(null);
  const tellEve = useCallback(() => {
    if (listeningForEdit) {
      disarmRef.current?.();
      setListeningForEdit(false);
      return;
    }
    setListeningForEdit(true);
    sayEve('(They tapped "Tell Eve" on their design — in a few words, ask what to change. Their NEXT sentence is applied to the artwork directly.)');
    disarmRef.current = armNextTurn((turn) => {
      setListeningForEdit(false);
      void applyEdit(turn);
    });
  }, [listeningForEdit, applyEdit]);
  useEffect(() => () => disarmRef.current?.(), []);

  // "Enhance" = enrich the idea in the brand voice first (free, rate-limited), then generate.
  const enhanceAndGenerate = useCallback(async () => {
    if (!idea) return;
    setStep('busy');
    try {
      const r = await fetch(apiUrl('/api/enhance'), {
        method: 'POST',
        headers: authHeaders(),
        // Fold in the conversation: her riffs ("I'd do neon sunglasses") become part of the
        // design when they hit ✦ Enhance (Joe, 2026-08-17 — as-is stays literal on purpose).
        body: JSON.stringify({ prompt: idea, context: recentTranscript() }),
      });
      const d = (await r.json().catch(() => ({}))) as { enhanced?: string };
      await generate(d.enhanced?.trim() || idea);
    } catch {
      await generate(idea);
    }
  }, [idea, authHeaders, generate]);

  // Approve → a composition on the chosen blank (front placement; the editor refines it).
  const toPlacement = useCallback(async () => {
    if (!design || !blank) return;
    setStep('busy');
    try {
      const r = await fetch(apiUrl('/api/compositions'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          catalogueId: catalogueRef.current,
          designId: design.id,
          templateKey: String(blank.id),
          placement: 'front',
        }),
      });
      const d = (await r.json().catch(() => ({}))) as { composition?: { id: string }; id?: string; error?: string };
      const id = d.composition?.id ?? d.id;
      if (!r.ok || !id) throw new Error(d.error ?? 'Could not stage the product');
      setCompositionId(id);
      setStep('place');
      sayEve('(The placement editor just opened — one short sentence: they can size and position the print, then hit Done.)');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not stage the product');
      setStep('review');
    }
  }, [design, blank, authHeaders]);

  const designOpts = design ? [{ id: design.id, prompt: design.prompt, image: design.url }] : [];
  const defaultName = (idea ?? design?.prompt ?? 'New drop').replace(/^make (me )?(a |an )?/i, '').slice(0, 60);

  return (
    <View style={[styles.fill, { paddingTop: insets.top + Spacing.four, paddingBottom: insets.bottom + Spacing.three }]}>
      <EveCaptions />
      <View style={styles.headerRow}>
        {/* Her presence IS the header — no surface label needed (Joe, 2026-08-17). */}
        <EveEar />
        <View style={styles.flex} />
        <Pressable onPress={onExit} hitSlop={10} accessibilityLabel="Back to Eve">
          <ThemedText type="code" style={{ color: p.dim, fontSize: 14 }}>‹ back</ThemedText>
        </Pressable>
      </View>

      {/* 1 — pick the product (the catalogue modal, single pick). */}
      {step === 'pick' || step === 'loading' ? (
        <ProductPicker
          visible
          blanks={blanks}
          loading={step === 'loading' && !blanksError}
          error={blanksError}
          onRetry={() => void loadBlanks()}
          onClose={onExit}
          badge={<EveEar />}
          captions={<EveCaptions />}
          onAdd={(sel) => {
            const chosen = sel[0];
            if (!chosen) return;
            setBlank(chosen);
            setStep('style');
            sayEve(`(They picked the ${chosen.name}. Ask ONE short question: should you enhance the idea first, or print it as-is?)`);
          }}
        />
      ) : null}

      {/* 2 — enhance or as-is (she asks aloud; these are the answer). */}
      {step === 'style' ? (
        <View style={styles.stage}>
          {/* The REAL Eve glows through from the root behind this overlay — no stand-in orb. */}
          <View style={styles.avatarWindow} />
          <ThemedText style={[styles.line, { color: p.ink }]}>“{idea}”</ThemedText>
          <ThemedText type="small" style={{ color: p.dim }}>on the {blank?.name}</ThemedText>
          <View style={styles.actions}>
            <Pressable onPress={() => void enhanceAndGenerate()} style={[styles.action, styles.actionPrimary, { backgroundColor: p.accent }, glow(p.accent, 12, 0.4)]} hitSlop={6}>
              <ThemedText type="smallBold" style={{ color: BG }}>✦ Enhance it</ThemedText>
            </Pressable>
            <Pressable onPress={() => idea && void generate(idea)} style={[styles.action, { borderColor: `${p.dim}66` }]} hitSlop={6}>
              <ThemedText type="code" style={{ color: p.ink }}>Print as-is</ThemedText>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* 3 — generating. */}
      {step === 'busy' ? (
        <View style={styles.stage}>
          {/* She's visible through the overlay; just the working indicator down here. */}
          <View style={styles.avatarWindow} />
          <ActivityIndicator color="#dff4ff" />
        </View>
      ) : null}

      {/* 4 — the design, approve or retake. */}
      {step === 'review' && design ? (
        <>
          <View style={styles.stage}>
            <Image source={{ uri: design.url }} style={styles.image} contentFit="contain" />
          </View>
          {error ? <ThemedText type="code" style={styles.error} numberOfLines={2}>{error}</ThemedText> : null}
          {/* Editor tools — the design-center's engine (/api/edit), Eve-flavoured. */}
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
            <Pressable onPress={() => void feather()} style={[styles.action, { borderColor: `${p.dim}66` }]} hitSlop={6}>
              <ThemedText type="code" style={{ color: p.ink }}>◐ Feather edges</ThemedText>
            </Pressable>
          </View>
          <View style={styles.actions}>
            <Pressable onPress={() => void toPlacement()} style={[styles.action, styles.actionPrimary, { backgroundColor: p.accent }, glow(p.accent, 12, 0.4)]} hitSlop={6}>
              <ThemedText type="smallBold" style={{ color: BG }}>Put it on the {blank?.type?.replace(/s$/, '') ?? 'product'} ›</ThemedText>
            </Pressable>
          </View>
        </>
      ) : null}

      {/* 5 — size & placement (the design center's editor, reused as-is). */}
      {step === 'place' && compositionId && blank ? (
        <PlacementEditor
          compositionId={compositionId}
          templateKey={String(blank.id)}
          designs={designOpts}
          badge={<EveEar />}
          captions={<EveCaptions />}
          onClose={() => {
            setStep('finalize');
            sayEve('(Placement is set — one short sentence: name and price look good on this sheet, then it goes live.)');
          }}
          onPreview={() => {}}
        />
      ) : null}

      {/* 6 — price + publish (the design center's finalize sheet, reused as-is). */}
      {step === 'finalize' && compositionId && blank ? (
        <FinalizeSheet
          compositionId={compositionId}
          templateKey={String(blank.id)}
          defaultName={defaultName}
          designs={designOpts}
          badge={<EveEar />}
          captions={<EveCaptions />}
          onClose={() => setStep('review')}
          onPublished={() => {
            setStep('done');
            sayEve('(It published! One warm sentence: the product is in their catalogue and live on their site — model photos are rendering now.)');
          }}
        />
      ) : null}

      {/* 7 — done. */}
      {step === 'done' ? (
        <View style={styles.stage}>
          {design ? <Image source={{ uri: design.url }} style={styles.doneImage} contentFit="contain" /> : null}
          <ThemedText style={[styles.line, { color: p.ink }]}>It’s live — in your catalogue and on your site.</ThemedText>
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
  // A see-through window where her real avatar (root GL, behind the overlay) reads as the subject.
  avatarWindow: { width: 200, height: 200 },
  image: { width: '100%', height: '78%' },
  doneImage: { width: '60%', height: '50%' },
  line: { fontSize: 16, lineHeight: 22, fontFamily: 'Jost-Regular', textAlign: 'center' },
  error: { color: '#ff8a8a', marginTop: 4, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  action: { flex: 1, borderWidth: 1, borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  actionPrimary: { borderWidth: 0 },
});
