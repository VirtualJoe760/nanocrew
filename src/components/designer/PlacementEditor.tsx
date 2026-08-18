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
  // Route through a ref so the once-created responder always sees the LATEST min/max/onChange
  // (bleed toggles max 100 ⇄ 150; a mount-time closure froze it at 100).
  const handleRef = useRef((_x: number) => {});
  handleRef.current = (x: number) => {
    const frac = Math.min(1, Math.max(0, x / trackW.current));
    onChange(Math.round(min + frac * (max - min)));
  };
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => handleRef.current(e.nativeEvent.locationX),
      onPanResponderMove: (e) => handleRef.current(e.nativeEvent.locationX),
    }),
  ).current;
  const frac = `${((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100}%` as `${number}%`;
  return (
    <View
      {...responder.panHandlers}
      onLayout={(e) => (trackW.current = e.nativeEvent.layout.width)}
      style={[styles.sliderTrack, { backgroundColor: theme.backgroundSelected }]}
      hitSlop={10}>
      {/* pointerEvents=none — locationX is TARGET-relative; a touch landing on the thumb
          would otherwise report x within the thumb's own 18px frame and snap to min. */}
      <View pointerEvents="none" style={[styles.sliderFill, { width: frac, backgroundColor: theme.text }]} />
      <View pointerEvents="none" style={[styles.sliderThumb, { left: frac, backgroundColor: theme.text }]} />
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
  const [tmpl, setTmpl] = useState<{ imageUrl: string; aspect?: number; x: number; y: number; w: number; h: number } | null>(null);
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
  // v3 (Joe, 2026-08-17: "i dont like how all of the options we have to scroll the page down to
  // see"): NO page scroll — the hero fills the measured stage and ONE tool rail shows at a time.
  const [tool, setTool] = useState<'size' | 'color' | 'place' | 'align' | 'edges' | 'proof'>('size');
  const [stageBox, setStageBox] = useState({ w: 0, h: 0 });
  // Retouch results (feather / remove-bg) override the prop-owned design urls.
  const [retouched, setRetouched] = useState<Record<string, string>>({});
  const [feathering, setFeathering] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0); // bump to re-run the hydrate after a failed load
  const [catalogueId, setCatalogueId] = useState<string | null>(null); // for /api/edit (remove-bg)
  const [removingBg, setRemovingBg] = useState(false);

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
            catalogueId?: string | null;
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
          setCatalogueId(row.catalogueId ?? null);
          const saved = row.placements?.length
            ? row.placements
            : [{ placement: row.placement, designId: row.designId, position: null }];
          const list: Entry[] = [];
          for (const p of saved) {
            const area = areaList.find((a) => a.placement === p.placement) ?? areaList[0];
            if (list.some((e) => e.placement === area.placement)) continue;
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

  // REAL template geometry for the ACTIVE placement — re-keyed on `active` (review 2026-08-17:
  // switching to back/sleeve kept the FRONT photo and rect, mis-mapping every gesture).
  useEffect(() => {
    let alive = true;
    apiFetch(`/api/blank/${templateKey}/template?placement=${encodeURIComponent(active ?? 'front')}`)
      .then(readJson<{ template?: { imageUrl: string; aspect?: number; x: number; y: number; w: number; h: number } | null }>)
      .then((d) => {
        if (alive) setTmpl(d.template ?? null);
      })
      .catch(() => {
        if (alive) setTmpl(null);
      });
    return () => {
      alive = false;
    };
  }, [templateKey, active]);

  // Garment colourways (for the on-product colour preview).
  useEffect(() => {
    let alive = true;
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

  // The template photo is one fixed colour, so picking a non-default colourway swaps the hero to
  // that variant's catalog photo (real colour, approximate rect) — otherwise the COLOR rail was
  // inert whenever template geometry existed (review 2026-08-17).
  const defaultColor = colorVariants[0]?.color ?? null;
  const onDefaultColor = previewColor == null || previewColor === defaultColor;

  // The hero is sized to the garment photo's TRUE aspect so print-area fractions of the
  // container are exactly fractions of the image (contain-fit letterboxing broke the mapping
  // and drew a huge dead white card — Joe, 2026-08-17 "the ui is wayyy too big"). The template
  // serves its aspect; only the catalog-photo fallback needs a getSize round-trip.
  const [garmentAspect, setGarmentAspect] = useState(1);
  useEffect(() => {
    if (tmpl?.aspect && onDefaultColor) {
      setGarmentAspect(tmpl.aspect);
      return;
    }
    const uri =
      colorVariants.find((c) => c.color === previewColor)?.image ??
      colorVariants[0]?.image ??
      (onDefaultColor ? (tmpl?.imageUrl ?? '') : '');
    if (!uri) return;
    let alive = true;
    RNImage.getSize(uri, (w, h) => {
      if (alive && w && h) setGarmentAspect(w / h);
    }, () => {});
    return () => {
      alive = false;
    };
  }, [tmpl, colorVariants, previewColor, onDefaultColor]);

  // Natural aspect ratio + pixel width per design (drives sizing + the DPI badge).
  useEffect(() => {
    for (const e of entries) {
      const url = retouched[e.designId] ?? designById.get(e.designId)?.image;
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

  // ONE direct-manipulation hero (Joe's redesign, 2026-08-17): the design is dragged/resized ON
  // the garment mockup itself — no second abstract canvas. The hero matches the garment photo's
  // aspect exactly (fractions of the container ARE fractions of the image) and fills whatever
  // space the measured stage gives it — the tool tray below is fixed, nothing scrolls.
  let heroW = stageBox.w;
  let heroH = heroW / garmentAspect;
  if (stageBox.h && heroH > stageBox.h) {
    heroH = stageBox.h;
    heroW = heroH * garmentAspect;
  }
  const heroReady = heroW > 0 && heroH > 0;
  const useTmplPhoto = !!tmpl && onDefaultColor;
  const pa: PrintRect = useTmplPhoto && tmpl ? tmpl : PRINT_AREA_ON_GARMENT;
  const scaleX = area && heroReady ? (pa.w * heroW) / area.areaWidth : 1;
  const scaleY = area && heroReady ? (pa.h * heroH) / area.areaHeight : 1;

  // --- gesture plumbing (refs so the once-created responders read live values) ---
  const dragRef = useRef<{ box: Box } | null>(null);
  const entryRef = useRef(entry);
  entryRef.current = entry;
  const areaRef = useRef(area);
  areaRef.current = area;
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;
  const scaleXRef = useRef(scaleX);
  scaleXRef.current = scaleX;
  const scaleYRef = useRef(scaleY);
  scaleYRef.current = scaleY;

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
      // The hero lives inside a vertical ScrollView — never surrender a design drag to it.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        if (entryRef.current) dragRef.current = { box: { ...entryRef.current.box } };
      },
      onPanResponderMove: (_e, g) => {
        const d = dragRef.current;
        if (!d) return;
        applyBox({ ...d.box, left: d.box.left + g.dx / scaleXRef.current, top: d.box.top + g.dy / scaleYRef.current });
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
          onPanResponderTerminationRequest: () => false,
          onPanResponderGrant: () => {
            if (entryRef.current) dragRef.current = { box: { ...entryRef.current.box } };
          },
          onPanResponderMove: (_e, g) => {
            const d = dragRef.current;
            if (!d) return;
            const dx = g.dx / scaleXRef.current;
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
    if (!entry || !area) return;
    setEntries((list) =>
      list.map((x) => {
        if (x.placement !== entry.placement) return x;
        const bleed = !x.bleed;
        return { ...x, bleed, box: clampBox(x.box, area.areaWidth, area.areaHeight, aspectRef.current, bleed) };
      }),
    );
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

  // AUTOSAVE (review 2026-08-17): edits lived only in local state — without a "Generate
  // Printful mockup" tap nothing persisted, and publish used the default placement. Debounced
  // PATCH; the server re-clamps and scopes designIds.
  const entriesForSave = useRef(entries);
  entriesForSave.current = entries;
  const areasForSave = useRef(areas);
  areasForSave.current = areas;
  useEffect(() => {
    if (loading || !entries.length) return;
    const t = setTimeout(() => {
      const payload = entriesForSave.current
        .map((e) => {
          const a = areasForSave.current.find((x) => x.placement === e.placement);
          if (!a) return null;
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
        })
        .filter(Boolean);
      if (!payload.length) return;
      apiFetch(`/api/compositions/${compositionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placements: payload }),
      }).catch(() => {});
    }, 700);
    return () => clearTimeout(t);
  }, [entries, loading, compositionId]);

  const availableToAdd = areas.filter((a) => !entries.some((e) => e.placement === a.placement));
  const designUrl = entry
    ? (retouched[entry.designId] ?? designById.get(entry.designId)?.image)
    : undefined;

  // Edge feather (Photoshop-style) right in the editor — Joe, 2026-08-17: "we should have
  // options for feathering the edges here too". Free (no credits); the server persists the url.
  const featherActive = (pct: number) => {
    if (!entry || feathering) return;
    setFeathering(true);
    setError(null);
    const natural = naturals[entry.designId] ?? 0;
    const radius = natural ? Math.max(24, Math.round(natural * pct)) : undefined;
    apiFetch('/api/creator/design-feather', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ designId: entry.designId, ...(radius ? { radius } : {}) }),
    })
      .then(readJson<{ image?: string; error?: string }>)
      .then((d) => {
        if (d.error) throw new Error(d.error);
        if (d.image) setRetouched((m) => ({ ...m, [entry.designId]: d.image! }));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Feather failed'))
      .finally(() => setFeathering(false));
  };

  // Strip a baked-in background panel/disc/field behind the art (Joe, 2026-08-18: "there is some
  // black layer of background that is overlapping… we need to be able to remove background").
  // Non-destructive: /api/edit mints a NEW design; the active placement swaps to it.
  const removeBackground = () => {
    if (!entry || !catalogueId || removingBg) return;
    const prev = entry;
    setRemovingBg(true);
    setError(null);
    apiFetch('/api/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        designId: prev.designId,
        catalogueId,
        mode: 'custom',
        background: 'transparent',
        instruction:
          'Remove the background COMPLETELY — keep ONLY the main subject artwork with clean edges. Delete any panel, disc, rectangle, colour field, texture or backdrop sitting behind the subject. Do not alter the subject itself.',
      }),
    })
      .then(readJson<{ image?: string; id?: string; error?: string; needed?: number; balance?: number }>)
      .then((d) => {
        if (d.error === 'insufficient_credits') throw new Error(`Not enough credits — need ${d.needed ?? 8}, you have ${d.balance ?? 0}.`);
        if (d.error) throw new Error(d.error);
        if (!d.image || !d.id) throw new Error('Background removal failed');
        const newId = d.id;
        setRetouched((m) => ({ ...m, [newId]: d.image! }));
        // Carry the known geometry so the box doesn't re-fit to a placeholder square.
        setAspects((a) => (a[prev.designId] ? { ...a, [newId]: a[prev.designId] } : a));
        setNaturals((n) => (n[prev.designId] ? { ...n, [newId]: n[prev.designId] } : n));
        setEntries((list) => list.map((x) => (x.placement === prev.placement ? { ...x, designId: newId } : x)));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Background removal failed'))
      .finally(() => setRemovingBg(false));
  };

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

  const TOOLS = [
    ['size', 'SIZE'],
    ...(colorVariants.length ? [['color', 'COLOR'] as const] : []),
    ['place', 'PLACE'],
    ['align', 'ALIGN'],
    ['edges', 'EDGES'],
    ['proof', 'PROOF'],
  ] as [typeof tool, string][];

  return (
    <View style={styles.fill}>
      {/* ONE hero: the design is dragged/resized directly ON the garment. GarmentMockup
          multiply-blends the art so it reads as printed; a transparent ghost box with corner
          handles sits at the same spot, and a dashed outline marks the print area. */}
      {entry && area ? (
        <View style={styles.stage} onLayout={(e) => setStageBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {heroReady ? (
            <View style={[styles.hero, { width: heroW, height: heroH, borderColor: theme.backgroundSelected }]}>
              <GarmentMockup
                garmentUri={useTmplPhoto && tmpl ? tmpl.imageUrl : (previewVariant?.image ?? '')}
                designUri={designUrl ?? null}
                rect={{
                  x: pa.x + (entry.box.left / area.areaWidth) * pa.w,
                  y: pa.y + (entry.box.top / area.areaHeight) * pa.h,
                  w: (entry.box.width / area.areaWidth) * pa.w,
                  h: (entry.box.height / area.areaHeight) * pa.h,
                }}
                style={{ position: 'absolute', top: 0, left: 0, width: heroW, height: heroH }}
              />
              <View
                pointerEvents="none"
                style={[
                  styles.printZone,
                  {
                    left: pa.x * heroW,
                    top: pa.y * heroH,
                    width: pa.w * heroW,
                    height: pa.h * heroH,
                    borderColor: theme.textSecondary,
                  },
                ]}
              />
              <View
                {...moveResponder.panHandlers}
                style={[
                  styles.designBox,
                  {
                    left: pa.x * heroW + entry.box.left * scaleX,
                    top: pa.y * heroH + entry.box.top * scaleY,
                    width: entry.box.width * scaleX,
                    height: entry.box.height * scaleY,
                  },
                ]}>
                {(['tl', 'tr', 'bl', 'br'] as Corner[]).map((c) => (
                  <View key={c} {...cornerResponders[c].panHandlers} hitSlop={14} style={[styles.handle, HANDLE_POS[c]]} />
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.stage} />
      )}
      <ThemedText type="code" themeColor="textSecondary" style={styles.hint}>
        DRAG TO MOVE · CORNERS TO RESIZE
      </ThemedText>
      {error ? (
        <ThemedText type="small" style={styles.errorLine} numberOfLines={2}>
          {error}
        </ThemedText>
      ) : null}

      {/* Fixed tool tray — tabs swap ONE rail; nothing on this screen scrolls vertically. */}
      <View style={styles.tray}>
        <View style={styles.toolTabs}>
          {TOOLS.map(([key, label]) => (
            <Pressable key={key} onPress={() => setTool(key)} hitSlop={6} style={styles.toolTab}>
              <ThemedText
                type="code"
                themeColor={tool === key ? 'text' : 'textSecondary'}
                style={[styles.toolTabText, tool === key ? { borderBottomColor: theme.text, borderBottomWidth: 1 } : null]}>
                {label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
        <View style={styles.toolContent}>
          {tool === 'size' && entry && area ? (
            <View style={styles.fillW}>
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
                <ThemedText type="code" themeColor="textSecondary" style={styles.sectionLabel}>
                  {pct}% · {widthIn.toFixed(1)}″ × {heightIn.toFixed(1)}″
                </ThemedText>
                {dpi ? (
                  <ThemedText type="code" style={[styles.sectionLabel, { color: quality.color }]}>
                    ● {dpi} DPI · {quality.label.toUpperCase()}
                  </ThemedText>
                ) : null}
              </View>
            </View>
          ) : null}

          {tool === 'color' ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.blockRow}>
              {colorVariants.map((c) => {
                const on = previewColor === c.color;
                return (
                  <Pressable key={c.color} onPress={() => setPreviewColor(c.color)} style={styles.block}>
                    <View style={[styles.swatchBig, { backgroundColor: c.colorCode }, on ? { borderColor: theme.text, borderWidth: 2 } : null]} />
                    <ThemedText type="code" themeColor={on ? 'text' : 'textSecondary'} style={styles.blockLabel} numberOfLines={1}>
                      {c.color.toUpperCase()}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {tool === 'place' ? (
            addStep === 'design' && pendingPlacement ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.blockRow}>
                {designs
                  .filter((d) => d.image && !d.image.startsWith('data:'))
                  .map((d) => (
                    <Pressable key={d.id} onPress={() => addEntry(pendingPlacement, d.id)} style={styles.block}>
                      <Image source={{ uri: d.image }} style={styles.blockTile} contentFit="cover" />
                    </Pressable>
                  ))}
              </ScrollView>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.blockRow}>
                {entries.map((e) => {
                  const on = active === e.placement;
                  const img = retouched[e.designId] ?? designById.get(e.designId)?.image;
                  return (
                    <Pressable
                      key={e.placement}
                      onPress={() => setActive(e.placement)}
                      onLongPress={() => removeEntry(e.placement)}
                      style={styles.block}>
                      <View style={[styles.blockTile, { backgroundColor: theme.backgroundElement }, on ? { borderColor: theme.text, borderWidth: 1.5 } : null]}>
                        {img ? <Image source={{ uri: img }} style={styles.blockTileImg} contentFit="contain" /> : null}
                      </View>
                      <ThemedText type="code" themeColor={on ? 'text' : 'textSecondary'} style={styles.blockLabel} numberOfLines={1}>
                        {(areas.find((a) => a.placement === e.placement)?.label ?? e.placement).toUpperCase()}
                      </ThemedText>
                    </Pressable>
                  );
                })}
                {addStep === 'placement'
                  ? availableToAdd.map((a) => (
                      <Pressable
                        key={a.placement}
                        onPress={() => {
                          setPendingPlacement(a.placement);
                          if (addDesignId) addEntry(a.placement, addDesignId);
                          else setAddStep('design');
                        }}
                        style={styles.block}>
                        <View style={[styles.blockTile, styles.blockTileDashed, { borderColor: theme.textSecondary }]}>
                          <ThemedText type="small" themeColor="textSecondary">＋</ThemedText>
                        </View>
                        <ThemedText type="code" themeColor="textSecondary" style={styles.blockLabel} numberOfLines={1}>
                          {a.label.toUpperCase()}
                        </ThemedText>
                      </Pressable>
                    ))
                  : availableToAdd.length ? (
                      <Pressable onPress={() => setAddStep('placement')} style={styles.block}>
                        <View style={[styles.blockTile, styles.blockTileDashed, { borderColor: theme.backgroundSelected }]}>
                          <ThemedText type="small" themeColor="textSecondary">＋</ThemedText>
                        </View>
                        <ThemedText type="code" themeColor="textSecondary" style={styles.blockLabel}>
                          ADD
                        </ThemedText>
                      </Pressable>
                    ) : null}
              </ScrollView>
            )
          ) : null}

          {tool === 'align' && entry && area ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.blockRow}>
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
                  <ThemedView type="backgroundElement" style={styles.alignTile}>
                    <ThemedText type="code" themeColor="textSecondary" style={styles.blockLabel}>
                      {label.toUpperCase()}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              ))}
              <Pressable onPress={toggleBleed}>
                <ThemedView type={entry.bleed ? 'backgroundSelected' : 'backgroundElement'} style={styles.alignTile}>
                  <ThemedText type="code" themeColor={entry.bleed ? 'text' : 'textSecondary'} style={styles.blockLabel}>
                    BLEED {entry.bleed ? 'ON' : 'OFF'}
                  </ThemedText>
                </ThemedView>
              </Pressable>
            </ScrollView>
          ) : null}

          {tool === 'edges' && entry ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.blockRow}>
              <Pressable onPress={removeBackground} disabled={removingBg || feathering || !catalogueId}>
                <ThemedView type="backgroundElement" style={[styles.alignTile, removingBg ? { opacity: 0.5 } : null]}>
                  {removingBg ? (
                    <ActivityIndicator size="small" color={theme.text} />
                  ) : (
                    <ThemedText type="code" themeColor="text" style={styles.blockLabel}>
                      ✦ REMOVE BACKGROUND · 8
                    </ThemedText>
                  )}
                </ThemedView>
              </Pressable>
              {(
                [
                  ['FEATHER · LIGHT', 0.05],
                  ['FEATHER · SOFT', 0.09],
                  ['FEATHER · HEAVY', 0.14],
                ] as const
              ).map(([label, p]) => (
                <Pressable key={label} onPress={() => featherActive(p)} disabled={feathering || removingBg}>
                  <ThemedView type="backgroundElement" style={[styles.alignTile, feathering ? { opacity: 0.5 } : null]}>
                    <ThemedText type="code" themeColor="textSecondary" style={styles.blockLabel}>
                      {label}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              ))}
              {feathering ? <ActivityIndicator size="small" color={theme.text} style={styles.trayBusy} /> : null}
              <ThemedText type="code" themeColor="textSecondary" style={[styles.blockLabel, styles.trayNote]}>
                SOFTENS THE EDGES · SAVES TO THE DESIGN
              </ThemedText>
            </ScrollView>
          ) : null}

          {tool === 'proof' ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.blockRow}>
              <Pressable onPress={generateMockup} disabled={rendering || !variantId}>
                <ThemedView type="backgroundElement" style={[styles.alignTile, rendering ? { opacity: 0.5 } : null]}>
                  {rendering ? (
                    <ActivityIndicator size="small" color={theme.text} />
                  ) : (
                    <ThemedText type="code" themeColor="textSecondary" style={styles.blockLabel}>
                      ✦ GENERATE PRINTFUL MOCKUP
                    </ThemedText>
                  )}
                </ThemedView>
              </Pressable>
              {mockups
                ? Object.entries(mockups).map(([k, url]) => (
                    <View key={k} style={styles.mockupItem}>
                      <Image source={{ uri: url }} style={styles.mockupImg} contentFit="contain" />
                      <ThemedText type="code" themeColor="textSecondary" style={styles.blockLabel}>
                        {k.toUpperCase()}
                      </ThemedText>
                    </View>
                  ))
                : null}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </View>
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
  // Full screen (Joe, 2026-08-17: "make it full screen, we have so much space that isnt being
  // utilized"). Manual insets — the header must never sit under the Dynamic Island.
  const insets = useSafeAreaInsets();
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ThemedView
        type="background"
        style={[styles.screen, { paddingTop: insets.top + Spacing.two, paddingBottom: Math.max(insets.bottom, Spacing.three) }]}>
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
    </Modal>
  );
}

const HANDLE_POS: Record<Corner, { left?: number; right?: number; top?: number; bottom?: number }> = {
  tl: { left: -7, top: -7 },
  tr: { right: -7, top: -7 },
  bl: { left: -7, bottom: -7 },
  br: { right: -7, bottom: -7 },
};

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: Spacing.four, gap: Spacing.three },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fill: { flex: 1 },
  fillW: { flex: 1, gap: Spacing.two, justifyContent: 'center' },
  // The hero fills whatever the stage measures; the tray below is FIXED — no page scroll.
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tray: { gap: Spacing.two, paddingTop: Spacing.two },
  toolTabs: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toolTab: { paddingVertical: 4 },
  toolTabText: { fontSize: 10, letterSpacing: 1.2, paddingBottom: 3 },
  toolContent: { height: 84, justifyContent: 'center' },
  trayBusy: { alignSelf: 'center', marginLeft: Spacing.two },
  trayNote: { alignSelf: 'center', marginLeft: Spacing.three, opacity: 0.7 },
  errorLine: { color: '#e24b4a', textAlign: 'center' },
  sectionLabel: { fontSize: 9, letterSpacing: 1.2 },
  blockRow: { gap: Spacing.two, alignItems: 'flex-start', paddingRight: Spacing.four },
  block: { width: 60, alignItems: 'center', gap: 4 },
  blockLabel: { fontSize: 9, letterSpacing: 0.8 },
  blockTile: { width: 56, height: 46, borderRadius: 10, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  blockTileImg: { width: '100%', height: '100%' },
  blockTileDashed: { borderWidth: 1, borderStyle: 'dashed' },
  alignTile: { paddingHorizontal: Spacing.three, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  swatchBig: { width: 34, height: 34, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(128,128,128,0.5)' },
  // Hero
  hero: { alignSelf: 'center', borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  printZone: { position: 'absolute', borderWidth: 1, borderStyle: 'dashed', borderRadius: 4, opacity: 0.45 },
  designBox: { position: 'absolute', borderWidth: 1, borderColor: '#3b82f6' },
  handle: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#3b82f6',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  hint: { fontSize: 9, letterSpacing: 1.2, textAlign: 'center' },
  // Size
  sizeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stepBtn: { width: 34, height: 28, borderRadius: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  sliderTrack: { flex: 1, height: 6, borderRadius: 3, justifyContent: 'center' },
  sliderFill: { position: 'absolute', left: 0, height: 6, borderRadius: 3 },
  sliderThumb: { position: 'absolute', width: 18, height: 18, borderRadius: 9, marginLeft: -9, top: -6 },
  readoutRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  // Mockups + generate
  mockupItem: { alignItems: 'center', gap: 4 },
  mockupImg: { width: 120, height: 140, borderRadius: 10 },
});
