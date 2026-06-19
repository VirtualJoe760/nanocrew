import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import type { DimensionValue } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NCMark } from '@/components/nc-screen';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';

import { DesignTile, tileColor } from '@/components/design-tile';
import { DesignCanvas, NODE_H, NODE_W, WEB_SLOT_LABELS, type CanvasNode } from '@/components/designer/DesignCanvas';
import { FinalizeSheet } from '@/components/designer/FinalizeSheet';
import { PlacementEditor } from '@/components/designer/PlacementEditor';
import { DOCK_TAB_CLEARANCE, TemplatesDock } from '@/components/designer/TemplatesDock';
import { ContentDock } from '@/components/designer/ContentDock';
import { WebAssetsDock } from '@/components/designer/WebAssetsDock';
import { router, useLocalSearchParams } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { apiFetch } from '@/lib/api';
import type { CatalogBlank } from '@/lib/printful';
import { EFFORT_LABELS, EFFORT_TIERS, type Effort } from '@/lib/effort';

type Design = {
  id: string;
  prompt: string;
  color: string;
  image?: string;
  status: 'generating' | 'ready';
};

const RATIOS = ['1:1', '4:5', '3:4', '16:9'];
// Web graphics want wide/site shapes (hero, banner) rather than print-on-garment ratios.
const WEB_RATIOS = ['16:9', '4:3', '1:1', '9:16'];

// The Generate sheet's three modes — each picks the model + the options shown. (Video is wired
// in a later phase; Graphics generates web-shaped images.) Adding more image models / ComfyUI
// workflows later is just extending the per-mode model list.
type Modality = 'design' | 'graphics' | 'video';
const MODALITIES: { key: Modality; label: string }[] = [
  { key: 'design', label: 'Design' },
  { key: 'graphics', label: 'Graphics' },
  { key: 'video', label: 'Video' },
];

// Every node shares the same footprint, so overlap is a simple AABB test.
const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  a.x < b.x + NODE_W && a.x + NODE_W > b.x && a.y < b.y + NODE_H && a.y + NODE_H > b.y;

// Group layout (mirrors stephen-lawyer: COL spacing, padded container, header bar).
const GROUP_COL = NODE_W + 34;
const GROUP_PAD = 16;

// Resize a group box to wrap its members (drops the box if it has none left).
function reflowGroups(nodes: CanvasNode[]): CanvasNode[] {
  const out: CanvasNode[] = [];
  for (const n of nodes) {
    if (n.kind !== 'group') {
      out.push(n);
      continue;
    }
    const members = nodes.filter((m) => m.groupId === n.id);
    if (!members.length) continue; // empty group → remove the box
    const minX = Math.min(...members.map((m) => m.x));
    const minY = Math.min(...members.map((m) => m.y));
    const maxX = Math.max(...members.map((m) => m.x + NODE_W));
    const maxY = Math.max(...members.map((m) => m.y + NODE_H));
    out.push({
      ...n,
      x: minX - GROUP_PAD,
      y: minY - GROUP_PAD,
      width: maxX - minX + 2 * GROUP_PAD,
      height: maxY - minY + 2 * GROUP_PAD,
    });
  }
  return out;
}

async function toDataUrl(uri: string): Promise<string> {
  if (uri.startsWith('data:')) return uri;
  try {
    const res = await fetch(uri);
    const blob = await res.blob();
    return await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve(uri);
      r.readAsDataURL(blob);
    });
  } catch {
    return uri;
  }
}

async function pickImage(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (perm.status !== 'granted') return null;
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    base64: true,
    quality: 0.9,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  if (a.base64) return `data:${a.mimeType ?? 'image/png'};base64,${a.base64}`;
  return toDataUrl(a.uri);
}

let designCounter = 0;
let nodeCounter = 0;

type Swatch = { color: string; colorCode: string; image: string };

