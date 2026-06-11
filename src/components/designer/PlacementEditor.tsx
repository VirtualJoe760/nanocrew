import { useEffect, useMemo, useRef, useState } from 'react';
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

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';
import { apiUrl } from '@/lib/api';

// WYSIWYG print size/placement editor (port of stephen-lawyer's PlacementEditor).
// Positions are real print-file pixels, clamped to the area; "Generate Printful mockup"
// renders the truth via the Printful mockup generator.

const EDITOR_MAX = 300;
const MIN_W = 50;

type Box = { left: number; top: number; width: number; height: number };
type Area = { placement: string; label: string; areaWidth: number; areaHeight: number };
type Entry = { placement: string; designId: string; box: Box };
type DesignOpt = { id: string; prompt: string; image?: string };

function fitClamp(b: Box, areaW: number, areaH: number, aspect: number): Box {
  let width = Math.min(Math.max(MIN_W, b.width), areaW);
  let height = width / aspect;
  if (height > areaH) {
    height = areaH;
    width = height * aspect;
  }
  const left = Math.min(Math.max(0, b.left), areaW - width);
  const top = Math.min(Math.max(0, b.top), areaH - height);
  return { left, top, width, height };
}

function defaultBox(area: Area, aspect: number): Box {
  const width = area.areaWidth * 0.8;
  const height = width / aspect;
  return fitClamp(
    { left: (area.areaWidth - width) / 2, top: (area.areaHeight - height) / 2, width, height },
    area.areaWidth,
    area.areaHeight,
    aspect,
  );
}

