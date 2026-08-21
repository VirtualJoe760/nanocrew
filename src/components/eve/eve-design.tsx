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
import { choosePhoto } from '@/lib/pick-photo';
import { recentTranscript } from '@/lib/eve-transcript-bus';
import { sayEve } from '@/lib/eve-say-bus';
import { showEve } from '@/lib/eve-vision-bus';
import type { CatalogBlank } from '@/lib/printful';
import { blankLabel, garmentNoun } from '@/lib/garment-noun';
import { techniqueInfo } from '@/lib/technique';

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

type Step = 'loading' | 'brand' | 'pick' | 'style' | 'busy' | 'review' | 'place' | 'finalize' | 'done' | 'error';
type Design = { id: string; url: string; prompt: string };

export function EveDesign({
  idea,
  storeSlug,
  brands,
  onExit,
}: {
  /** The concept to make (from the routed spoken intent). */
  idea?: string;
  /** The brand this design is FOR, when EveHome could resolve it (named brand, or a lone brand).
   *  Without it a multi-brand creator's /api/catalogues fallback is a 409, never a guess. */
  storeSlug?: string;
  /** The creator's brands — passed ONLY when the brand is still open, so this surface can ask
   *  with one tap instead of EveHome blocking the flow on a spoken answer (Joe, 2026-08-20:
   *  asking for a design produced a question instead of the apparel picker). */
  brands?: { slug: string; name: string }[];
  /** Back to Eve's home state. */
  onExit: () => void;
}) {
  const insets = useSafeAreaInsets();
  const p = usePalette();
  const { session } = useAuth();
  const token = session?.access_token;

  /** The brand actually in use: the resolved one, or whichever they tap in the brand step. */
  const [slug, setSlug] = useState<string | undefined>(storeSlug ?? (brands?.length === 1 ? brands[0].slug : undefined));
  const slugRef = useRef(slug);
  slugRef.current = slug;
  const [step, setStep] = useState<Step>('loading');
  const [blanks, setBlanks] = useState<CatalogBlank[]>([]);
  const [blanksError, setBlanksError] = useState(false);
  const [blank, setBlank] = useState<CatalogBlank | null>(null);
  const [design, setDesign] = useState<Design | null>(null);
  /** Inspiration photo (camera/library) riding the next generation as the image reference. */
  const [refImage, setRefImage] = useState<string | null>(null);
  const [compositionId, setCompositionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const catalogueRef = useRef<string | null>(null);

  const authHeaders = useCallback(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token],
  );

  // Resolve the collection to persist into: THIS brand's first catalogue, or create "Designs".
  // Always store-scoped — the slug-less fallback used to bind to the creator's oldest brand
  // (BUG_AUDIT_2026-08-20 #1); the server now 409s that instead of guessing.
  const resolveCatalogue = useCallback(async (): Promise<string | null> => {
    if (catalogueRef.current) return catalogueRef.current;
    try {
      const q = slug ? `?store=${encodeURIComponent(slug)}` : '';
      const r = await fetch(apiUrl(`/api/catalogues${q}`), { headers: authHeaders() });
      const d = (await r.json().catch(() => ({}))) as { catalogues?: { id: string }[] };
      let id = d.catalogues?.[0]?.id;
      if (!id) {
        const c = await fetch(apiUrl('/api/catalogues'), { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name: 'Designs', storeSlug: slug }) });
        const cd = (await c.json().catch(() => ({}))) as { catalogue?: { id: string } };
        id = cd.catalogue?.id;
      }
      catalogueRef.current = id ?? null;
      return catalogueRef.current;
    } catch {
      return null;
    }
  }, [authHeaders, slug]);

  const loadBlanks = useCallback(() => {
    setBlanksError(false);
    return apiFetch('/api/blanks')
      .then(readJson<{ blanks?: CatalogBlank[] }>)
      .then((d) => {
        if (d.blanks?.length) {
          setBlanks(d.blanks);
          // Brand first when it's still open — otherwise straight to the products, as before.
          setStep((cur) => (cur === 'loading' ? (slugRef.current ? 'pick' : 'brand') : cur));
        } else setBlanksError(true);
      })
      .catch(() => setBlanksError(true));
  }, []);

  // Open: catalogue + the product catalogue, straight into the picker. She narrates the fork.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (slug) void resolveCatalogue();
    void loadBlanks();
    // NO cue here (Joe, 2026-08-18): the routing line already said the idea back, announced the
    // catalogue and gave her one suggestion — a second utterance the moment the picker mounts is
    // exactly the talking-over that surfaced this. She's quiet while they browse (persona rule).
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
          // OF the product (the Design tab's product default). templateKey = the picked blank, so
          // an embroidered cap or knitted sweater gets art born producible (lib/technique.ts).
          // image = their inspiration photo, when they gave one (camera/library).
          body: JSON.stringify({ prompt, catalogueId, background: 'transparent', aspectRatio: '1:1', templateKey: blank?.id, image: refImage ?? undefined }),
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
    [token, authHeaders, resolveCatalogue, blank?.name, blank?.id, design, refImage],
  );

  /** Camera or photo library → the inspiration reference for the next generation. She sees it. */
  const addPhoto = useCallback(async () => {
    const url = await choosePhoto();
    if (!url) return;
    setRefImage(url);
    showEve({
      url,
      note: "(They just handed you an inspiration photo for this design — you can SEE it. React in one short sentence and say you'll fold it into the artwork.)",
    });
  }, []);

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
        // technique keeps the enhanced prompt inside what the blank can fabricate.
        body: JSON.stringify({ prompt: idea, context: recentTranscript(), technique: blank?.technique ?? undefined }),
      });
      const d = (await r.json().catch(() => ({}))) as { enhanced?: string };
      await generate(d.enhanced?.trim() || idea);
    } catch {
      await generate(idea);
    }
  }, [idea, authHeaders, generate, blank?.technique]);

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
      const d = (await r.json().catch(() => ({}))) as {
        composition?: { id: string };
        id?: string;
        adaptedDesign?: { id: string; url: string; prompt: string };
        technique?: string;
        error?: string;
      };
      const id = d.composition?.id ?? d.id;
      if (!r.ok || !id) throw new Error(d.error ?? 'Could not stage the product');
      if (d.adaptedDesign) {
        // Fabrication requirement (knitwear / embroidery): the server regenerated the art to what
        // the technique can produce, and the composition points at the NEW design row — swap to it
        // or the shared PlacementEditor renders blank tiles (BUG_AUDIT_2026-08-20 #4). Parity
        // with the tab's "Design adapted" alert: she SAYS it instead.
        const how = d.technique === 'EMBROIDERY' ? 'embroidered in stitched thread' : 'knitted from yarn';
        setDesign({ id: d.adaptedDesign.id, url: d.adaptedDesign.url, prompt: d.adaptedDesign.prompt });
        showEve({
          url: d.adaptedDesign.url,
          note: `(This product is ${how}, so the design was regenerated as bold flat fabrication-friendly art — this is the version that will be produced.)`,
        });
        sayEve(
          `(The placement editor just opened. In one warm sentence: this product is ${how}, so you remade their design as bold flat art that fabricates cleanly — the original is untouched — and they can size and position it now.)`,
        );
      } else {
        sayEve('(The placement editor just opened — one short sentence: they can size and position the print, then hit Done.)');
      }
      setCompositionId(id);
      setStep('place');
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

      {/* 0 — which brand? Only when EveHome couldn't resolve it (several brands, none named).
          One tap, then the product picker — the flow never waits on a spoken round trip. */}
      {step === 'brand' && brands?.length ? (
        <View style={styles.stage}>
          <View style={styles.avatarWindow} />
          {idea ? <ThemedText style={[styles.line, { color: p.ink }]}>“{idea}”</ThemedText> : null}
          <ThemedText type="small" style={{ color: p.dim }}>which brand is it for?</ThemedText>
          <View style={styles.actions}>
            {brands.map((b) => (
              <Pressable
                key={b.slug}
                onPress={() => {
                  setSlug(b.slug);
                  slugRef.current = b.slug;
                  void resolveCatalogue();
                  setStep('pick');
                  sayEve(`(They picked the brand "${b.name}". One SHORT line acknowledging it, then stop — the product catalogue is opening.)`);
                }}
                style={[styles.action, { borderColor: `${p.dim}66` }]}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Design for ${b.name}`}>
                <ThemedText type="code" style={{ color: p.ink }}>{b.name}</ThemedText>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {/* 1 — pick the product (the catalogue modal, single pick). */}
      {step === 'pick' || (step === 'loading' && !!slug) ? (
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
            // Surfaced technique awareness (Joe, 2026-08-20): when the blank is stitched or
            // knitted she SAYS so — the tab shows the same fact as a chip in the picker.
            const fab = techniqueInfo(chosen.technique)?.spoken;
            sayEve(
              `(They picked the ${chosen.name}.${fab ? ` First, in one natural clause, mention that ${fab} — you'll design for that.` : ''} Now RIFF on the idea with them — react in one short sentence with ONE build-on of your own, then ask if there's anything else they want in it. Keep building turn by turn; do NOT mention the enhance/as-is buttons until they say they're done — then one line: ✦ Enhance folds this whole conversation in, as-is stays literal. If they mention having a photo, a sketch, or wanting to snap a picture for inspiration, point them at the "Add a photo" button on screen.)`,
            );
          }}
        />
      ) : null}

      {/* 2 — enhance or as-is (she asks aloud; these are the answer). */}
      {step === 'style' ? (
        <View style={styles.stage}>
          {/* The REAL Eve glows through from the root behind this overlay — no stand-in orb. */}
          <View style={styles.avatarWindow} />
          <ThemedText style={[styles.line, { color: p.ink }]}>“{idea}”</ThemedText>
          <ThemedText type="small" style={{ color: p.dim }}>on the {blankLabel(blank?.name)}</ThemedText>
          <View style={styles.actions}>
            <Pressable onPress={() => void enhanceAndGenerate()} style={[styles.action, styles.actionPrimary, { backgroundColor: p.accent }, glow(p.accent, 12, 0.4)]} hitSlop={6}>
              <ThemedText type="smallBold" style={{ color: BG }}>✦ Enhance it</ThemedText>
            </Pressable>
            <Pressable onPress={() => idea && void generate(idea)} style={[styles.action, { borderColor: `${p.dim}66` }]} hitSlop={6}>
              <ThemedText type="code" style={{ color: p.ink }}>Print as-is</ThemedText>
            </Pressable>
          </View>
          {/* Inspiration photo (Joe, 2026-08-20): camera or library via the shared door
              (lib/pick-photo — the tab's Upload tile is the same). The photo rides the
              generation as /api/generate's `image` reference, and she SEES it. */}
          <View style={styles.actions}>
            <Pressable onPress={() => void addPhoto()} style={[styles.action, refImage ? { borderColor: p.accent, backgroundColor: `${p.accent}22` } : { borderColor: `${p.dim}66` }]} hitSlop={6}>
              <ThemedText type="code" style={{ color: refImage ? p.accent : p.ink }}>
                {refImage ? '📷 Photo added — tap to change' : '📷 Add a photo'}
              </ThemedText>
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
              <ThemedText type="smallBold" style={{ color: BG }}>Put it on the {garmentNoun(blank?.name)} ›</ThemedText>
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
            sayEve('(It published! One warm sentence: the product is in their catalogue now, their website is rebuilding itself and will show it in a couple of minutes, and model photos are rendering. Do NOT say it is already on the site — the rebuild takes a few minutes.)');
          }}
        />
      ) : null}

      {/* 7 — done. */}
      {step === 'done' ? (
        <View style={styles.stage}>
          {design ? <Image source={{ uri: design.url }} style={styles.doneImage} contentFit="contain" /> : null}
          {/* HONEST TIMING (BUG_AUDIT_2026-08-20 #1b): publish is instant in the catalogue, but the
              brand site does a full rebuild (~2–5 min) — saying "on your site" here made a creator
              file the delay as a broken publish. */}
          <ThemedText style={[styles.line, { color: p.ink }]}>It’s live in your catalogue — your site refreshes in a couple of minutes.</ThemedText>
          <View style={styles.actions}>
            <Pressable onPress={onExit} style={[styles.action, styles.actionPrimary, { backgroundColor: p.accent }, glow(p.accent, 12, 0.4)]} hitSlop={6}>
              <ThemedText type="smallBold" style={{ color: BG }}>Done</ThemedText>
            </Pressable>
          </View>
        </View>
      ) : null}

      {step === 'error' ? (
        <View style={styles.stage}>
          <ThemedText type="code" style={styles.error} numberOfLines={3}>{error ?? 'Something went wrong.'}</ThemedText>
          <View style={styles.actions}>
            <Pressable onPress={onExit} style={[styles.action, { borderColor: `${p.dim}66` }]} hitSlop={6}>
              <ThemedText type="code" style={{ color: p.dim }}>‹ Back to Eve</ThemedText>
            </Pressable>
          </View>
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