export default function DesignScreen() {
  const theme = useTheme();
  const { session } = useAuth();
  const { width, height } = useWindowDimensions();

  const [designs, setDesigns] = useState<Design[]>([]);
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<{ aId: string; bId: string } | null>(null);
  const [colorNodeId, setColorNodeId] = useState<string | null>(null);
  const [colors, setColors] = useState<Swatch[]>([]);
  const [colorsLoading, setColorsLoading] = useState(false);
  // Combine sheet — opens when a design "clicks" onto a product; user picks the placement.
  const [combineTarget, setCombineTarget] = useState<{
    designNodeId: string;
    designId: string;
    tplNodeId: string;
    blankId: string;
  } | null>(null);
  const [placements, setPlacements] = useState<{ key: string; label: string; allOver: boolean }[]>([]);
  const [placementsLoading, setPlacementsLoading] = useState(false);
  const [chosenPlacement, setChosenPlacement] = useState('front');
  // PlacementEditor — opened from a composite's review modal, or by dropping a design on it.
  const [editorComp, setEditorComp] = useState<{
    id: string;
    templateKey: string;
    addDesignId?: string;
  } | null>(null);
  const [finalizeComp, setFinalizeComp] = useState<{
    id: string;
    templateKey: string;
    defaultName: string;
  } | null>(null);
  // Toolbar: select / box-select / blend (mirrors stephen-lawyer's DesignerToolbar).
  const [tool, setTool] = useState<'select' | 'box'>('select');
  const [selection, setSelection] = useState<string[]>([]);
  const selectedNodes = selection
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is CanvasNode => !!n);
  const selDesigns = selectedNodes.filter((n) => n.kind === 'design');
  const selTemplates = selectedNodes.filter((n) => n.kind === 'template');
  const canBlend =
    (selDesigns.length === 2 && selectedNodes.length === 2) ||
    (selDesigns.length === 1 && selTemplates.length === 1 && selectedNodes.length === 2);

  const blendSelection = () => {
    if (!canBlend) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (selDesigns.length === 2) {
      setMergeTarget({ aId: selDesigns[0].refId, bId: selDesigns[1].refId });
    } else {
      setCombineTarget({
        designNodeId: selDesigns[0].id,
        designId: selDesigns[0].refId,
        tplNodeId: selTemplates[0].id,
        blankId: selTemplates[0].refId,
      });
    }
  };

  useEffect(() => {
    if (!combineTarget) return;
    setPlacements([]);
    setChosenPlacement('front');
    setPlacementsLoading(true);
    apiFetch(`/api/blank/${combineTarget.blankId}/placements`)
      .then((r) => r.json())
      .then((d: { placements?: { key: string; label: string; allOver: boolean }[] }) => {
        setPlacements(d.placements ?? []);
        if (d.placements?.length && !d.placements.some((p) => p.key === 'front')) {
          setChosenPlacement(d.placements[0].key);
        }
      })
      .catch(() => setPlacements([]))
      .finally(() => setPlacementsLoading(false));
  }, [combineTarget]);
  // Catalogues (collections) — DB-backed via /api/catalogues + /api/canvas/[id].
  const [catalogue, setCatalogue] = useState<{ id: string; name: string } | null>(null);
  const [catalogues, setCatalogues] = useState<{ id: string; name: string }[]>([]);
  const [catSheetOpen, setCatSheetOpen] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [newCatSeason, setNewCatSeason] = useState<string | null>(null);
  // Brand (store) context — the Design tab is scoped to one brand at a time. The setup popup
  // (brand → collection) is the FIRST thing on entering the tab; the top-left chip reopens it.
  type Brand = { id: string; slug: string; name: string };
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brand, setBrand] = useState<Brand | null>(null);
  const brandRef = useRef<Brand | null>(null);
  brandRef.current = brand;
  const [setupStep, setSetupStep] = useState<'brand' | 'collection'>('brand');
  const catalogueRef = useRef<{ id: string; name: string } | null>(null);
  catalogueRef.current = catalogue;
  const [blanks, setBlanks] = useState<CatalogBlank[]>([]);
  const [blanksLoading, setBlanksLoading] = useState(true);
  const [dockHeight, setDockHeight] = useState(160);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  // Which target panel the dock shows: apparel to print on, the site's slots, or video.
  const [dockPanel, setDockPanel] = useState<'products' | 'web' | 'content'>('products');
  // Deep-link from a Studio bounty (?panel=web) opens that panel with the dock expanded.
  const { panel: panelParam } = useLocalSearchParams<{ panel?: string }>();
  useEffect(() => {
    if (panelParam === 'products' || panelParam === 'web' || panelParam === 'content') {
      setDockPanel(panelParam);
      setDockCollapsed(false);
    }
  }, [panelParam]);

  // A product on the canvas with no design yet → the next step is Generate: collapse the
  // dock and pulse the Generate button red. Everything grouped → dock open for browsing.
  const hasUngroupedTemplate = nodes.some((n) => n.kind === 'template' && !n.groupId);
  useEffect(() => {
    setDockCollapsed(hasUngroupedTemplate);
  }, [hasUngroupedTemplate]);

  // The dock handle: swipe up to expand the product list, swipe down to collapse it
  // (a quick tap still toggles). Direction wins over distance via velocity.
  const dockGesture = useMemo(
    () =>
      Gesture.Race(
        Gesture.Tap().maxDuration(250).onEnd(() => runOnJS(setDockCollapsed)((c) => !c)),
        Gesture.Pan()
          .activeOffsetY([-8, 8])
          .onEnd((e) => {
            'worklet';
            const up = e.translationY < -8 || e.velocityY < -250;
            const down = e.translationY > 8 || e.velocityY > 250;
            if (up) runOnJS(setDockCollapsed)(false);
            else if (down) runOnJS(setDockCollapsed)(true);
          }),
      ),
    [],
  );

  const fabPulse = useSharedValue(1);
  useEffect(() => {
    if (hasUngroupedTemplate) {
      fabPulse.value = withRepeat(
        withSequence(withTiming(1.08, { duration: 520 }), withTiming(1, { duration: 520 })),
        -1,
        true,
      );
    } else {
      cancelAnimation(fabPulse);
      fabPulse.value = withTiming(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUngroupedTemplate]);
  const fabPulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: fabPulse.value }] }));
  const nodesRef = useRef<CanvasNode[]>(nodes);
  nodesRef.current = nodes;

  // Canvas transform shared values are OWNED by DesignCanvas (creating them here and passing
  // as props breaks useAnimatedStyle's transform reactivity on physical iOS — Reanimated #6276).
  // DesignCanvas registers them into this ref so addNode can still place nodes at the view center.
  const viewportRef = useRef<{
    tx: SharedValue<number>;
    ty: SharedValue<number>;
    scale: SharedValue<number>;
  } | null>(null);
  const addOffset = useRef(0);

  useEffect(() => {
    let alive = true;
    apiFetch('/api/blanks')
      .then((r) => r.json())
      .then((d: { blanks?: CatalogBlank[] }) => {
        if (alive && d.blanks) setBlanks(d.blanks);
      })
      .catch(() => {})
      .finally(() => alive && setBlanksLoading(false));
    // First thing on the Design tab: choose the brand you're designing for, then the collection.
    // Load the creator's brands and open the setup popup. One brand → pre-select it and jump to
    // the collection step; otherwise start at the brand step.
    //
    // Source the brand list from /api/me — the SAME lightweight endpoint Studio + Account use —
    // not /api/creator/stats. stats runs 5 aggregations and selects many extra columns; any one
    // failing 500s the whole call, which (with the old silent `.catch`) left Design showing "no
    // brands" while Studio/Account showed them fine for the same account. Design only needs
    // id/slug/name, so /api/me gives guaranteed parity.
    apiFetch('/api/me')
      .then((r) => r.json())
      .then((d: { stores?: Brand[] }) => {
        if (!alive) return;
        const list = (d.stores ?? []).map((s) => ({ id: s.id, slug: s.slug, name: s.name }));
        setBrands(list);
        setCatSheetOpen(true);
        if (list.length === 1) chooseBrand(list[0]);
        else setSetupStep('brand');
      })
      .catch((e) => {
        // Don't fail silently — open the picker on the brand step so the user can retry,
        // and surface the error rather than masquerading as "no brands".
        if (!alive) return;
        console.warn('[design] failed to load brands', e);
        setCatSheetOpen(true);
        setSetupStep('brand');
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Persistence: hydrate a catalogue's canvas, debounce-save node changes ----

  type DbNode = {
    id: string;
    kind: string;
    refId: string;
    groupId: string | null;
    x: number;
    y: number;
    width: number | null;
    height: number | null;
    scale: number; // integer percent
    colorImage: string | null;
    selectedColor: string | null;
  };
  type DbComposition = {
    id: string;
    designId: string;
    templateKey: string;
    previewUrl: string | null;
    status: string;
  };

  const loadCatalogue = (catId: string) => {
    apiFetch(`/api/canvas/${catId}`)
      .then((r) => r.json())
      .then(
        (d: {
          designs?: { id: string; prompt: string; url: string }[];
          nodes?: DbNode[];
          compositions?: DbComposition[];
        }) => {
          if (catalogueRef.current?.id !== catId) return; // switched away while loading
          const comps = new Map((d.compositions ?? []).map((c) => [c.id, c]));
          // Group link keys (stored in the group row's own groupId) → fresh DB row ids.
          const groupKeyToId = new Map(
            (d.nodes ?? [])
              .filter((n) => n.kind === 'group' && n.groupId)
              .map((n) => [n.groupId as string, n.id]),
          );
          setDesigns(
            (d.designs ?? []).map((row) => ({
              id: row.id,
              prompt: row.prompt,
              color: tileColor(row.prompt),
              image: row.url,
              status: 'ready' as const,
            })),
          );
          const mapped = (d.nodes ?? []).map((n) => {
            const base: CanvasNode = {
              id: n.id,
              kind: n.kind as CanvasNode['kind'],
              refId: n.refId,
              groupId:
                n.kind !== 'group' && n.groupId
                  ? (groupKeyToId.get(n.groupId) ?? undefined)
                  : undefined,
              x: n.x,
              y: n.y,
              width: n.width ?? undefined,
              height: n.height ?? undefined,
              scale: (n.scale || 100) / 100,
              colorImage: n.colorImage ?? undefined,
              selectedColor: n.selectedColor ?? undefined,
            };
            if (n.kind === 'composition') {
              const c = comps.get(n.refId);
              if (c) {
                base.designRef = c.designId;
                base.blankRef = c.templateKey;
                base.previewUrl = c.previewUrl ?? undefined;
                base.status = 'ready';
              }
            }
            return base;
          });
          // A web-slot that's had a design assigned becomes a finished group. The asset is already
          // saved to the site, so we don't keep that group sitting on the canvas — strip any group
          // wrapping a web-slot (and its members) on load. Unassigned slots (no groupId) stay.
          const webGroupIds = new Set(
            mapped.filter((n) => n.kind === 'webslot' && n.groupId).map((n) => n.groupId as string),
          );
          setNodes(
            webGroupIds.size
              ? mapped.filter((n) => !webGroupIds.has(n.id) && !(n.groupId && webGroupIds.has(n.groupId)))
              : mapped,
          );
        },
      )
      .catch(() => {});
  };

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSave = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const cat = catalogueRef.current;
      if (!cat) return;
      const body = {
        nodes: nodesRef.current
          .filter((n) => !(n.kind === 'composition' && !n.refId)) // skip not-yet-created comps
          .map((n) => ({
            kind: n.kind,
            refId: n.refId,
            // Group rows store their own client id as the link key; members reference it.
            // Hydration rewrites member groupIds to the fresh DB row ids.
            groupId: n.kind === 'group' ? n.id : (n.groupId ?? null),
            x: n.x,
            y: n.y,
            width: n.width ?? null,
            height: n.height ?? null,
            scale: n.scale ?? 1,
            colorImage: n.colorImage ?? null,
            selectedColor: n.selectedColor ?? null,
          })),
      };
      apiFetch(`/api/canvas/${cat.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => {});
    }, 600);
  };

  const designLookup = useMemo(
    () =>
      Object.fromEntries(
        designs.map((d) => [d.id, { prompt: d.prompt, color: d.color, image: d.image }]),
      ),
    [designs],
  );
  const blankLookup = useMemo(
    () => Object.fromEntries(blanks.map((b) => [String(b.id), { name: b.name, image: b.image }])),
    [blanks],
  );

  const addNode = (kind: CanvasNode['kind'], refId: string) => {
    const vp = viewportRef.current;
    const s = vp?.scale.value || 1;
    const off = (addOffset.current = (addOffset.current + 1) % 6);
    const screenX = width / 2 + off * 14;
    const screenY = height * 0.4 + off * 14;
    const x = (screenX - (vp?.tx.value ?? 0)) / s - NODE_W / 2;
    const y = (screenY - (vp?.ty.value ?? 0)) / s - NODE_H / 2;
    setNodes((n) => [...n, { id: `n${++nodeCounter}`, kind, refId, x, y }]);
    scheduleSave();
  };

  const onNodeRemove = (id: string) => {
    setNodes((n) => reflowGroups(n.filter((node) => node.id !== id)));
    scheduleSave();
  };

  // Delete a design from the top bar: drop it from history, prune any canvas nodes that
  // reference it (the design tile + composites built from it), and remove the DB row.
  // Persisted designs have a uuid; a still-generating temp design (id "d3") only lives
  // in-session, so skip the API call for those.
  const deleteDesign = (id: string) => {
    setDesigns((prev) => prev.filter((d) => d.id !== id));
    setNodes((n) =>
      reflowGroups(
        n.filter(
          (node) =>
            !(
              (node.kind === 'design' && node.refId === id) ||
              (node.kind === 'composition' && node.designRef === id)
            ),
        ),
      ),
    );
    scheduleSave();
    if (id.includes('-')) {
      apiFetch(`/api/designs/${id}`, { method: 'DELETE' }).catch(() => {});
    }
  };

  // Assign a hosted graphic to a website slot (hero / collection cover / logo) — a direct DB write
  // that overrides the storefront placeholder, then revalidates the live site.
  const assignToSite = async (url: string | undefined, slot: 'hero' | 'cover' | 'logo' | 'og') => {
    const catId = catalogueRef.current?.id;
    if (!catId || !url || !url.startsWith('http')) return;
    try {
      const res = await apiFetch('/api/creator/site-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalogueId: catId, slot, url }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error || 'Failed');
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert(
        'Done',
        slot === 'hero'
          ? 'Set as your website hero — your site is updating.'
          : slot === 'logo'
            ? 'Set as your brand logo.'
            : slot === 'og'
              ? 'Set as your social-share image — used when your site is shared.'
              : 'Set as this collection’s cover.',
      );
    } catch (e) {
      Alert.alert('Could not assign', e instanceof Error ? e.message : 'Try again.');
    }
  };
  const assignDesign = (d: Design, slot: 'hero' | 'cover' | 'logo' | 'og') => void assignToSite(d.image, slot);

  // Long-press a graphic → assign it to the website or remove it.
  const openDesignActions = (d: Design) => {
    Haptics.selectionAsync().catch(() => {});
    const canAssign = typeof d.image === 'string' && d.image.startsWith('http');
    Alert.alert(
      'Use this graphic',
      canAssign ? 'Assign it to your website, or remove it.' : 'Save the graphic first, then you can assign it.',
      [
        ...(canAssign
          ? [
              { text: 'Set as website hero', onPress: () => void assignDesign(d, 'hero') },
              { text: 'Set as collection cover', onPress: () => void assignDesign(d, 'cover') },
              { text: 'Set as logo', onPress: () => void assignDesign(d, 'logo') },
              { text: 'Set as social image', onPress: () => void assignDesign(d, 'og') },
            ]
          : []),
        { text: 'Delete', style: 'destructive' as const, onPress: () => deleteDesign(d.id) },
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  };

  // Reset the canvas: clear every node (the designs in the top bar are kept to reuse).
  const resetCanvas = () => {
    if (nodesRef.current.length === 0) return;
    Alert.alert(
      'Reset canvas?',
      'Clears everything on the canvas. Your generated designs stay in the top bar.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            setNodes([]);
            scheduleSave();
          },
        },
      ],
    );
  };

  const onNodeResize = (id: string, s: number) => {
    setNodes((n) => n.map((node) => (node.id === id ? { ...node, scale: s } : node)));
    scheduleSave();
  };

  // Render the design ON the garment (Nano Banana composeOnGarment) for a composite node.
  // compositionId is the DB row — preview + status persist there.
  const renderComposite = (
    nodeId: string,
    compositionId: string | null,
    designId: string,
    blankRefId: string,
    placement = 'front',
    designUrlOverride?: string,
  ) => {
    const designImg = designUrlOverride ?? designs.find((d) => d.id === designId)?.image;
    const blank = blanks.find((b) => String(b.id) === blankRefId);
    const finish = (previewUrl?: string) => {
      setNodes((p) =>
        p.map((n) => (n.id === nodeId ? { ...n, status: 'ready', previewUrl } : n)),
      );
      scheduleSave();
      if (compositionId) {
        apiFetch(`/api/compositions/${compositionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            previewUrl ? { previewUrl, status: 'draft' } : { status: 'failed' },
          ),
        }).catch(() => {});
      }
    };
    if (!designImg || !blank?.image) {
      finish();
      return;
    }
    apiFetch('/api/composite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        designUrl: designImg,
        garmentUrl: blank.image,
        placement,
        garmentName: blank.name,
      }),
    })
      .then((r) => r.json())
      .then((d: { image?: string }) => finish(d.image))
      .catch(() => finish());
  };

  const onNodeMove = (id: string, x: number, y: number) => {
    const prev = nodesRef.current;
    const moved = prev.find((n) => n.id === id);
    if (!moved) return;
    const movedNew = { ...moved, x, y };
    let next = prev.map((n) => (n.id === id ? movedNew : n));

    if (moved.kind === 'design') {
      // Dropped on a website-slot target → assign this design to that site asset (hero/logo/cover).
      const slotNode = next.find((n) => n.kind === 'webslot' && overlaps(movedNew, n));
      const tpl = next.find((n) => n.kind === 'template' && overlaps(movedNew, n));
      if (slotNode) {
        const img = designs.find((d) => d.id === moved.refId)?.image;
        if (img && img.startsWith('http')) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          // "Click together": group the design with the slot — the design takes the slot's spot,
          // the slot slides right showing the assigned image — same grouped-row spring as a
          // design+product link. reflowGroups (below) sizes the wrapping box.
          const gx = slotNode.x;
          const gy = slotNode.y;
          const groupNodeId = `g${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
          const groupName = WEB_SLOT_LABELS[slotNode.refId] ?? 'Web slot';
          next = next.map((n) =>
            n.id === moved.id
              ? { ...n, x: gx, y: gy, groupId: groupNodeId }
              : n.id === slotNode.id
                ? { ...n, x: gx + GROUP_COL, y: gy, groupId: groupNodeId, previewUrl: img }
                : n,
          );
          next = [
            ...next,
            {
              id: groupNodeId,
              kind: 'group' as const,
              refId: groupName,
              x: gx - GROUP_PAD,
              y: gy - GROUP_PAD,
              width: GROUP_COL + NODE_W + 2 * GROUP_PAD,
              height: NODE_H + 2 * GROUP_PAD,
            },
          ];
          void assignToSite(img, slotNode.refId as 'hero' | 'cover' | 'logo' | 'og');
          // The design + slot "click together", then the finished group clears off the canvas —
          // it's assigned to the site now, so it shouldn't keep sitting there. Let the snap
          // animation play, then drop the design, the slot, and the wrapping group.
          const gid = groupNodeId;
          setTimeout(() => {
            const after = reflowGroups(nodesRef.current.filter((n) => n.groupId !== gid && n.id !== gid));
            nodesRef.current = after;
            setNodes(after);
            scheduleSave();
          }, 1300);
        } else {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        }
      } else if (tpl) {
        // The "click": haptic + the Combine sheet asks which placement to print. The
        // design stays exactly where it was dropped until the user confirms — the
        // organized row layout happens in doCombine.
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        setCombineTarget({ designNodeId: id, designId: moved.refId, tplNodeId: tpl.id, blankId: tpl.refId });
      } else {
        // Dropped on an existing composite → add this design as another placement.
        const comp = next.find(
          (n) => n.kind === 'composition' && n.refId && n.blankRef && overlaps(movedNew, n),
        );
        if (comp) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          setEditorComp({ id: comp.refId, templateKey: comp.blankRef!, addDesignId: moved.refId });
        } else {
          const other = next.find(
            (n) => n.kind === 'design' && n.id !== id && overlaps(movedNew, n),
          );
          if (other) setMergeTarget({ aId: moved.refId, bId: other.refId });
        }
      }
    }

    next = reflowGroups(next);
    nodesRef.current = next;
    setNodes(next);
    scheduleSave();
  };

  // Confirmed from the Combine sheet: lay out [design][product][composite] in a grouped
  // row (members spring into place — the "click together"), create the composition row,
  // and kick off the on-garment render for the chosen placement.
  const doCombine = (placement: string) => {
    const target = combineTarget;
    setCombineTarget(null);
    if (!target) return;
    const prev = nodesRef.current;
    const designNode = prev.find((n) => n.id === target.designNodeId);
    const tpl = prev.find((n) => n.id === target.tplNodeId);
    if (!designNode || !tpl) return;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    // Rightward layout (mirrors stephen-lawyer): the design takes the product's spot,
    // the product slides right, the composite appears at the far right.
    const gx = tpl.x;
    const gy = tpl.y;
    const nodeId = `c${++nodeCounter}`;
    // Group ids are persisted as the group's link key — they MUST be globally unique
    // (a session counter resets on reload and collides across sessions).
    const groupNodeId = `g${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const groupName = `Group ${prev.filter((n) => n.kind === 'group').length + 1}`;
    let next = prev.map((n) =>
      n.id === designNode.id
        ? { ...n, x: gx, y: gy, groupId: groupNodeId }
        : n.id === tpl.id
          ? { ...n, x: gx + GROUP_COL, y: gy, groupId: groupNodeId }
          : n,
    );
    next = [
      ...next,
      {
        id: nodeId,
        kind: 'composition' as const,
        refId: '', // set to the composition row id once created
        x: gx + 2 * GROUP_COL,
        y: gy,
        groupId: groupNodeId,
        designRef: target.designId,
        blankRef: target.blankId,
        status: 'generating' as const,
      },
      {
        id: groupNodeId,
        kind: 'group' as const,
        refId: groupName,
        x: gx - GROUP_PAD,
        y: gy - GROUP_PAD,
        width: 2 * GROUP_COL + NODE_W + 2 * GROUP_PAD,
        height: NODE_H + 2 * GROUP_PAD,
      },
    ];
    nodesRef.current = next;
    setNodes(next);
    scheduleSave();

    // Recenter the camera on the freshly formed group so the row never lands off-screen.
    const vp = viewportRef.current;
    if (vp) {
      const s = vp.scale.value || 1;
      const groupCx = gx + GROUP_COL + NODE_W / 2; // middle column center
      const groupCy = gy + NODE_H / 2;
      vp.tx.value = withTiming(width / 2 - groupCx * s, { duration: 420 });
      vp.ty.value = withTiming(height * 0.38 - groupCy * s, { duration: 420 });
    }

    apiFetch('/api/compositions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        catalogueId: catalogueRef.current?.id,
        designId: target.designId,
        templateKey: target.blankId,
        placement,
      }),
    })
      .then((r) => r.json())
      .then(
        (d: {
          composition?: { id: string };
          adaptedDesign?: { id: string; url: string; prompt: string };
          technique?: string;
        }) => {
          const compositionId = d.composition?.id ?? null;
          let designId = target.designId;
          let designUrl: string | undefined;
          if (d.adaptedDesign) {
            // Fabrication requirement (e.g. knitwear): the design was regenerated to
            // match what the technique can produce — tell the user and carry on.
            designId = d.adaptedDesign.id;
            designUrl = d.adaptedDesign.url;
            setDesigns((prev) => [
              {
                id: d.adaptedDesign!.id,
                prompt: d.adaptedDesign!.prompt,
                color: tileColor(d.adaptedDesign!.prompt),
                image: d.adaptedDesign!.url,
                status: 'ready',
              },
              ...prev,
            ]);
            Alert.alert(
              'Design adapted for knitting',
              'This product is knitted from yarn, which can only reproduce bold flat shapes in a few colors. We generated a knit-friendly version of your design and used it for this product — the original is untouched.',
            );
          }
          if (compositionId) {
            setNodes((p) =>
              p.map((n) =>
                n.id === nodeId ? { ...n, refId: compositionId, designRef: designId } : n,
              ),
            );
          }
          renderComposite(nodeId, compositionId, designId, target.blankId, placement, designUrl);
        },
      )
      .catch(() => renderComposite(nodeId, null, target.designId, target.blankId, placement));
  };

  const onGroupMove = (id: string, x: number, y: number) => {
    const prev = nodesRef.current;
    const group = prev.find((n) => n.id === id);
    if (!group) return;
    const dx = x - group.x;
    const dy = y - group.y;
    const next = prev.map((n) =>
      n.id === id
        ? { ...n, x, y }
        : n.groupId === id
          ? { ...n, x: n.x + dx, y: n.y + dy }
          : n,
    );
    nodesRef.current = next;
    setNodes(next);
    scheduleSave();
  };

  const onUngroup = (id: string) => {
    setNodes((prev) =>
      prev
        .filter((n) => n.id !== id)
        .map((n) => (n.groupId === id ? { ...n, groupId: undefined } : n)),
    );
    scheduleSave();
  };

  const onNodeTap = (id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (node?.kind === 'composition') setReviewId(id);
    else if (node?.kind === 'template') openColorPicker(id, node.refId);
  };

  const openColorPicker = (id: string, blankId: string) => {
    setColorNodeId(id);
    setColors([]);
    setColorsLoading(true);
    apiFetch(`/api/blank/${blankId}/colors`)
      .then((r) => r.json())
      .then((d: { colors?: Swatch[] }) => setColors(d.colors ?? []))
      .catch(() => setColors([]))
      .finally(() => setColorsLoading(false));
  };

  const pickColor = (c: Swatch) => {
    setNodes((n) =>
      n.map((node) =>
        node.id === colorNodeId ? { ...node, colorImage: c.image, selectedColor: c.color } : node,
      ),
    );
    setColorNodeId(null);
    scheduleSave();
  };

  // Setup step 1: pick the brand → load its collections and advance to the collection step.
  const chooseBrand = (b: Brand) => {
    setBrand(b);
    brandRef.current = b;
    setCatalogues([]);
    setSetupStep('collection');
    apiFetch(`/api/catalogues?store=${encodeURIComponent(b.slug)}`)
      .then((r) => r.json())
      .then((d: { catalogues?: { id: string; name: string }[] }) => setCatalogues(d.catalogues ?? []))
      .catch(() => {});
  };

  const switchCatalogue = (cat: { id: string; name: string }) => {
    setCatSheetOpen(false);
    if (cat.id === catalogue?.id) return;
    setCatalogue(cat);
    catalogueRef.current = cat;
    setDesigns([]);
    setNodes([]);
    loadCatalogue(cat.id);
  };

  const createCatalogue = (name: string, season?: string) => {
    const n = name.trim();
    if (!n) return;
    apiFetch('/api/catalogues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: n, season, storeSlug: brandRef.current?.slug }),
    })
      .then((r) => r.json())
      .then((d: { catalogue?: { id: string; name: string } }) => {
        if (!d.catalogue) return;
        setCatalogues((c) => [...c, d.catalogue!]);
        setCatalogue(d.catalogue);
        catalogueRef.current = d.catalogue;
        setDesigns([]);
        setNodes([]);
      })
      .catch(() => {});
    setNewCat('');
    setCatSheetOpen(false);
  };

  const discardComposite = (id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (node?.refId) {
      apiFetch(`/api/compositions/${node.refId}`, { method: 'DELETE' }).catch(() => {});
    }
    setNodes((n) => n.filter((node) => node.id !== id));
    setReviewId(null);
    scheduleSave();
  };

  // Land an APPROVED graphic (from GenerateModal's staged review) onto the canvas history and
  // persist it to the active catalogue. Generation + staging now happen inside the sheet; this
  // just commits the result. An already-hosted https url is stored as-is; an uploaded data: URL
  // gets uploaded by /api/designs.
  const commitDesign = async (staged: { url: string; prompt: string }) => {
    const catId = catalogueRef.current?.id;
    const tempId = `d${++designCounter}`;
    setDesigns((prev) => [
      { id: tempId, prompt: staged.prompt, color: tileColor(staged.prompt || tempId), image: staged.url, status: 'ready' },
      ...prev,
    ]);
    if (!catId) return;
    try {
      const isData = staged.url.startsWith('data:');
      const res = await apiFetch('/api/designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isData
            ? { catalogueId: catId, dataUrl: staged.url, name: staged.prompt }
            : { catalogueId: catId, url: staged.url, name: staged.prompt },
        ),
      });
      const data = (await res.json().catch(() => ({}))) as { design?: { id: string; url: string } };
      if (data.design) {
        const row = data.design;
        setDesigns((prev) => prev.map((d) => (d.id === tempId ? { ...d, id: row.id, image: row.url } : d)));
      }
    } catch {
      // Persistence failed — design stays usable in-session.
    }
  };

  // The blend: Nano Banana gets BOTH design images plus the collision prompt.
  const doMerge = async (aId: string, bId: string, collision: string) => {
    setMergeTarget(null);
    const tempId = `d${++designCounter}`;
    const label = `Merge — ${collision.trim() || 'fused'}`;
    setDesigns((prev) => [
      { id: tempId, prompt: label, color: tileColor(label), status: 'generating' },
      ...prev,
    ]);
    try {
      const res = await apiFetch('/api/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          designAId: aId,
          designBId: bId,
          prompt: collision.trim(),
          catalogueId: catalogueRef.current?.id,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        image?: string;
        id?: string;
        error?: string;
      };
      if (!res.ok || !data.image) throw new Error(data.error || 'Merge failed');
      setDesigns((prev) =>
        prev.map((d) =>
          d.id === tempId
            ? { ...d, id: data.id ?? tempId, image: data.image, status: 'ready' }
            : d,
        ),
      );
    } catch {
      setDesigns((prev) => prev.map((d) => (d.id === tempId ? { ...d, status: 'ready' } : d)));
    }
  };

  if (!session) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.gateWrap}>
          <ThemedText style={[styles.gateSpark, { color: theme.tint }]}>✦</ThemedText>
          <ThemedText type="title" style={styles.gateTitle}>
            Design your products
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.gateBody}>
            Generate AI artwork, drop it onto real apparel, and build collections for your
            store. Sign in to start designing.
          </ThemedText>
          <Pressable onPress={() => router.navigate('/account')}>
            <View style={[styles.gateBtn, { backgroundColor: theme.text }]}>
              <ThemedText type="smallBold" style={{ color: theme.background }}>
                Create an account
              </ThemedText>
            </View>
          </Pressable>
          <Pressable onPress={() => router.navigate('/account')} hitSlop={8}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.gateLogin}>
              I already have one — log in
            </ThemedText>
          </Pressable>
          <ThemedText type="code" themeColor="textSecondary" style={styles.gateFoot}>
            Free to explore. You only need a plan to launch a store.
          </ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      {/* Top: designs history bar */}
      <SafeAreaView edges={['top']}>
        <View style={styles.topBar}>
          <NCMark size={20} color={theme.text} />
          <Pressable
            onPress={() => {
              setSetupStep('brand');
              setCatSheetOpen(true);
            }}
            style={styles.catChip}
            hitSlop={6}>
            <ThemedText type="code" themeColor="tint" style={styles.eyebrow} numberOfLines={1}>
              {brand ? `${brand.name}${catalogue ? ` · ${catalogue.name}` : ''}` : 'Design'} ▾
            </ThemedText>
          </Pressable>
          {designs.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.flex}>
              No designs yet — tap Generate
            </ThemedText>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.thumbRow}
              style={styles.flex}>
              {designs.map((d) =>
                d.status === 'generating' ? (
                  <View
                    key={d.id}
                    style={[styles.pendingThumb, { backgroundColor: theme.backgroundSelected }]}>
                    <ThemedText type="small" themeColor="textSecondary">
                      …
                    </ThemedText>
                  </View>
                ) : (
                  <Pressable
                    key={d.id}
                    onPress={() => addNode('design', d.id)}
                    onLongPress={() => openDesignActions(d)}
                    delayLongPress={350}>
                    {d.image ? (
                      <Image source={{ uri: d.image }} style={styles.thumbImg} contentFit="cover" />
                    ) : (
                      <DesignTile color={d.color} style={styles.thumb} />
                    )}
                  </Pressable>
                ),
              )}
            </ScrollView>
          )}
        </View>
      </SafeAreaView>

      {/* Middle: the canvas */}
      <View style={styles.canvasWrap}>
        <DesignCanvas
          nodes={nodes}
          designs={designLookup}
          blanks={blankLookup}
          tool={tool}
          onNodeMove={onNodeMove}
          onNodeTap={onNodeTap}
          onNodeRemove={onNodeRemove}
          onNodeResize={onNodeResize}
          onGroupMove={onGroupMove}
          onUngroup={onUngroup}
          onSelectionChange={setSelection}
          viewportRef={viewportRef}
        />

        {/* Toolbar: select · box-select · blend */}
        <ThemedView type="backgroundElement" style={styles.toolbar}>
          <Pressable onPress={() => setTool('select')} style={styles.toolBtn} hitSlop={4}>
            <ThemedView
              type={tool === 'select' ? 'backgroundSelected' : 'backgroundElement'}
              style={styles.toolBtnInner}>
              <ThemedText type="small">➤</ThemedText>
            </ThemedView>
          </Pressable>
          <Pressable onPress={() => setTool('box')} style={styles.toolBtn} hitSlop={4}>
            <ThemedView
              type={tool === 'box' ? 'backgroundSelected' : 'backgroundElement'}
              style={styles.toolBtnInner}>
              <ThemedText type="small">▭</ThemedText>
            </ThemedView>
          </Pressable>
          <Pressable onPress={blendSelection} disabled={!canBlend} style={styles.toolBtn} hitSlop={4}>
            <ThemedView type="backgroundElement" style={[styles.toolBtnInner, { opacity: canBlend ? 1 : 0.35 }]}>
              <ThemedText type="small">⧉</ThemedText>
            </ThemedView>
          </Pressable>
          <Pressable onPress={resetCanvas} style={styles.toolBtn} hitSlop={4}>
            <ThemedView type="backgroundElement" style={styles.toolBtnInner}>
              <ThemedText type="small">↺</ThemedText>
            </ThemedView>
          </Pressable>
        </ThemedView>
      </View>

      {/* Bottom: templates dock (full Printful catalogue). Collapsible — auto-collapses
          when a product is waiting for a design (the next step is Generate, not browsing). */}
      <View
        style={[
          styles.dockWrap,
          {
            borderTopColor: theme.backgroundElement,
            // Collapsed, the handle must still clear the bottom tab bar (the expanded
            // product list carries this clearance inside its own scroll content).
            paddingBottom: dockCollapsed ? DOCK_TAB_CLEARANCE : 0,
          },
        ]}
        onLayout={(e) => setDockHeight(e.nativeEvent.layout.height)}>
        <GestureDetector gesture={dockGesture}>
          <View style={styles.dockHandle}>
            <View style={[styles.dockGrip, { backgroundColor: theme.backgroundSelected }]} />
            <ThemedText type="small" themeColor="textSecondary">
              {dockCollapsed ? '▲  Swipe up for products' : '▼  Swipe down to hide'}
            </ThemedText>
          </View>
        </GestureDetector>
        {dockCollapsed ? null : (
          <>
            {/* Pick what you're attaching a generation to: apparel, a website slot, or video. */}
            <View style={styles.dockToggle}>
              {(
                [
                  ['products', 'Products'],
                  ['web', 'Web assets'],
                  ['content', 'Content'],
                ] as const
              ).map(([key, label]) => (
                <Pressable key={key} style={styles.flex} onPress={() => setDockPanel(key)}>
                  <ThemedView
                    type={dockPanel === key ? 'backgroundSelected' : 'backgroundElement'}
                    style={styles.dockToggleTab}>
                    <ThemedText type="small" themeColor={dockPanel === key ? 'text' : 'textSecondary'}>
                      {label}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              ))}
            </View>
            {dockPanel === 'products' ? (
              <TemplatesDock
                blanks={blanks}
                loading={blanksLoading}
                onAdd={(b) => addNode('template', String(b.id))}
              />
            ) : dockPanel === 'web' ? (
              <WebAssetsDock
                onAddSlot={(slot) => {
                  addNode('webslot', slot);
                  setDockCollapsed(true);
                }}
              />
            ) : (
              <ContentDock />
            )}
          </>
        )}
      </View>

      {/* Generate FAB — pulses red when a product on the canvas is waiting for a design. */}
      <AnimatedPressable
        onPress={() => setGenerateOpen(true)}
        style={[
          styles.fab,
          { backgroundColor: hasUngroupedTemplate ? '#e11d48' : theme.text, bottom: dockHeight + Spacing.three },
          fabPulseStyle,
        ]}>
        <ThemedText type="smallBold" style={{ color: hasUngroupedTemplate ? '#fff' : theme.background }}>
          ✦ Generate
        </ThemedText>
      </AnimatedPressable>

      <GenerateModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        onCommit={(staged) => {
          void commitDesign(staged);
          setGenerateOpen(false);
        }}
      />

      {/* Composite review */}
      {reviewId
        ? (() => {
            const node = nodes.find((n) => n.id === reviewId);
            if (!node) return null;
            const d = designs.find((x) => x.id === node.designRef);
            const blankName = blanks.find((b) => String(b.id) === node.blankRef)?.name ?? 'Product';
            return (
              <Modal visible transparent animationType="fade" onRequestClose={() => setReviewId(null)}>
                <View style={styles.reviewBackdrop}>
                  <ThemedView type="background" style={styles.reviewCard}>
                    <View style={styles.sheetHeader}>
                      <ThemedText type="code" themeColor="textSecondary">
                        {node.status === 'generating' ? 'COMPOSITE · RENDERING' : 'COMPOSITE · DRAFT'}
                      </ThemedText>
                      <Pressable onPress={() => setReviewId(null)}>
                        <ThemedText type="small" themeColor="textSecondary">
                          Close
                        </ThemedText>
                      </Pressable>
                    </View>
                    <View
                      style={[
                        styles.reviewThumb,
                        { backgroundColor: d?.color ?? theme.backgroundElement },
                      ]}>
                      {node.previewUrl || d?.image ? (
                        <Image
                          source={{ uri: node.previewUrl ?? d?.image }}
                          style={styles.reviewImg}
                          contentFit="contain"
                        />
                      ) : (
                        <ThemedText style={styles.reviewGlyph}>👕</ThemedText>
                      )}
                    </View>
                    <ThemedText themeColor="textSecondary" numberOfLines={2}>
                      {blankName} · {d?.prompt ?? 'design'}
                    </ThemedText>
                    {node.refId && node.blankRef ? (
                      <Pressable
                        onPress={() => {
                          setReviewId(null);
                          setFinalizeComp({
                            id: node.refId,
                            templateKey: node.blankRef!,
                            defaultName: d?.prompt ?? 'Nano Crew design',
                          });
                        }}>
                        <View style={[styles.generate, { backgroundColor: theme.text }]}>
                          <ThemedText type="smallBold" style={{ color: theme.background }}>
                            Review & finalize
                          </ThemedText>
                        </View>
                      </Pressable>
                    ) : null}
                    <Pressable onPress={() => discardComposite(reviewId)} style={styles.discard}>
                      <ThemedText type="small" themeColor="textSecondary">
                        Discard
                      </ThemedText>
                    </Pressable>
                  </ThemedView>
                </View>
              </Modal>
            );
          })()
        : null}

      {/* Placement editor — size/position + real Printful mockups */}
      {editorComp ? (
        <PlacementEditor
          compositionId={editorComp.id}
          templateKey={editorComp.templateKey}
          designs={designs.filter((d) => d.status === 'ready')}
          addDesignId={editorComp.addDesignId}
          onClose={() => setEditorComp(null)}
          onPreview={(previewUrl) => {
            setNodes((p) =>
              p.map((n) =>
                n.kind === 'composition' && n.refId === editorComp.id ? { ...n, previewUrl } : n,
              ),
            );
            scheduleSave();
          }}
        />
      ) : null}

      {/* Finalize & publish */}
      {finalizeComp ? (
        <FinalizeSheet
          compositionId={finalizeComp.id}
          templateKey={finalizeComp.templateKey}
          defaultName={finalizeComp.defaultName}
          designs={designs.filter((d) => d.status === 'ready')}
          onClose={() => setFinalizeComp(null)}
          onPublished={() => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          }}
          onPreview={(previewUrl) => {
            setNodes((p) =>
              p.map((n) =>
                n.kind === 'composition' && n.refId === finalizeComp.id ? { ...n, previewUrl } : n,
              ),
            );
            scheduleSave();
          }}
        />
      ) : null}

      {/* Design merge */}
      {mergeTarget ? (
        <MergeModal
          a={designs.find((x) => x.id === mergeTarget.aId)}
          b={designs.find((x) => x.id === mergeTarget.bId)}
          onCancel={() => setMergeTarget(null)}
          onMerge={(p) => doMerge(mergeTarget.aId, mergeTarget.bId, p)}
        />
      ) : null}

      {/* Product colour picker (tap a product node) */}
      {colorNodeId ? (
        <Modal visible transparent animationType="slide" onRequestClose={() => setColorNodeId(null)}>
          <View style={styles.modalBackdrop}>
            <ThemedView type="background" style={styles.sheet}>
              <View style={styles.sheetHeader}>
                <ThemedText type="smallBold">Product colour</ThemedText>
                <Pressable onPress={() => setColorNodeId(null)} hitSlop={10}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Close
                  </ThemedText>
                </Pressable>
              </View>
              {colorsLoading ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Loading colours…
                </ThemedText>
              ) : colors.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  No colours available for this product.
                </ThemedText>
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.swatchRow}>
                  {colors.map((c) => (
                    <Pressable key={c.color} onPress={() => pickColor(c)} style={styles.swatchItem}>
                      <View style={[styles.swatch, { backgroundColor: c.colorCode }]} />
                      <ThemedText
                        type="small"
                        themeColor="textSecondary"
                        numberOfLines={1}
                        style={styles.swatchLabel}>
                        {c.color}
                      </ThemedText>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </ThemedView>
          </View>
        </Modal>
      ) : null}

      {/* Combine sheet — design clicked onto a product; choose the print placement */}
      {combineTarget ? (
        <Modal visible transparent animationType="slide" onRequestClose={() => setCombineTarget(null)}>
          <View style={styles.modalBackdrop}>
            <ThemedView type="background" style={styles.sheet}>
              <View style={styles.sheetHeader}>
                <ThemedText type="smallBold">Print this design on the product</ThemedText>
                <Pressable onPress={() => setCombineTarget(null)} hitSlop={10}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Cancel
                  </ThemedText>
                </Pressable>
              </View>

              <View style={styles.combineRow}>
                {(() => {
                  const d = designs.find((x) => x.id === combineTarget.designId);
                  const b = blanks.find((x) => String(x.id) === combineTarget.blankId);
                  return (
                    <>
                      {d?.image ? (
                        <Image source={{ uri: d.image }} style={styles.combineThumb} contentFit="cover" />
                      ) : (
                        <DesignTile color={d?.color ?? '#888'} style={styles.combineThumb} />
                      )}
                      <ThemedText type="title" themeColor="textSecondary">
                        +
                      </ThemedText>
                      {b?.image ? (
                        <Image source={{ uri: b.image }} style={styles.combineThumb} contentFit="contain" />
                      ) : null}
                    </>
                  );
                })()}
              </View>

              {placementsLoading ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Loading placements…
                </ThemedText>
              ) : (
                <View style={styles.placementWrap}>
                  {(placements.length
                    ? placements
                    : [{ key: 'front', label: 'Front print', allOver: false }]
                  ).map((p) => (
                    <Pressable key={p.key} onPress={() => setChosenPlacement(p.key)}>
                      <ThemedView
                        type={chosenPlacement === p.key ? 'backgroundSelected' : 'backgroundElement'}
                        style={styles.chip}>
                        <ThemedText
                          type="small"
                          themeColor={chosenPlacement === p.key ? 'text' : 'textSecondary'}>
                          {p.label}
                          {p.allOver ? ' · all-over' : ''}
                        </ThemedText>
                      </ThemedView>
                    </Pressable>
                  ))}
                </View>
              )}

              <Pressable onPress={() => doCombine(chosenPlacement)}>
                <View style={[styles.generate, { backgroundColor: theme.text }]}>
                  <ThemedText type="smallBold" style={{ color: theme.background }}>
                    Combine
                  </ThemedText>
                </View>
              </Pressable>
            </ThemedView>
          </View>
        </Modal>
      ) : null}

      {/* Setup: choose the brand you're designing for, then the collection. This is the first
          popup on entering the Design tab; the top-left chip reopens it to switch. */}
      {catSheetOpen ? (
        <Modal visible transparent animationType="slide" onRequestClose={() => setCatSheetOpen(false)}>
          <View style={styles.modalBackdrop}>
            <ThemedView type="background" style={styles.sheet}>
              <View style={styles.sheetHeader}>
                <ThemedText type="smallBold">
                  {setupStep === 'brand' ? 'Which brand?' : `Collection for ${brand?.name ?? 'brand'}`}
                </ThemedText>
                <Pressable onPress={() => setCatSheetOpen(false)} hitSlop={10}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Close
                  </ThemedText>
                </Pressable>
              </View>

              {setupStep === 'brand' ? (
                brands.length ? (
                  brands.map((b) => (
                    <Pressable key={b.id} onPress={() => chooseBrand(b)} style={styles.catRow}>
                      <ThemedText type="small" themeColor={b.id === brand?.id ? 'text' : 'textSecondary'}>
                        {b.id === brand?.id ? '●  ' : '○  '}
                        {b.name}
                      </ThemedText>
                    </Pressable>
                  ))
                ) : (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.catRow}>
                    No brands yet — create one in Studio with Venus.
                  </ThemedText>
                )
              ) : (
                <>
                  {brands.length > 1 ? (
                    <Pressable onPress={() => setSetupStep('brand')} hitSlop={6} style={styles.catRow}>
                      <ThemedText type="small" themeColor="tint">
                        ‹ Change brand
                      </ThemedText>
                    </Pressable>
                  ) : null}
                  {catalogues.map((c) => (
                    <Pressable key={c.id} onPress={() => switchCatalogue(c)} style={styles.catRow}>
                      <ThemedText
                        type="small"
                        themeColor={c.id === catalogue?.id ? 'text' : 'textSecondary'}>
                        {c.id === catalogue?.id ? '●  ' : '○  '}
                        {c.name}
                      </ThemedText>
                    </Pressable>
                  ))}
                  <ThemedText type="small" themeColor="textSecondary" style={styles.catPresetLabel}>
                    New collection / drop
                  </ThemedText>
                  <View style={styles.catPresetRow}>
                    {(['Spring', 'Summer', 'Fall', 'Winter', 'Drop'] as const).map((s) => {
                      const season = s.toLowerCase();
                      const on = newCatSeason === season;
                      return (
                        <Pressable
                          key={s}
                          onPress={() => {
                            setNewCatSeason(season);
                            setNewCat(s === 'Drop' ? '' : `${s} ${new Date().getFullYear()}`);
                          }}
                          hitSlop={4}>
                          <ThemedView type={on ? 'backgroundSelected' : 'backgroundElement'} style={styles.catPreset}>
                            <ThemedText type="small" themeColor={on ? 'text' : 'textSecondary'}>
                              {s}
                            </ThemedText>
                          </ThemedView>
                        </Pressable>
                      );
                    })}
                  </View>
                  <View style={styles.catCreateRow}>
                    <TextInput
                      value={newCat}
                      onChangeText={setNewCat}
                      placeholder="Collection name, e.g. Summer 2026"
                      placeholderTextColor={theme.textSecondary}
                      style={[
                        styles.input,
                        styles.flex,
                        { color: theme.text, backgroundColor: theme.backgroundElement },
                      ]}
                    />
                    <Pressable
                      onPress={() => {
                        createCatalogue(newCat, newCatSeason ?? undefined);
                        setNewCatSeason(null);
                      }}
                      hitSlop={6}>
                      <ThemedView type="backgroundSelected" style={styles.chip}>
                        <ThemedText type="small">Create</ThemedText>
                      </ThemedView>
                    </Pressable>
                  </View>
                </>
              )}
            </ThemedView>
          </View>
        </Modal>
      ) : null}
    </ThemedView>
  );
}

