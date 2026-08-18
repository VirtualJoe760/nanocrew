import { useEffect, useMemo, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  Image as RNImage,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Image } from 'expo-image';

import { GarmentMockup, type PrintRect } from '@/components/designer/garment-mockup';

// Where the front print area sits on the garment PHOTO, as fractions of the photo (rough tee default).
// Maps the design's print-area position onto the garment for OUR supplier-agnostic mockup preview. Per-
// blank-type rects (hoodie/mug/etc.) are a follow-up; tee-front covers the common case.
const PRINT_AREA_ON_GARMENT: PrintRect = { x: 0.31, y: 0.26, w: 0.38, h: 0.46 };

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';
import { apiFetch, readJson } from '@/lib/api';

// WYSIWYG print size/placement editor. Positions are real Printful print-file pixels,
// clamped to the print area; "Generate Printful mockup" renders the truth via Printful.
// Printful's API has NO rotation, so the editor is move + scale + precise sizing + bleed.

const STAGE_MAX_W = 300;
const STAGE_MAX_H = 360;
const MIN_W = 40;
const PRINT_DPI = 150; // Printful DTG printfiles run ~150 DPI; inch readouts are approximate.
const BLEED_FACTOR = 1.5; // how far past the print area art may extend when bleed is on

type Box = { left: number; top: number; width: number; height: number };
type Area = { placement: string; label: string; areaWidth: number; areaHeight: number };
type Entry = { placement: string; designId: string; box: Box; bleed: boolean };
type DesignOpt = { id: string; prompt: string; image?: string };
type ColorVariant = { color: string; colorCode: string; image: string };
type Corner = 'tl' | 'tr' | 'bl' | 'br';

// Keep aspect; cap size to the print area (×1.5 when bleeding) and keep it on/near the area.
function clampBox(b: Box, areaW: number, areaH: number, aspect: number, bleed: boolean): Box {
  const maxW = bleed ? areaW * BLEED_FACTOR : areaW;
  const maxH = bleed ? areaH * BLEED_FACTOR : areaH;
  let width = Math.min(Math.max(MIN_W, b.width), maxW);
  let height = width / aspect;
  if (height > maxH) {
    height = maxH;
    width = height * aspect;
  }
  const minLeft = bleed ? -width * 0.5 : 0;
  const maxLeft = bleed ? areaW - width * 0.5 : areaW - width;
  const minTop = bleed ? -height * 0.5 : 0;
  const maxTop = bleed ? areaH - height * 0.5 : areaH - height;
  const left = Math.min(Math.max(minLeft, b.left), Math.max(minLeft, maxLeft));
  const top = Math.min(Math.max(minTop, b.top), Math.max(minTop, maxTop));
  return { left, top, width, height };
}

function defaultBox(area: Area, aspect: number): Box {
  const width = area.areaWidth * 0.7;
  const height = width / aspect;
  return clampBox(
    { left: (area.areaWidth - width) / 2, top: (area.areaHeight - height) / 2, width, height },
    area.areaWidth,
    area.areaHeight,
    aspect,
    false,
  );
}

// A continuous size slider (PanResponder works inside Modals; no slider dep needed).
function SizeSlider({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const theme = useTheme();
  const trackW = useRef(1);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const handle = (x: number) => {
    const frac = Math.min(1, Math.max(0, x / trackW.current));
    onChangeRef.current(Math.round(min + frac * (max - min)));
  };
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => handle(e.nativeEvent.locationX),
      onPanResponderMove: (e) => handle(e.nativeEvent.locationX),
    }),
  ).current;
  const frac = `${((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100}%` as `${number}%`;
  return (
    <View
      {...responder.panHandlers}
      onLayout={(e) => (trackW.current = e.nativeEvent.layout.width)}
      style={[styles.sliderTrack, { backgroundColor: theme.backgroundSelected }]}
      hitSlop={10}>
      <View style={[styles.sliderFill, { width: frac, backgroundColor: theme.text }]} />
      <View style={[styles.sliderThumb, { left: frac, backgroundColor: theme.text }]} />
    </View>
  );
}