// The embeddable editor core — used by the standalone modal AND inside the Finalize
// sheet, so placement stays adjustable right up to publish.
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
  const [variantId, setVariantId] = useState<number | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [aspects, setAspects] = useState<Record<string, number>>({});
  const [addStep, setAddStep] = useState<'placement' | 'design' | null>(addDesignId ? 'placement' : null);
  const [pendingPlacement, setPendingPlacement] = useState<string | null>(null);
  const [mockups, setMockups] = useState<Record<string, string> | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const designById = useMemo(() => new Map(designs.map((d) => [d.id, d])), [designs]);

  // Hydrate: print areas + the composition's saved placements.
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch(apiUrl(`/api/blank/${templateKey}/printareas`)).then((r) => r.json()),
      fetch(apiUrl(`/api/compositions/${compositionId}`)).then((r) => r.json()),
    ])
      .then(
        ([pa, comp]: [
          { areas?: Area[]; variantId?: number | null },
          {
            composition?: {
              designId: string;
              placement: string;
              placements?: { placement: string; designId: string; position: Box & { areaWidth: number; areaHeight: number } | null }[];
            };
          },
        ]) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compositionId, templateKey]);

  // Natural aspect ratio per design (defaults to 1 until measured).
  useEffect(() => {
    for (const e of entries) {
      const url = designById.get(e.designId)?.image;
      if (!url || aspects[e.designId]) continue;
      RNImage.getSize(
        url,
        (w, h) => setAspects((a) => ({ ...a, [e.designId]: w && h ? w / h : 1 })),
        () => setAspects((a) => ({ ...a, [e.designId]: 1 })),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const entry = entries.find((e) => e.placement === active) ?? null;
  const area = areas.find((a) => a.placement === active) ?? null;
  const aspect = entry ? (aspects[entry.designId] ?? 1) : 1;
  const scale = area ? EDITOR_MAX / Math.max(area.areaWidth, area.areaHeight) : 1;

  const setActiveBox = (fn: (b: Box) => Box) => {
    if (!entry || !area) return;
    setEntries((list) =>
      list.map((e) =>
        e.placement === entry.placement
          ? { ...e, box: fitClamp(fn(e.box), area.areaWidth, area.areaHeight, aspect) }
          : e,
      ),
    );
  };

  // Drag-to-move / corner-drag-to-resize (PanResponder works inside Modals).
  const dragRef = useRef<{ mode: 'move' | 'resize'; box: Box } | null>(null);
  const entryRef = useRef(entry);
  entryRef.current = entry;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const makeResponder = (mode: 'move' | 'resize') =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        if (entryRef.current) dragRef.current = { mode, box: { ...entryRef.current.box } };
      },
      onPanResponderMove: (_e, g) => {
        const d = dragRef.current;
        if (!d) return;
        const ddx = g.dx / scaleRef.current;
        const ddy = g.dy / scaleRef.current;
        if (d.mode === 'move') {
          setActiveBox(() => ({ ...d.box, left: d.box.left + ddx, top: d.box.top + ddy }));
        } else {
          setActiveBox(() => ({ ...d.box, width: d.box.width + ddx }));
        }
      },
      onPanResponderRelease: () => {
        dragRef.current = null;
      },
    });
  const moveResponder = useRef(makeResponder('move')).current;
  const resizeResponder = useRef(makeResponder('resize')).current;

  const setScalePct = (pct: number) => {
    if (!entry || !area) return;
    const cx = entry.box.left + entry.box.width / 2;
    const cy = entry.box.top + entry.box.height / 2;
    const width = (pct / 100) * area.areaWidth;
    setActiveBox(() => ({ left: cx - width / 2, top: cy - width / aspect / 2, width, height: width / aspect }));
  };

  const addEntry = (placement: string, designId: string) => {
    const a = areas.find((x) => x.placement === placement);
    if (!a) return;
    setEntries((list) => [...list, { placement, designId, box: defaultBox(a, aspects[designId] ?? 1) }]);
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
          },
        };
      }),
    };
    fetch(apiUrl('/api/mockup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then((d: { mockups?: Record<string, string>; previewUrl?: string; error?: string }) => {
        if (d.error) throw new Error(d.error);
        setMockups(d.mockups ?? null);
        if (d.previewUrl) onPreview(d.previewUrl);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Mockup failed'))
      .finally(() => setRendering(false));
  };

  const availableToAdd = areas.filter((a) => !entries.some((e) => e.placement === a.placement));
  const designUrl = entry ? designById.get(entry.designId)?.image : undefined;

  if (loading) return <ActivityIndicator style={{ marginVertical: Spacing.six }} />;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.three }}>
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

              {/* Interactive print-area box */}
              {entry && area ? (
                <View style={styles.editorWrap}>
                  <View
                    style={[
                      styles.area,
                      { width: area.areaWidth * scale, height: area.areaHeight * scale, backgroundColor: theme.backgroundElement },
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
                      {designUrl ? (
                        <Image source={{ uri: designUrl }} style={styles.designFill} contentFit="fill" />
                      ) : null}
                      <View {...resizeResponder.panHandlers} style={styles.resizeCorner} hitSlop={10}>
                        <ThemedText type="small" style={styles.resizeGlyph}>
                          ⤡
                        </ThemedText>
                      </View>
                    </View>
                  </View>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                    Drag to move · drag the corner to resize · {Math.round((entry.box.width / area.areaWidth) * 100)}% of
                    print width
                  </ThemedText>
                </View>
              ) : null}

              {/* Size controls */}
              <View style={styles.chipRow}>
                {[25, 50, 75, 100].map((p) => (
                  <Pressable key={p} onPress={() => setScalePct(p)}>
                    <ThemedView type="backgroundElement" style={styles.chip}>
                      <ThemedText type="small" themeColor="textSecondary">
                        {p}%
                      </ThemedText>
                    </ThemedView>
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => area && setActiveBox((b) => ({ ...b, left: 0, width: area.areaWidth }))}>
                  <ThemedView type="backgroundElement" style={styles.chip}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Fill width
                    </ThemedText>
                  </ThemedView>
                </Pressable>
                <Pressable
                  onPress={() =>
                    area &&
                    setActiveBox((b) => ({
                      ...b,
                      left: (area.areaWidth - b.width) / 2,
                      top: (area.areaHeight - b.height) / 2,
                    }))
                  }>
                  <ThemedView type="backgroundElement" style={styles.chip}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Center
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              </View>

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
}: {
  compositionId: string;
  templateKey: string;
  designs: DesignOpt[];
  addDesignId?: string;
  onClose: () => void;
  onPreview: (previewUrl: string) => void;
}) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ThemedView type="background" style={styles.sheet}>
          <View style={styles.header}>
            <ThemedText type="smallBold">Size & placement</ThemedText>
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, alignItems: 'center' },
  chip: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.three, borderRadius: 999 },
  designRow: { gap: Spacing.two, paddingVertical: Spacing.one },
  designThumb: { width: 56, height: 56, borderRadius: Spacing.two },
  editorWrap: { alignItems: 'center', gap: Spacing.two },
  area: { borderRadius: Spacing.two, overflow: 'hidden' },
  designBox: { position: 'absolute', borderWidth: 1.5, borderColor: '#3b82f6' },
  designFill: { width: '100%', height: '100%' },
  resizeCorner: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 5,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resizeGlyph: { color: '#fff', fontSize: 11, lineHeight: 13 },
  hint: { textAlign: 'center' },
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