// Discrete-tier "slider" for AI effort (Low / Medium / High / Max). Tap a stop and the
// track fills up to it. Drives prompt richness for 🎲 Random and ✨ Enhance.
function EffortSlider({ value, onChange }: { value: Effort; onChange: (e: Effort) => void }) {
  const theme = useTheme();
  const fillPct = `${((value - 1) / (EFFORT_TIERS.length - 1)) * 75}%` as DimensionValue;
  return (
    <View style={styles.effortBlock}>
      <View style={styles.effortHeader}>
        <ThemedText type="small" themeColor="textSecondary">
          AI effort · {EFFORT_LABELS[value]}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          🎲 Random & ✨ Enhance
        </ThemedText>
      </View>
      <View style={styles.effortTrackRow}>
        <View style={[styles.effortLine, { backgroundColor: theme.backgroundSelected }]} />
        <View style={[styles.effortLineFill, { width: fillPct, backgroundColor: theme.text }]} />
        {EFFORT_TIERS.map((t) => (
          <Pressable key={t} onPress={() => onChange(t)} hitSlop={12} style={styles.effortStop}>
            <View
              style={[
                styles.effortDot,
                { borderColor: theme.text, backgroundColor: t <= value ? theme.text : theme.background },
                t === value && styles.effortDotActive,
              ]}
            />
          </Pressable>
        ))}
      </View>
      <View style={styles.effortLabels}>
        {EFFORT_TIERS.map((t) => (
          <Pressable key={t} onPress={() => onChange(t)} style={styles.effortLabelCell} hitSlop={8}>
            <ThemedText type="small" themeColor={t === value ? 'text' : 'textSecondary'}>
              {EFFORT_LABELS[t]}
            </ThemedText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function GenerateModal({
  open,
  onClose,
  onCommit,
}: {
  open: boolean;
  onClose: () => void;
  // Called when the creator APPROVES a staged graphic — the parent lands it on the canvas + persists.
  onCommit: (staged: { url: string; prompt: string }) => void;
}) {
  const theme = useTheme();
  const [modality, setModality] = useState<Modality>('design');
  const [prompt, setPrompt] = useState('');
  const [background, setBackground] = useState<'transparent' | 'filled'>('transparent');
  const [ratio, setRatio] = useState('1:1');
  const [webRatio, setWebRatio] = useState('16:9');
  const [refImage, setRefImage] = useState<string | null>(null);
  const [isText, setIsText] = useState(false);
  const [rolling, setRolling] = useState(false);
  // How hard the AI works on the 🎲 Random concept and ✨ Enhance expansion (prompt richness).
  const [effort, setEffort] = useState<Effort>(3);
  const [enhancing, setEnhancing] = useState(false);
  // Staged review: a generated/uploaded preview held for approval BEFORE it lands on the canvas.
  const [staged, setStaged] = useState<{ url: string; prompt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editText, setEditText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canGo = prompt.trim().length > 0 || !!refImage;

  const reset = () => {
    setPrompt('');
    setRefImage(null);
    setIsText(false);
    setStaged(null);
    setEditText('');
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  // 🎲 Random: AI invents a design concept and drops it into the prompt.
  const rollIdea = async () => {
    if (rolling) return;
    setRolling(true);
    try {
      const res = await apiFetch(`/api/idea?effort=${effort}`);
      const d = (await res.json()) as { idea?: string };
      if (d.idea) setPrompt(d.idea);
    } catch {
      // ignore — user can just type
    } finally {
      setRolling(false);
    }
  };

  // ✨ Enhance: expand a lazy prompt ("panda") into a rich, vivid one.
  const enhancePrompt = async () => {
    const text = prompt.trim();
    if (!text || enhancing) return;
    setEnhancing(true);
    try {
      const res = await apiFetch('/api/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, effort }),
      });
      const d = (await res.json()) as { enhanced?: string };
      if (d.enhanced) setPrompt(d.enhanced);
    } catch {
      // keep the original prompt
    } finally {
      setEnhancing(false);
    }
  };

  const pick = async () => {
    const uri = await pickImage();
    if (uri) setRefImage(uri);
  };

  // Generate a PREVIEW (no persistence) and stage it for review. overridePrompt/overrideRef drive
  // the "change it / add text" re-roll from the staged image (a hosted url → used as a reference).
  const runGenerate = async (overridePrompt?: string, overrideRef?: string) => {
    if (busy) return;
    const isGraphics = modality === 'graphics';
    const base =
      overridePrompt ??
      (isText && prompt.trim()
        ? `The words "${prompt.trim()}" as a bold, high-contrast lettering graphic with clean typography`
        : prompt);
    const text = base.trim();
    const ref = overrideRef ?? refImage ?? undefined;
    if (!text && !ref) return;
    setBusy(true);
    setError(null);
    try {
      const bg = isGraphics ? 'filled' : isText ? 'transparent' : background;
      const aspectRatio = isGraphics ? webRatio : ratio;
      const res = await apiFetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, image: ref, background: bg, aspectRatio }),
      });
      const data = (await res.json().catch(() => ({}))) as { image?: string; error?: string };
      if (!res.ok || !data.image) throw new Error(data.error || 'Generation failed');
      setStaged({ url: data.image, prompt: text || 'Uploaded image' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setBusy(false);
    }
  };

  const onGeneratePress = () => {
    // An uploaded image with no prompt is staged as-is (no generation needed).
    if (refImage && !prompt.trim() && !isText) {
      setStaged({ url: refImage, prompt: 'Uploaded image' });
      return;
    }
    void runGenerate();
  };

  // "Change it / add text": re-generate using the staged image as a visual reference.
  const applyChange = () => {
    const instr = editText.trim();
    if (!instr || !staged || busy) return;
    setEditText('');
    void runGenerate(`${instr}. Keep the overall composition and subject of the reference image.`, staged.url);
  };

  const approve = () => {
    if (!staged) return;
    onCommit(staged);
    reset();
  };

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalBackdrop}>
        <ThemedView type="background" style={styles.sheet}>
          {/* Preview pane FIRST (top) — viewing area up high, tappable controls kept lower/reachable. */}
          <View style={styles.previewPane}>
            {busy ? (
              <View style={styles.previewCenter}>
                <ActivityIndicator color={theme.text} />
                <ThemedText type="small" themeColor="textSecondary" style={styles.previewHint}>
                  Generating…
                </ThemedText>
              </View>
            ) : staged ? (
              <Image source={{ uri: staged.url }} style={styles.previewImg} contentFit="contain" />
            ) : (
              <View style={styles.previewCenter}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.previewHint}>
                  {modality === 'video'
                    ? 'Video generation lands here soon — scene videos for products and a motion hero for your site.'
                    : modality === 'graphics'
                      ? 'Your web graphic will appear here.'
                      : 'Your design will appear here.'}
                </ThemedText>
              </View>
            )}
          </View>

          <View style={styles.sheetHeader}>
            <ThemedText type="code" themeColor="textSecondary">
              {staged
                ? 'Review'
                : modality === 'graphics'
                  ? 'Generate a web graphic'
                  : modality === 'video'
                    ? 'Generate a video'
                    : 'Generate a design'}
            </ThemedText>
            <Pressable onPress={close}>
              <ThemedText type="small" themeColor="textSecondary">
                Close
              </ThemedText>
            </Pressable>
          </View>

          <View style={styles.tabsRow}>
            {MODALITIES.map((m) => (
              <Pressable
                key={m.key}
                style={styles.flex}
                onPress={() => {
                  setModality(m.key);
                  setStaged(null);
                  setError(null);
                }}>
                <ThemedView
                  type={modality === m.key ? 'backgroundSelected' : 'backgroundElement'}
                  style={styles.tab}>
                  <ThemedText type="small" themeColor={modality === m.key ? 'text' : 'textSecondary'}>
                    {m.label}
                  </ThemedText>
                </ThemedView>
              </Pressable>
            ))}
          </View>

          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
          {error ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.genError}>
              {error}
            </ThemedText>
          ) : null}

          {staged ? (
            <>
              <TextInput
                value={editText}
                onChangeText={setEditText}
                placeholder="Change it — e.g. add the text “SALE”, make it darker"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <View style={styles.optionRow}>
                <Pressable onPress={applyChange} disabled={!editText.trim() || busy}>
                  <ThemedView
                    type="backgroundElement"
                    style={[styles.chip, { opacity: !editText.trim() || busy ? 0.5 : 1 }]}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {busy ? '… working' : 'Apply change'}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
                <Pressable onPress={() => void runGenerate()} disabled={busy}>
                  <ThemedView type="backgroundElement" style={[styles.chip, { opacity: busy ? 0.5 : 1 }]}>
                    <ThemedText type="small" themeColor="textSecondary">
                      ↻ Regenerate
                    </ThemedText>
                  </ThemedView>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setStaged(null);
                    setError(null);
                  }}
                  disabled={busy}>
                  <ThemedView type="backgroundElement" style={styles.chip}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Discard
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              </View>
              <Pressable onPress={approve} disabled={busy}>
                <View style={[styles.generate, { backgroundColor: theme.text, opacity: busy ? 0.4 : 1 }]}>
                  <ThemedText type="smallBold" style={{ color: theme.background }}>
                    Use this
                  </ThemedText>
                </View>
              </Pressable>
            </>
          ) : modality === 'video' ? null : (
            <>
              <TextInput
                autoFocus
                value={prompt}
                onChangeText={setPrompt}
                placeholder={
                  modality === 'graphics'
                    ? 'Describe a web graphic — a hero image, a banner…'
                    : 'Describe a design — or upload a reference image below'
                }
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                multiline
              />

              {refImage ? (
                <View style={styles.refRow}>
                  <Image source={{ uri: refImage }} style={styles.refThumb} contentFit="cover" />
                  <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
                    {prompt.trim() ? 'Used as a reference for your prompt.' : 'Will be added as-is.'}
                  </ThemedText>
                  <Pressable onPress={() => setRefImage(null)}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Remove
                    </ThemedText>
                  </Pressable>
                </View>
              ) : null}

              <View style={styles.optionRow}>
                <Pressable onPress={pick}>
                  <ThemedView type="backgroundElement" style={styles.chip}>
                    <ThemedText type="small" themeColor="textSecondary">
                      ↑ Upload image
                    </ThemedText>
                  </ThemedView>
                </Pressable>
                {modality === 'design' ? (
                  <>
                    {(['transparent', 'filled'] as const).map((b) => (
                      <Pressable key={b} onPress={() => setBackground(b)}>
                        <ThemedView
                          type={background === b ? 'backgroundSelected' : 'backgroundElement'}
                          style={styles.chip}>
                          <ThemedText type="small" themeColor={background === b ? 'text' : 'textSecondary'}>
                            {b === 'transparent' ? 'Transparent' : 'Filled'}
                          </ThemedText>
                        </ThemedView>
                      </Pressable>
                    ))}
                    <Pressable onPress={() => setIsText((t) => !t)}>
                      <ThemedView
                        type={isText ? 'backgroundSelected' : 'backgroundElement'}
                        style={styles.chip}>
                        <ThemedText type="small" themeColor={isText ? 'text' : 'textSecondary'}>
                          Aa Text
                        </ThemedText>
                      </ThemedView>
                    </Pressable>
                  </>
                ) : null}
                <Pressable onPress={rollIdea} disabled={rolling}>
                  <ThemedView type="backgroundElement" style={[styles.chip, { opacity: rolling ? 0.5 : 1 }]}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {rolling ? '🎲 …' : '🎲 Random'}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
                <Pressable onPress={enhancePrompt} disabled={enhancing || !prompt.trim()}>
                  <ThemedView
                    type="backgroundElement"
                    style={[styles.chip, { opacity: enhancing || !prompt.trim() ? 0.5 : 1 }]}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {enhancing ? '✨ …' : '✨ Enhance'}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              </View>

              <EffortSlider value={effort} onChange={setEffort} />

              {modality === 'graphics' ? (
                <View style={styles.optionRow}>
                  {WEB_RATIOS.map((r) => (
                    <Pressable key={r} onPress={() => setWebRatio(r)}>
                      <ThemedView
                        type={webRatio === r ? 'backgroundSelected' : 'backgroundElement'}
                        style={styles.chip}>
                        <ThemedText type="small" themeColor={webRatio === r ? 'text' : 'textSecondary'}>
                          {r}
                        </ThemedText>
                      </ThemedView>
                    </Pressable>
                  ))}
                </View>
              ) : background === 'filled' && !isText ? (
                <View style={styles.optionRow}>
                  {RATIOS.map((r) => (
                    <Pressable key={r} onPress={() => setRatio(r)}>
                      <ThemedView
                        type={ratio === r ? 'backgroundSelected' : 'backgroundElement'}
                        style={styles.chip}>
                        <ThemedText type="small" themeColor={ratio === r ? 'text' : 'textSecondary'}>
                          {r}
                        </ThemedText>
                      </ThemedView>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <Pressable onPress={onGeneratePress} disabled={!canGo || busy}>
                <View style={[styles.generate, { backgroundColor: theme.text, opacity: !canGo || busy ? 0.4 : 1 }]}>
                  <ThemedText type="smallBold" style={{ color: theme.background }}>
                    {busy ? 'Generating…' : 'Generate'}
                  </ThemedText>
                </View>
              </Pressable>
            </>
          )}
          </ScrollView>
        </ThemedView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function MergeModal({
  a,
  b,
  onCancel,
  onMerge,
}: {
  a?: Design;
  b?: Design;
  onCancel: () => void;
  onMerge: (prompt: string) => void;
}) {
  const theme = useTheme();
  const [collision, setCollision] = useState('');

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalBackdrop}>
        <ThemedView type="background" style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <ThemedText type="code" themeColor="textSecondary">
              Merge designs
            </ThemedText>
            <Pressable onPress={onCancel}>
              <ThemedText type="small" themeColor="textSecondary">
                Cancel
              </ThemedText>
            </Pressable>
          </View>

          <View style={styles.mergeRow}>
            {a?.image ? (
              <Image source={{ uri: a.image }} style={styles.mergeThumb} contentFit="cover" />
            ) : (
              <DesignTile color={a?.color ?? theme.backgroundElement} style={styles.mergeThumb} />
            )}
            <ThemedText type="subtitle" themeColor="textSecondary">
              +
            </ThemedText>
            {b?.image ? (
              <Image source={{ uri: b.image }} style={styles.mergeThumb} contentFit="cover" />
            ) : (
              <DesignTile color={b?.color ?? theme.backgroundElement} style={styles.mergeThumb} />
            )}
          </View>

          <TextInput
            value={collision}
            onChangeText={setCollision}
            placeholder="How should they collide? (optional)"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            multiline
          />

          <Pressable onPress={() => onMerge(collision)}>
            <View style={[styles.generate, { backgroundColor: theme.text }]}>
              <ThemedText type="smallBold" style={{ color: theme.background }}>
                Merge
              </ThemedText>
            </View>
          </Pressable>
        </ThemedView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  gateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, paddingHorizontal: Spacing.five },
  gateSpark: { fontSize: 40, opacity: 0.8 },
  gateTitle: { fontSize: 28, textAlign: 'center' },
  gateBody: { textAlign: 'center', maxWidth: 320, lineHeight: 22 },
  gateBtn: { borderRadius: 14, paddingVertical: Spacing.three, paddingHorizontal: Spacing.six, alignItems: 'center', marginTop: Spacing.two },
  gateLogin: { textDecorationLine: 'underline', paddingVertical: Spacing.two },
  gateFoot: { fontSize: 12, marginTop: Spacing.two, textAlign: 'center', opacity: 0.8 },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  eyebrow: { textTransform: 'uppercase' },
  thumbRow: { gap: Spacing.two, alignItems: 'center' },
  thumb: { width: 48, borderRadius: Spacing.two },
  thumbImg: { width: 48, height: 48, borderRadius: Spacing.two },
  pendingThumb: {
    width: 48,
    height: 48,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dockWrap: { borderTopWidth: StyleSheet.hairlineWidth },
  dockHandle: { alignItems: 'center', paddingTop: Spacing.two, paddingBottom: Spacing.two, gap: 3 },
  dockGrip: { width: 44, height: 4, borderRadius: 2 },
  fab: {
    position: 'absolute',
    right: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: 999,
  },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    maxHeight: '94%',
    padding: Spacing.four,
    paddingBottom: Spacing.six,
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    gap: Spacing.three,
  },
  // The controls scroll independently so the Generate button is always reachable above the keyboard.
  sheetScroll: { flexShrink: 1 },
  sheetScrollContent: { gap: Spacing.three, paddingBottom: Spacing.three },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  swatchRow: { gap: Spacing.three, paddingVertical: Spacing.two, paddingRight: Spacing.four },
  swatchItem: { alignItems: 'center', width: 60, gap: Spacing.one },
  swatch: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.5)',
  },
  swatchLabel: { textAlign: 'center', fontSize: 10 },
  catChip: { paddingVertical: 2, paddingRight: Spacing.two },
  canvasWrap: { flex: 1 },
  toolbar: {
    position: 'absolute',
    top: Spacing.three,
    left: Spacing.three,
    flexDirection: 'row',
    borderRadius: Spacing.two,
    padding: 3,
    gap: 3,
  },
  toolBtn: {},
  toolBtnInner: {
    width: 34,
    height: 30,
    borderRadius: Spacing.one + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  combineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  combineThumb: { width: 72, height: 72, borderRadius: Spacing.two },
  placementWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  catRow: { paddingVertical: Spacing.two },
  catCreateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  catPresetLabel: { marginTop: Spacing.three },
  catPresetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  catPreset: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: 999 },
  input: {
    minHeight: 72,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  refRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  refThumb: { width: 56, height: 56, borderRadius: Spacing.two },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.three, borderRadius: 999 },
  tabsRow: { flexDirection: 'row', gap: Spacing.one, marginBottom: Spacing.two },
  tab: { alignItems: 'center', paddingVertical: Spacing.two, borderRadius: 999 },
  previewPane: { height: 190, borderRadius: 12, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.18)' },
  previewCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  previewImg: { flex: 1, width: '100%' },
  previewHint: { textAlign: 'center', marginTop: Spacing.two },
  genError: { marginTop: Spacing.one },
  comingSoon: { paddingVertical: Spacing.four, alignItems: 'center' },
  assignLabel: { alignSelf: 'center', marginRight: Spacing.one },
  dockToggle: { flexDirection: 'row', gap: Spacing.one, paddingHorizontal: Spacing.three, marginBottom: Spacing.one },
  dockToggleTab: { alignItems: 'center', paddingVertical: Spacing.one, borderRadius: 999 },
  effortBlock: { gap: Spacing.one, marginTop: Spacing.one },
  effortHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  effortTrackRow: { flexDirection: 'row', alignItems: 'center', height: 24 },
  effortLine: { position: 'absolute', left: '12.5%', right: '12.5%', top: 11, height: 2, borderRadius: 1 },
  effortLineFill: { position: 'absolute', left: '12.5%', top: 11, height: 2, borderRadius: 1 },
  effortStop: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  effortDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5 },
  effortDotActive: { width: 18, height: 18, borderRadius: 9 },
  effortLabels: { flexDirection: 'row' },
  effortLabelCell: { flex: 1, alignItems: 'center' },
  generate: { borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center' },
  reviewBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: Spacing.four,
  },
  reviewCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  reviewThumb: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  reviewImg: { width: '100%', height: '100%' },
  reviewGlyph: { fontSize: 96 },
  discard: { alignItems: 'center', paddingVertical: Spacing.two },
  mergeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  mergeThumb: { width: 96, height: 96, borderRadius: Spacing.three },
});