// The embeddable editor core — used by the standalone modal AND inside the Finalize sheet,
// so placement stays adjustable right up to publish.
export function PlacementEditorBody({
  compositionId,
  templateKey,
  designs,
  addDesignId,
  onPreview,
}: {
  compositionId: string;
  templateKey: string;
  designs: DesignOpt[];
  addDesignId?: string; // a design dragged onto the composite → pre-add flow
  onPreview: (previewUrl: string) => void;
}) {
  const theme = useTheme();
  const [areas, setAreas] = useState<Area[]>([]);
  // REAL print-area geometry from Printful's mockup template (Joe, 2026-08-17: the hardcoded
  // rectangle landed the preview on the model's trousers for full-body catalog photos).
  const [tmpl, setTmpl] = useState<{ imageUrl: string; x: number; y: number; w: number; h: number } | null>(null);
  const [variantId, setVariantId] = useState<number | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [aspects, setAspects] = useState<Record<string, number>>({});
  const [naturals, setNaturals] = useState<Record<string, number>>({}); // design natural px width
  const [colorVariants, setColorVariants] = useState<ColorVariant[]>([]);
  const [previewColor, setPreviewColor] = useState<string | null>(null);
  const [addStep, setAddStep] = useState<'placement' | 'design' | null>(addDesignId ? 'placement' : null);
  const [pendingPlacement, setPendingPlacement] = useState<string | null>(null);
  const [mockups, setMockups] = useState<Record<string, string> | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0); // bump to re-run the hydrate after a failed load

  const designById = useMemo(() => new Map(designs.map((d) => [d.id, d])), [designs]);

  // Hydrate: print areas + the composition's saved placements.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetch(`/api/blank/${templateKey}/printareas`).then(
        readJson<{ areas?: Area[]; variantId?: number | null }>,
      ),
      apiFetch(`/api/compositions/${compositionId}`).then(
        readJson<{
          composition?: {
            designId: string;
            placement: string;
            placements?: {
              placement: string;
              designId: string;
              position:
                | (Box & { areaWidth: number; areaHeight: number; limitToPrintArea?: boolean })
                | null;
            }[];
          };
        }>,
      ),
    ])
      .then(
        ([pa, comp]) => {
          if (!alive) return;
          const areaList = pa.areas ?? [];
          setAreas(areaList);
          setVariantId(pa.variantId ?? null);
          const row = comp.composition;
          if (!row || !areaList.length) return;
          const saved = row.placements?.length
            ? row.placements
            : [{ placement: row.placement, designId: row.designId, position: null }];
          const list: Entry[] = [];
          for (const p of saved) {
            const area = areaList.find((a) => a.placement === p.placement) ?? areaList[0];
            list.push({
              placement: area.placement,
              designId: p.designId,
              bleed: p.position?.limitToPrintArea === false,
              box: p.position
                ? { left: p.position.left, top: p.position.top, width: p.position.width, height: p.position.height }
                : defaultBox(area, 1),
            });
          }
          setEntries(list);
          setActive(list[0]?.placement ?? null);
        },
      )
      .catch(() => setError('Failed to load print areas'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
     
  }, [compositionId, templateKey, reloadKey]);

  // Garment colourways (for the on-product colour preview).
  useEffect(() => {
    let alive = true;
    apiFetch(`/api/blank/${templateKey}/template?placement=${encodeURIComponent(active ?? 'front')}`)
      .then(readJson<{ template?: { imageUrl: string; x: number; y: number; w: number; h: number } | null }>)
      .then((d) => setTmpl(d.template ?? null))
      .catch(() => setTmpl(null));
    apiFetch(`/api/blank/${templateKey}/variants`)
      .then(readJson<{ variants?: { color: string; colorCode: string; image: string }[] }>)
      .then((d) => {
        if (!alive || !d.variants?.length) return;
        const seen = new Set<string>();
        const list: ColorVariant[] = [];
        for (const v of d.variants) {
          if (seen.has(v.color)) continue;
          seen.add(v.color);
          list.push({ color: v.color, colorCode: v.colorCode, image: v.image });
        }
        setColorVariants(list);
        setPreviewColor((p) => p ?? list[0]?.color ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [templateKey]);

  // Natural aspect ratio + pixel width per design (drives sizing + the DPI badge).
  useEffect(() => {
    for (const e of entries) {
      const url = designById.get(e.designId)?.image;
      if (!url || aspects[e.designId]) continue;
      RNImage.getSize(
        url,
        (w, h) => {
          setAspects((a) => ({ ...a, [e.designId]: w && h ? w / h : 1 }));
          setNaturals((n) => ({ ...n, [e.designId]: w || 0 }));
        },
        () => setAspects((a) => ({ ...a, [e.designId]: 1 })),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  // Re-fit each box to its design's REAL aspect once known. Boxes are seeded at a placeholder 1:1 (line
  // ~188) or restored from a DB position authored under a different area, so without this a non-square
  // design renders squished (the getSize effect only recorded the aspect, never re-clamped). clampBox
  // keeps the box's width and sets height = width/aspect, so this preserves the creator's chosen size.
  useEffect(() => {
    setEntries((list) => {
      let changed = false;
      const next = list.map((x) => {
        const asp = aspects[x.designId];
        const ar = areas.find((a) => a.placement === x.placement);
        if (!asp || !ar) return x;
        const fitted = clampBox(x.box, ar.areaWidth, ar.areaHeight, asp, x.bleed);
        if (fitted.left === x.box.left && fitted.top === x.box.top && fitted.width === x.box.width && fitted.height === x.box.height) return x;
        changed = true;
        return { ...x, box: fitted };
      });
      return changed ? next : list; // no-op when already fitted → no render loop
    });
  }, [aspects, areas]);

  const entry = entries.find((e) => e.placement === active) ?? null;
  const area = areas.find((a) => a.placement === active) ?? null;
  const aspect = entry ? (aspects[entry.designId] ?? 1) : 1;
  const previewVariant = colorVariants.find((c) => c.color === previewColor) ?? colorVariants[0] ?? null;

  // Fit the print area into the stage, preserving its aspect.
  const areaAspect = area ? area.areaWidth / area.areaHeight : 1;
  let frameW = STAGE_MAX_W;
  let frameH = STAGE_MAX_W / areaAspect;
  if (frameH > STAGE_MAX_H) {
    frameH = STAGE_MAX_H;
    frameW = STAGE_MAX_H * areaAspect;
  }
  const scale = area ? frameW / area.areaWidth : 1;

  // --- gesture plumbing (refs so the once-created responders read live values) ---
  const dragRef = useRef<{ box: Box } | null>(null);
  const entryRef = useRef(entry);
  entryRef.current = entry;
  const areaRef = useRef(area);
  areaRef.current = area;
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const applyBox = (next: Box) => {
    const a = areaRef.current;
    const e = entryRef.current;
    if (!a || !e) return;
    setEntries((list) =>
      list.map((x) =>
        x.placement === e.placement
          ? { ...x, box: clampBox(next, a.areaWidth, a.areaHeight, aspectRef.current, x.bleed) }
          : x,
      ),
    );
  };

  const moveResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        if (entryRef.current) dragRef.current = { box: { ...entryRef.current.box } };
      },
      onPanResponderMove: (_e, g) => {
        const d = dragRef.current;
        if (!d) return;
        const s = scaleRef.current;
        applyBox({ ...d.box, left: d.box.left + g.dx / s, top: d.box.top + g.dy / s });
      },
      onPanResponderRelease: () => {
        dragRef.current = null;
      },
    }),
  ).current;

  const cornerResponders = useRef<Record<Corner, ReturnType<typeof PanResponder.create>>>(
    (['tl', 'tr', 'bl', 'br'] as Corner[]).reduce(
      (acc, corner) => {
        acc[corner] = PanResponder.create({
          onStartShouldSetPanResponder: () => true,
          onMoveShouldSetPanResponder: () => true,
          onPanResponderGrant: () => {
            if (entryRef.current) dragRef.current = { box: { ...entryRef.current.box } };
          },
          onPanResponderMove: (_e, g) => {
            const d = dragRef.current;
            if (!d) return;
            const dx = g.dx / scaleRef.current;
            const asp = aspectRef.current;
            const right = corner === 'tr' || corner === 'br';
            const bottom = corner === 'bl' || corner === 'br';
            const width = Math.max(MIN_W, right ? d.box.width + dx : d.box.width - dx);
            const height = width / asp;
            const left = right ? d.box.left : d.box.left + (d.box.width - width);
            const top = bottom ? d.box.top : d.box.top + (d.box.height - height);
            applyBox({ left, top, width, height });
          },
          onPanResponderRelease: () => {
            dragRef.current = null;
          },
        });
        return acc;
      },
      {} as Record<Corner, ReturnType<typeof PanResponder.create>>,
    ),
  ).current;

  // --- sizing / alignment helpers ---
  const setScalePct = (pctVal: number) => {
    if (!entry || !area) return;
    const cx = entry.box.left + entry.box.width / 2;
    const cy = entry.box.top + entry.box.height / 2;
    const width = (pctVal / 100) * area.areaWidth;
    applyBox({ left: cx - width / 2, top: cy - width / aspect / 2, width, height: width / aspect });
  };
  const align = (fn: (b: Box, a: Area) => Box) => {
    if (!entry || !area) return;
    applyBox(fn(entry.box, area));
  };
  const toggleBleed = () => {
    if (!entry) return;
    setEntries((list) => list.map((x) => (x.placement === entry.placement ? { ...x, bleed: !x.bleed } : x)));
  };

  const addEntry = (placement: string, designId: string) => {
    const a = areas.find((x) => x.placement === placement);
    if (!a) return;
    setEntries((list) => [...list, { placement, designId, bleed: false, box: defaultBox(a, aspects[designId] ?? 1) }]);
    setActive(placement);
    setAddStep(null);
    setPendingPlacement(null);
  };
  const removeEntry = (placement: string) => {
    if (entries.length <= 1) return;
    setEntries((list) => list.filter((e) => e.placement !== placement));
    if (active === placement) setActive(entries.find((e) => e.placement !== placement)?.placement ?? null);
  };

  const generateMockup = () => {
    if (!variantId || rendering) return;
    setRendering(true);
    setError(null);
    const payload = {
      compositionId,
      templateKey,
      variantId,
      placements: entries.map((e) => {
        const a = areas.find((x) => x.placement === e.placement)!;
        return {
          placement: e.placement,
          designId: e.designId,
          position: {
            areaWidth: a.areaWidth,
            areaHeight: a.areaHeight,
            width: e.box.width,
            height: e.box.height,
            top: e.box.top,
            left: e.box.left,
            limitToPrintArea: !e.bleed,
          },
        };
      }),
    };
    apiFetch('/api/mockup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(readJson<{ mockups?: Record<string, string>; previewUrl?: string; error?: string }>)
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setMockups(d.mockups ?? null);
        if (d.previewUrl) onPreview(d.previewUrl);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Mockup failed'))
      .finally(() => setRendering(false));
  };

  const availableToAdd = areas.filter((a) => !entries.some((e) => e.placement === a.placement));
  const designUrl = entry ? designById.get(entry.designId)?.image : undefined;

  // Inch + DPI readout for the active design.
  const widthIn = entry ? entry.box.width / PRINT_DPI : 0;
  const heightIn = entry ? entry.box.height / PRINT_DPI : 0;
  const naturalW = entry ? (naturals[entry.designId] ?? 0) : 0;
  const dpi = widthIn > 0 && naturalW ? Math.round(naturalW / widthIn) : 0;
  const quality =
    dpi >= 150
      ? { label: 'Sharp', color: '#16a34a' }
      : dpi >= 100
        ? { label: 'OK', color: '#d97706' }
        : { label: 'Low-res', color: '#dc2626' };
  const pct = entry && area ? Math.round((entry.box.width / area.areaWidth) * 100) : 0;

  if (loading) return <ActivityIndicator style={{ marginVertical: Spacing.six }} />;

  // A failed hydrate left no print areas — show the error with a retry instead of a broken,
  // empty editor (or, before readJson, a silent spinner that never resolved).
  if (error && !areas.length)
    return (
      <View style={{ alignItems: 'center', gap: Spacing.three, marginVertical: Spacing.six }}>
        <ThemedText type="small" themeColor="textSecondary">{error}</ThemedText>
        <Pressable onPress={() => setReloadKey((k) => k + 1)} hitSlop={8} style={{ paddingVertical: Spacing.two, paddingHorizontal: Spacing.four }}>
          <ThemedText type="smallBold" themeColor="tint">Try again</ThemedText>
        </Pressable>
      </View>
    );

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.three, paddingBottom: Spacing.six }}>
      {/* On-product reference + interactive print area */}
      {entry && area ? (
        <View style={styles.editorWrap}>
          {previewVariant ? (
            <View style={styles.previewWrap}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.previewLabel}>
                Printed preview · {previewVariant.color}
              </ThemedText>
              {/* OUR supplier-agnostic mockup: the design multiply-blended onto the real garment photo
                  so it reads as PRINTED (fabric folds/shadows show through), not slapped on. Updates
                  live as you move/resize below. The provider's own mockup is finalized at approve. */}
              <GarmentMockup
                garmentUri={tmpl?.imageUrl ?? previewVariant.image}
                designUri={designUrl ?? null}
                rect={(() => {
                  const pa = tmpl ?? PRINT_AREA_ON_GARMENT;
                  return {
                    x: pa.x + (entry.box.left / area.areaWidth) * pa.w,
                    y: pa.y + (entry.box.top / area.areaHeight) * pa.h,
                    w: (entry.box.width / area.areaWidth) * pa.w,
                    h: (entry.box.height / area.areaHeight) * pa.h,
                  };
                })()}
                style={styles.printedPreview}
              />
            </View>
          ) : null}
          <View
            style={[
              styles.area,
              {
                width: frameW,
                height: frameH,
                backgroundColor: previewVariant?.colorCode ?? theme.backgroundElement,
                borderColor: theme.backgroundSelected,
              },
            ]}>
            <View
              {...moveResponder.panHandlers}
              style={[
                styles.designBox,
                {
                  left: entry.box.left * scale,
                  top: entry.box.top * scale,
                  width: entry.box.width * scale,
                  height: entry.box.height * scale,
                },
              ]}>
              {/* contain (NOT fill) — never stretch the art; the box is kept at the design's true aspect
                  by clampBox + the re-fit effect, so the print preview matches what's actually printed. */}
              {designUrl ? <Image source={{ uri: designUrl }} style={styles.designFill} contentFit="contain" /> : null}
              {(['tl', 'tr', 'bl', 'br'] as Corner[]).map((c) => (
                <View key={c} {...cornerResponders[c].panHandlers} hitSlop={14} style={[styles.handle, HANDLE_POS[c]]} />
              ))}
            </View>
          </View>
          <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
            Drag to move · drag any corner to resize
          </ThemedText>
        </View>
      ) : null}

      {/* Colourway preview chips */}
      {colorVariants.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {colorVariants.map((c) => (
            <Pressable key={c.color} onPress={() => setPreviewColor(c.color)}>
              <ThemedView
                type={previewColor === c.color ? 'backgroundSelected' : 'backgroundElement'}
                style={styles.colorChip}>
                <View style={[styles.swatch, { backgroundColor: c.colorCode }]} />
                <ThemedText type="small" themeColor={previewColor === c.color ? 'text' : 'textSecondary'}>
                  {c.color}
                </ThemedText>
              </ThemedView>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* Placement chips */}
      <View style={styles.chipRow}>
        {entries.map((e) => (
          <Pressable key={e.placement} onPress={() => setActive(e.placement)} onLongPress={() => removeEntry(e.placement)}>
            <ThemedView
              type={active === e.placement ? 'backgroundSelected' : 'backgroundElement'}
              style={styles.chip}>
              <ThemedText type="small" themeColor={active === e.placement ? 'text' : 'textSecondary'}>
                {areas.find((a) => a.placement === e.placement)?.label ?? e.placement}
                {entries.length > 1 ? '  ×' : ''}
              </ThemedText>
            </ThemedView>
          </Pressable>
        ))}
        {availableToAdd.length ? (
          <Pressable onPress={() => setAddStep('placement')}>
            <ThemedView type="backgroundElement" style={styles.chip}>
              <ThemedText type="small" themeColor="textSecondary">
                ＋ Add design
              </ThemedText>
            </ThemedView>
          </Pressable>
        ) : null}
      </View>

      {/* Two-step add: placement → design */}
      {addStep === 'placement' ? (
        <View style={styles.chipRow}>
          {availableToAdd.map((a) => (
            <Pressable
              key={a.placement}
              onPress={() => {
                setPendingPlacement(a.placement);
                if (addDesignId) addEntry(a.placement, addDesignId);
                else setAddStep('design');
              }}>
              <ThemedView type="backgroundElement" style={styles.chip}>
                <ThemedText type="small" themeColor="textSecondary">
                  {a.label}
                </ThemedText>
              </ThemedView>
            </Pressable>
          ))}
        </View>
      ) : null}
      {addStep === 'design' && pendingPlacement ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.designRow}>
          {designs
            .filter((d) => d.image && !d.image.startsWith('data:'))
            .map((d) => (
              <Pressable key={d.id} onPress={() => addEntry(pendingPlacement, d.id)}>
                <Image source={{ uri: d.image }} style={styles.designThumb} contentFit="cover" />
              </Pressable>
            ))}
        </ScrollView>
      ) : null}


      {/* Size: continuous slider + readout */}
      {entry && area ? (
        <>
          <View style={styles.sizeRow}>
            <Pressable onPress={() => setScalePct(Math.max(5, pct - 2))} hitSlop={8}>
              <ThemedView type="backgroundElement" style={styles.stepBtn}>
                <ThemedText type="small">−</ThemedText>
              </ThemedView>
            </Pressable>
            <SizeSlider value={pct} min={5} max={entry.bleed ? 150 : 100} onChange={setScalePct} />
            <Pressable onPress={() => setScalePct(Math.min(entry.bleed ? 150 : 100, pct + 2))} hitSlop={8}>
              <ThemedView type="backgroundElement" style={styles.stepBtn}>
                <ThemedText type="small">＋</ThemedText>
              </ThemedView>
            </Pressable>
          </View>
          <View style={styles.readoutRow}>
            <ThemedText type="small" themeColor="textSecondary">
              {pct}% · ~{widthIn.toFixed(1)}″ × {heightIn.toFixed(1)}″
            </ThemedText>
            {dpi ? (
              <ThemedText type="small" style={{ color: quality.color }}>
                ● {dpi} DPI · {quality.label}
              </ThemedText>
            ) : null}
          </View>

          {/* Alignment + fit + bleed */}
          <View style={styles.chipRow}>
            {(
              [
                ['Fit', (b: Box, a: Area) => clampBox({ ...b, left: 0, top: 0, width: a.areaWidth }, a.areaWidth, a.areaHeight, aspect, false)],
                ['Fill width', (b: Box, a: Area) => ({ ...b, left: 0, width: a.areaWidth, height: a.areaWidth / aspect })],
                ['Center', (b: Box, a: Area) => ({ ...b, left: (a.areaWidth - b.width) / 2, top: (a.areaHeight - b.height) / 2 })],
                ['Top', (b: Box) => ({ ...b, top: 0 })],
                ['Bottom', (b: Box, a: Area) => ({ ...b, top: a.areaHeight - b.height })],
                ['Left', (b: Box) => ({ ...b, left: 0 })],
                ['Right', (b: Box, a: Area) => ({ ...b, left: a.areaWidth - b.width })],
              ] as const
            ).map(([label, fn]) => (
              <Pressable key={label} onPress={() => align(fn)}>
                <ThemedView type="backgroundElement" style={styles.chip}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {label}
                  </ThemedText>
                </ThemedView>
              </Pressable>
            ))}
            <Pressable onPress={toggleBleed}>
              <ThemedView type={entry.bleed ? 'backgroundSelected' : 'backgroundElement'} style={styles.chip}>
                <ThemedText type="small" themeColor={entry.bleed ? 'text' : 'textSecondary'}>
                  Bleed {entry.bleed ? 'on' : 'off'}
                </ThemedText>
              </ThemedView>
            </Pressable>
          </View>
        </>
      ) : null}

      {/* Mockup result */}
      {mockups ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.designRow}>
          {Object.entries(mockups).map(([k, url]) => (
            <View key={k} style={styles.mockupItem}>
              <Image source={{ uri: url }} style={styles.mockupImg} contentFit="contain" />
              <ThemedText type="small" themeColor="textSecondary">
                {k}
              </ThemedText>
            </View>
          ))}
        </ScrollView>
      ) : null}
      {error ? (
        <ThemedText type="small" style={{ color: '#e24b4a' }}>
          {error}
        </ThemedText>
      ) : null}

      <Pressable onPress={generateMockup} disabled={rendering || !variantId}>
        <View style={[styles.generate, { backgroundColor: theme.text, opacity: rendering ? 0.5 : 1 }]}>
          {rendering ? (
            <ActivityIndicator color={theme.background} />
          ) : (
            <ThemedText type="smallBold" style={{ color: theme.background }}>
              Generate Printful mockup
            </ThemedText>
          )}
        </View>
      </Pressable>
    </ScrollView>
  );
}

// Standalone modal wrapper (opened from the composite review / drag-onto-composite).
export function PlacementEditor({
  compositionId,
  templateKey,
  designs,
  addDesignId,
  onClose,
  onPreview,
  badge,
  captions,
}: {
  compositionId: string;
  templateKey: string;
  designs: DesignOpt[];
  addDesignId?: string;
  onClose: () => void;
  onPreview: (previewUrl: string) => void;
  /** Optional header ornament — Eve's flow shows her listening badge here (EveEar). */
  badge?: React.ReactNode;
  /** Optional absolute overlay — Eve's flow pins her subtitles here (EveCaptions). */
  captions?: React.ReactNode;
}) {
  // The sheet caps at 90% height, which on a Dynamic Island phone leaves too little room at the
  // top — the header (and its Done button) ended up under the island. Reserve the inset here.
  const insets = useSafeAreaInsets();
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.backdrop, { paddingTop: insets.top }]}>
        <ThemedView type="background" style={styles.sheet}>
          {captions}
          <View style={styles.header}>
            <ThemedText type="smallBold">Size & placement</ThemedText>
            {badge}
            <Pressable onPress={onClose} hitSlop={10}>
              <ThemedText type="small" themeColor="textSecondary">
                Done
              </ThemedText>
            </Pressable>
          </View>
          <PlacementEditorBody
            compositionId={compositionId}
            templateKey={templateKey}
            designs={designs}
            addDesignId={addDesignId}
            onPreview={onPreview}
          />
        </ThemedView>
      </View>
    </Modal>
  );
}

const HANDLE_POS: Record<Corner, { left?: number; right?: number; top?: number; bottom?: number }> = {
  tl: { left: -9, top: -9 },
  tr: { right: -9, top: -9 },
  bl: { left: -9, bottom: -9 },
  br: { right: -9, bottom: -9 },
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    padding: Spacing.four,
    paddingBottom: Spacing.six,
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    gap: Spacing.three,
    maxHeight: '90%',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  flex: { flex: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, alignItems: 'center' },
  chip: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.three, borderRadius: 999 },
  colorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: 999,
  },
  swatch: { width: 14, height: 14, borderRadius: 7, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(128,128,128,0.5)' },
  designRow: { gap: Spacing.two, paddingVertical: Spacing.one },
  designThumb: { width: 56, height: 56, borderRadius: Spacing.two },
  editorWrap: { alignItems: 'center', gap: Spacing.two },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, alignSelf: 'stretch' },
  previewThumb: { width: 40, height: 40, borderRadius: Spacing.one },
  previewWrap: { alignSelf: 'stretch', alignItems: 'center', gap: Spacing.one },
  previewLabel: { alignSelf: 'center' },
  printedPreview: { width: 200, height: 230 },
  area: { borderRadius: Spacing.two, borderWidth: 1.5, borderStyle: 'dashed' },
  designBox: { position: 'absolute', borderWidth: 1.5, borderColor: '#3b82f6' },
  designFill: { width: '100%', height: '100%' },
  handle: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#3b82f6',
    borderWidth: 2,
    borderColor: '#fff',
  },
  hint: { textAlign: 'center' },
  sizeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stepBtn: { width: 34, height: 30, borderRadius: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  sliderTrack: { flex: 1, height: 6, borderRadius: 3, justifyContent: 'center' },
  sliderFill: { position: 'absolute', left: 0, height: 6, borderRadius: 3 },
  sliderThumb: { position: 'absolute', width: 18, height: 18, borderRadius: 9, marginLeft: -9, top: -6 },
  readoutRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mockupItem: { alignItems: 'center', gap: 2 },
  mockupImg: { width: 130, height: 150, borderRadius: Spacing.two },
  generate: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    borderRadius: 999,
    minHeight: 44,
  },
});
