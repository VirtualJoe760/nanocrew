import { useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Pattern, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';

import { DesignTile } from '@/components/design-tile';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';

// Captured once so gesture worklets can branch on platform (module constants are worklet-safe).
const IS_WEB = Platform.OS === 'web';

// Website-slot target nodes (drop a design on one to set it as that site asset).
export const WEB_SLOT_LABELS: Record<string, string> = {
  hero: 'Website hero',
  logo: 'Wordmark',
  mark: 'App icon',
  cover: 'Collection cover',
  og: 'Social image',
};

export type CanvasNode = {
  id: string;
  // 'webslot' = a website asset target (refId is the slot key, e.g. 'hero'); connect a design to assign it.
  kind: 'design' | 'template' | 'composition' | 'group' | 'webslot';
  refId: string;
  x: number;
  y: number;
  scale?: number; // node's own size (1 = default), set by pinch-resize
  // Group membership: members carry the group node's id; group nodes carry width/height.
  groupId?: string;
  width?: number;
  height?: number;
  // Composition nodes (a design dropped onto a product) carry these:
  designRef?: string;
  blankRef?: string;
  status?: 'generating' | 'ready';
  previewUrl?: string; // the composed "design on garment" render
  // Template nodes: chosen Printful colourway (swaps the product photo).
  colorImage?: string;
  selectedColor?: string;
};

export type DesignRef = { prompt: string; color: string; image?: string };
export type BlankRef = { name: string; image?: string };

export const NODE_W = 160;
export const NODE_H = 204;

// Designs are titled by their (often long) generation prompt — show a short label on the canvas tile.
const shortName = (s: string) => {
  const t = (s ?? '').trim();
  return t.length > 16 ? `${t.slice(0, 16).trimEnd()}…` : t || 'Design';
};

const MIN_SCALE = 0.4;
const MAX_SCALE = 2.5;
// The canvas opens (and resets) zoomed out, so several big tiles are in view at once.
const DEFAULT_SCALE = 0.6;
const GRID = 4000;

type Props = {
  nodes: CanvasNode[];
  designs: Record<string, DesignRef>;
  blanks: Record<string, BlankRef>;
  tool: 'select' | 'box';
  onNodeMove: (id: string, x: number, y: number) => void;
  onNodeTap: (id: string) => void;
  onNodeRemove: (id: string) => void;
  /** Double-tap on a DESIGN node → open it in the editor. */
  onNodeEdit?: (id: string) => void;
  onNodeResize: (id: string, scale: number) => void;
  onGroupMove: (id: string, x: number, y: number) => void;
  onUngroup: (id: string) => void;
  onSelectionChange?: (ids: string[]) => void;
  // The parent only reads the live transform (to place new nodes); the canvas owns the
  // shared values and registers them here.
  viewportRef?: {
    current: { tx: SharedValue<number>; ty: SharedValue<number>; scale: SharedValue<number> } | null;
  };
};

function NodeView({
  node,
  design,
  blank,
  scale,
  selected,
  activeScale,
  groupDragId,
  groupDx,
  groupDy,
  pinchActive,
  selGroupId,
  justMovedGroupRef,
  onMoveEnd,
  onTap,
  onRemove,
  onEdit,
  hoverTargetId,
  dropRects,
}: {
  node: CanvasNode;
  design?: DesignRef;
  blank?: BlankRef;
  scale: SharedValue<number>;
  selected: boolean;
  activeScale: SharedValue<number>; // live scale of the *selected* node, driven by pinch
  groupDragId: SharedValue<string>;
  groupDx: SharedValue<number>;
  groupDy: SharedValue<number>;
  pinchActive: SharedValue<boolean>;
  selGroupId: SharedValue<string>;
  justMovedGroupRef: React.MutableRefObject<{ id: string; t: number } | null>;
  onMoveEnd: (id: string, x: number, y: number) => void;
  onTap: (id: string) => void;
  onRemove: (id: string) => void;
  onEdit?: (id: string) => void;
  /** The drop target a dragged design is hovering (drives the grouping affordance). */
  hoverTargetId: SharedValue<string>;
  /** Committed rects of every valid drop target (template/composition/webslot) — worklet-read. */
  dropRects: { id: string; x: number; y: number }[];
}) {
  const theme = useTheme();
  const x = useSharedValue(node.x);
  const y = useSharedValue(node.y);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const dragging = useSharedValue(false);

  // Follow programmatic position changes (combine snap, group drags) with a spring so
  // nodes visibly "click" into place; large jumps (hydration) land instantly. NEVER
  // while the user's finger owns the node — external updates must not fight the drag.
  useEffect(() => {
    if (dragging.value) return;
    // Hand-off from a group drag: the committed x/y already equals where the live
    // delta was holding this member, so snap instantly (no spring slingshot) and drop
    // the broadcast delta in the same tick so the transform doesn't double-apply it.
    const jm = justMovedGroupRef.current;
    if (jm && node.groupId === jm.id && Date.now() - jm.t < 500) {
      x.value = node.x;
      y.value = node.y;
      groupDragId.value = '';
      groupDx.value = 0;
      groupDy.value = 0;
      return;
    }
    const far = Math.abs(x.value - node.x) > 600 || Math.abs(y.value - node.y) > 600;
    if (far) {
      x.value = node.x;
      y.value = node.y;
    } else {
      x.value = withSpring(node.x, { damping: 16, stiffness: 240 });
      y.value = withSpring(node.y, { damping: 16, stiffness: 240 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.x, node.y]);

  const pan = Gesture.Pan()
    .onStart(() => {
      dragging.value = true;
      startX.value = x.value;
      startY.value = y.value;
    })
    .onChange((e) => {
      // Divide by scale so the node tracks the finger 1:1 at any zoom level.
      x.value = startX.value + e.translationX / scale.value;
      y.value = startY.value + e.translationY / scale.value;
      // GROUPING affordance: while a DESIGN drags, light up the drop target under it — the
      // same AABB test the drop handler uses, so the glow always predicts the actual drop.
      if (node.kind === 'design') {
        let hit = '';
        for (let i = 0; i < dropRects.length; i++) {
          const r = dropRects[i];
          if (x.value < r.x + NODE_W && x.value + NODE_W > r.x && y.value < r.y + NODE_H && y.value + NODE_H > r.y) {
            hit = r.id;
            break;
          }
        }
        if (hoverTargetId.value !== hit) hoverTargetId.value = hit;
      }
    })
    .onEnd(() => {
      dragging.value = false;
      hoverTargetId.value = '';
      runOnJS(onMoveEnd)(node.id, x.value, y.value);
    })
    .onFinalize(() => {
      dragging.value = false;
      hoverTargetId.value = '';
    });

  // Tap a node to select it; tapping a selected node's ×-corner removes it, elsewhere opens it.
  // ⚠ On WEB, RNGH reports e.x/e.y in SCREEN pixels of the transformed element, while the corner
  // test is in LAYOUT pixels — so under viewport zoom / node pinch-scale the × zone drifted off the
  // visible badge and the tap fell through to "open" (the "× doesn't delete" bug). Normalize by the
  // live scales on web; native locationInView already reports layout coords.
  const tap = Gesture.Tap().onEnd((e) => {
    const s = IS_WEB ? scale.value * (selected ? activeScale.value : (node.scale ?? 1)) : 1;
    const lx = e.x / (s || 1);
    const ly = e.y / (s || 1);
    if (selected && lx > NODE_W - 40 && ly < 40) {
      runOnJS(onRemove)(node.id);
    } else {
      runOnJS(onTap)(node.id);
    }
  });
  // Double-tap a DESIGN → open the editor. Exclusive() makes the single tap wait for the
  // double-tap to fail, so only design nodes pay that ~250ms selection delay.
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (onEdit) runOnJS(onEdit)(node.id);
    });
  const taps = node.kind === 'design' && onEdit ? Gesture.Exclusive(doubleTap, tap) : tap;
  const gesture = Gesture.Race(pan, taps);

  const isDropTarget = node.kind === 'template' || node.kind === 'composition' || node.kind === 'webslot';
  const style = useAnimatedStyle(() => {
    // While this node's group is being dragged, follow the broadcast delta LIVE so the
    // member moves WITH the group box (no springing into place after the finger lifts).
    const following = !!node.groupId && groupDragId.value === node.groupId;
    const gx = following ? groupDx.value : 0;
    const gy = following ? groupDy.value : 0;
    // Drop targets SWELL under a hovering design (the "these will group" cue). Springed only for
    // target kinds so a pinch-resize on other nodes stays 1:1 with the fingers.
    const base = selected ? activeScale.value : (node.scale ?? 1);
    const hovered = isDropTarget && hoverTargetId.value === node.id;
    return {
      transformOrigin: '0% 0%',
      transform: [
        { translateX: x.value + gx },
        { translateY: y.value + gy },
        { scale: isDropTarget ? withSpring(hovered ? base * 1.07 : base, { damping: 15, stiffness: 260 }) : base },
      ],
    };
  });
  // Accent ring + glow that fades in on the hovered drop target.
  const dropRingStyle = useAnimatedStyle(() => ({
    opacity: withTiming(isDropTarget && hoverTargetId.value === node.id ? 1 : 0, { duration: 120 }),
  }));

  return (
    <GestureDetector gesture={gesture}>
      {/* Outer view owns the animated transform; the inner one owns the entering layout
          animation — combining both on one view makes Reanimated warn (and can clobber
          the transform). */}
      <Animated.View style={[styles.node, style]}>
        <Animated.View
          entering={node.kind === 'composition' ? ZoomIn.springify().damping(14) : undefined}>
        {node.kind === 'design' && design ? (
          <>
            {design.image ? (
              <Image source={{ uri: design.image }} style={styles.designImage} contentFit="contain" />
            ) : (
              <DesignTile color={design.color} label={design.prompt} style={styles.designTile} />
            )}
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.nodeLabel}>
              {shortName(design.prompt)}
            </ThemedText>
          </>
        ) : node.kind === 'composition' ? (
          <>
            <View style={[styles.thumb, { backgroundColor: theme.backgroundElement }]}>
              {node.status === 'generating' ? (
                <View style={styles.renderingWrap}>
                  <ActivityIndicator size="small" />
                  <ThemedText type="small" themeColor="textSecondary">
                    Rendering
                  </ThemedText>
                </View>
              ) : node.previewUrl ? (
                <Image source={{ uri: node.previewUrl }} style={styles.thumbFill} contentFit="cover" />
              ) : blank?.image ? (
                <Image source={{ uri: blank.image }} style={styles.thumbFill} contentFit="contain" />
              ) : (
                <Ionicons name="shirt-outline" size={44} color={theme.textSecondary} />
              )}
            </View>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {node.status === 'generating' ? 'RENDERING…' : 'DRAFT · TAP TO OPEN'}
            </ThemedText>
          </>
        ) : node.kind === 'webslot' ? (
          <>
            <View style={[styles.thumb, { backgroundColor: theme.backgroundElement }]}>
              {node.previewUrl ? (
                <Image
                  source={{ uri: node.previewUrl }}
                  style={styles.thumbFill}
                  contentFit={node.refId === 'logo' || node.refId === 'mark' ? 'contain' : 'cover'}
                />
              ) : (
                <Ionicons name="globe-outline" size={44} color={theme.textSecondary} />
              )}
            </View>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
              {(WEB_SLOT_LABELS[node.refId] ?? 'Web slot') + (node.previewUrl ? '' : ' · drop a design')}
            </ThemedText>
          </>
        ) : (
          <>
            <View style={[styles.thumb, { backgroundColor: theme.backgroundElement }]}>
              {node.colorImage || blank?.image ? (
                <Image
                  source={{ uri: node.colorImage ?? blank?.image }}
                  style={styles.thumbFill}
                  contentFit="contain"
                />
              ) : (
                <Ionicons name="shirt-outline" size={44} color={theme.textSecondary} />
              )}
            </View>
            <ThemedText
              type="small"
              themeColor="textSecondary"
              numberOfLines={3}
              style={styles.nodeLabel}>
              {node.selectedColor ? `${blank?.name ?? 'Blank'} · ${node.selectedColor}` : (blank?.name ?? 'Blank')}
            </ThemedText>
          </>
        )}

        {isDropTarget ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.dropRing, { borderColor: theme.tint, shadowColor: theme.tint }, dropRingStyle]}
          />
        ) : null}
        {selected ? (
          <>
            <View style={styles.selectRing} pointerEvents="none" />
            <View style={styles.removeBadge} pointerEvents="none">
              <Text style={styles.removeX}>×</Text>
            </View>
          </>
        ) : null}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

function GroupView({
  node,
  scale,
  groupDragId,
  groupDx,
  groupDy,
  onMoveEnd,
  onUngroup,
}: {
  node: CanvasNode;
  scale: SharedValue<number>;
  groupDragId: SharedValue<string>;
  groupDx: SharedValue<number>;
  groupDy: SharedValue<number>;
  onMoveEnd: (id: string, x: number, y: number) => void;
  onUngroup: (id: string) => void;
}) {
  const x = useSharedValue(node.x);
  const y = useSharedValue(node.y);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const dragging = useSharedValue(false);

  useEffect(() => {
    if (dragging.value) return;
    x.value = node.x;
    y.value = node.y;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.x, node.y]);

  const pan = Gesture.Pan()
    .onStart(() => {
      dragging.value = true;
      startX.value = x.value;
      startY.value = y.value;
      // Broadcast the live delta so every member moves WITH the group, not after it.
      groupDragId.value = node.id;
      groupDx.value = 0;
      groupDy.value = 0;
    })
    .onChange((e) => {
      const dx = e.translationX / scale.value;
      const dy = e.translationY / scale.value;
      x.value = startX.value + dx;
      y.value = startY.value + dy;
      groupDx.value = dx;
      groupDy.value = dy;
    })
    .onEnd(() => {
      dragging.value = false;
      // Deltas stay applied until the members' state lands (they zero themselves on
      // commit) — that's what makes the hand-off seamless instead of a slingshot.
      runOnJS(onMoveEnd)(node.id, x.value, y.value);
    })
    .onFinalize(() => {
      dragging.value = false;
    });

  const w = node.width ?? 200;
  // Tap the × (top-right, in the floating label) to ungroup. Same web screen-px normalization as
  // the node × (groups don't pinch-scale, so only the viewport zoom applies).
  const tap = Gesture.Tap().onEnd((e) => {
    const s = IS_WEB ? scale.value : 1;
    if (e.x / (s || 1) > w - 40 && e.y / (s || 1) < 32) runOnJS(onUngroup)(node.id);
  });
  const gesture = Gesture.Race(pan, tap);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));

  return (
    // The WHOLE group area drags the group (members render above and win their own
    // touches; only the empty box space reaches this gesture).
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[styles.group, { width: node.width ?? 200, height: node.height ?? 200 }, style]}>
        <View style={styles.groupLabelRow} pointerEvents="none">
          <Text style={styles.groupName} numberOfLines={1}>
            {(node.refId || 'Group').toUpperCase()}
          </Text>
        </View>
        <View style={styles.groupXBadge} pointerEvents="none">
          <Text style={styles.groupX}>×</Text>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

export function DesignCanvas({
  nodes,
  designs,
  blanks,
  tool,
  onNodeMove,
  onNodeTap,
  onNodeRemove,
  onNodeEdit,
  onNodeResize,
  onGroupMove,
  onUngroup,
  onSelectionChange,
  viewportRef,
}: Props) {
  const theme = useTheme();

  // OWN the transform shared values here. Passing them in as props broke useAnimatedStyle's
  // transform reactivity on physical iOS (Reanimated #6276 / #5253) — gesture updated the
  // values but the view never moved. Created locally (like the working node), it wires up
  // correctly. The parent reads them via viewportRef only to place new nodes.
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(DEFAULT_SCALE);

  useEffect(() => {
    if (viewportRef) viewportRef.current = { tx, ty, scale };
  }, [viewportRef, tx, ty, scale]);

  // Selection (multi-capable for the blend tool): in select mode a tap selects ONE node
  // (tap again to open it); in box mode taps TOGGLE membership and a one-finger drag
  // draws a marquee. Pinch resizes the node when exactly one is selected; otherwise it
  // zooms the canvas. Tapping empty canvas clears the selection.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedId = selectedIds.size === 1 ? [...selectedIds][0] : null;
  const activeScale = useSharedValue(1); // live scale of the single selected node
  // Drag-over GROUPING affordance: the id of the drop target currently under a dragged design.
  // Written by the dragging NodeView's pan worklet; read by every target NodeView's styles.
  const hoverTargetId = useSharedValue('');
  const dropRects = nodes
    .filter((n) => n.kind === 'template' || n.kind === 'composition' || n.kind === 'webslot')
    .map((n) => ({ id: n.id, x: n.x, y: n.y }));
  const lastNodeTap = useRef(0);
  // Gestures run as UI-thread worklets — they must read the tool from a shared value
  // (capturing a plain ref in a worklet freezes it and warns on every later mutation).
  const toolSv = useSharedValue<'select' | 'box'>(tool);
  useEffect(() => {
    toolSv.value = tool;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);
  const toolRef = useRef(tool); // JS-side reads (tap handlers)
  toolRef.current = tool;
  const nodesForHit = useRef(nodes);
  nodesForHit.current = nodes;

  // Group-collective motion: while a group is dragged, every member follows LIVE via a
  // shared delta (no slingshot); while a grouped node is pinched, the whole group scales.
  const groupDragId = useSharedValue('');
  const groupDx = useSharedValue(0);
  const groupDy = useSharedValue(0);
  const pinchActive = useSharedValue(false);
  const selGroupId = useSharedValue(''); // groupId of the single selected node
  const justMovedGroupRef = useRef<{ id: string; t: number } | null>(null);

  // Mark the group whose drag just committed so its members snap to their new spot
  // (instead of springing) — see NodeView's commit effect.
  const handleGroupMoveEnd = (id: string, x: number, y: number) => {
    justMovedGroupRef.current = { id, t: Date.now() };
    onGroupMove(id, x, y);
  };

  const applySelection = (ids: Set<string>) => {
    setSelectedIds(ids);
    onSelectionChange?.([...ids]);
    if (ids.size === 1) {
      const only = nodesForHit.current.find((n) => n.id === [...ids][0]);
      activeScale.value = only?.scale ?? 1;
      selGroupId.value = only?.groupId ?? '';
    } else {
      selGroupId.value = '';
    }
  };

  const handleNodeTap = (id: string) => {
    lastNodeTap.current = Date.now();
    if (toolRef.current === 'box') {
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      applySelection(next);
      return;
    }
    if (selectedId === id) {
      onNodeTap(id); // already selected → open (colour picker / composite review)
    } else {
      applySelection(new Set([id]));
    }
  };

  // Empty-canvas tap deselects — but skip if a node was just tapped (its tap also bubbles to
  // this canvas-level tap). Order-independent, so node-select always wins.
  const maybeDeselect = () => {
    if (Date.now() - lastNodeTap.current > 150) applySelection(new Set());
  };

  // Marquee (box mode): one-finger drag draws a screen-space rectangle; on release we
  // hit-test it against nodes in content space.
  const mActive = useSharedValue(0);
  const mx0 = useSharedValue(0);
  const my0 = useSharedValue(0);
  const mx1 = useSharedValue(0);
  const my1 = useSharedValue(0);

  const finishMarquee = (x0: number, y0: number, x1: number, y1: number) => {
    const left = (Math.min(x0, x1) - tx.value) / scale.value;
    const right = (Math.max(x0, x1) - tx.value) / scale.value;
    const top = (Math.min(y0, y1) - ty.value) / scale.value;
    const bottom = (Math.max(y0, y1) - ty.value) / scale.value;
    const hit = nodesForHit.current
      .filter((n) => n.kind !== 'group')
      .filter((n) => n.x < right && n.x + NODE_W > left && n.y < bottom && n.y + NODE_H > top)
      .map((n) => n.id);
    applySelection(new Set(hit));
  };

  // One finger: pans in select mode, draws the marquee in box mode. Two fingers are
  // reserved for pinch (focal-point zoom).
  const pan = Gesture.Pan()
    .maxPointers(1)
    .onStart((e) => {
      if (toolSv.value === 'box') {
        mActive.value = 1;
        mx0.value = e.x;
        my0.value = e.y;
        mx1.value = e.x;
        my1.value = e.y;
      }
    })
    .onChange((e) => {
      if (toolSv.value === 'box') {
        mx1.value = e.x;
        my1.value = e.y;
      } else {
        tx.value += e.changeX;
        ty.value += e.changeY;
      }
    })
    .onEnd(() => {
      if (toolSv.value === 'box' && mActive.value) {
        mActive.value = 0;
        runOnJS(finishMarquee)(mx0.value, my0.value, mx1.value, my1.value);
      }
    });

  // Pinch on a grouped node resizes the WHOLE group uniformly.
  const finishNodePinch = (id: string, s: number) => {
    const node = nodesForHit.current.find((n) => n.id === id);
    if (node?.groupId) {
      for (const m of nodesForHit.current) {
        if (m.groupId === node.groupId && m.kind !== 'group') onNodeResize(m.id, s);
      }
    } else {
      onNodeResize(id, s);
    }
  };

  const startScale = useSharedValue(1);
  const startTx = useSharedValue(0);
  const startTy = useSharedValue(0);
  const startFx = useSharedValue(0);
  const startFy = useSharedValue(0);
  const pinch = Gesture.Pinch()
    .onStart((e) => {
      startScale.value = selectedId ? activeScale.value : scale.value;
      pinchActive.value = !!selectedId;
      startTx.value = tx.value;
      startTy.value = ty.value;
      startFx.value = e.focalX;
      startFy.value = e.focalY;
    })
    .onUpdate((e) => {
      if (selectedId) {
        activeScale.value = Math.min(Math.max(startScale.value * e.scale, 0.4), 3);
      } else {
        const next = Math.min(Math.max(startScale.value * e.scale, MIN_SCALE), MAX_SCALE);
        // Keep the content point that started under the pinch centroid anchored to the
        // (moving) centroid — focal-point zoom + two-finger pan in one.
        const cx = (startFx.value - startTx.value) / startScale.value;
        const cy = (startFy.value - startTy.value) / startScale.value;
        scale.value = next;
        tx.value = e.focalX - cx * next;
        ty.value = e.focalY - cy * next;
      }
    })
    .onEnd(() => {
      pinchActive.value = false;
      if (selectedId) runOnJS(finishNodePinch)(selectedId, activeScale.value);
    });

  // Tap on empty canvas → deselect (guarded so a node tap that also bubbles here doesn't deselect).
  const deselectTap = Gesture.Tap().onEnd(() => {
    runOnJS(maybeDeselect)();
  });

  const canvasGesture = Gesture.Simultaneous(pan, pinch, deselectTap);

  const contentStyle = useAnimatedStyle(() => ({
    // transformOrigin lives here (not in the static style) — a static transformOrigin
    // alongside an animated transform can stop the transform applying on newer iOS (Fabric).
    transformOrigin: '0% 0%',
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const resetView = () => {
    tx.value = withTiming(0);
    ty.value = withTiming(0);
    scale.value = withTiming(DEFAULT_SCALE);
  };

  // + / − zoom anchored at the viewport center.
  const surfaceSize = useRef({ w: 0, h: 0 });
  const zoomBy = (factor: number) => {
    const s = scale.value;
    const next = Math.min(Math.max(s * factor, MIN_SCALE), MAX_SCALE);
    const cx = surfaceSize.current.w / 2;
    const cy = surfaceSize.current.h / 2;
    tx.value = withTiming(cx - ((cx - tx.value) / s) * next);
    ty.value = withTiming(cy - ((cy - ty.value) / s) * next);
    scale.value = withTiming(next);
  };

  const marqueeStyle = useAnimatedStyle(() => ({
    opacity: mActive.value,
    left: Math.min(mx0.value, mx1.value),
    top: Math.min(my0.value, my1.value),
    width: Math.abs(mx1.value - mx0.value),
    height: Math.abs(my1.value - my0.value),
  }));

  return (
    <View
      style={[
        styles.viewport,
        { backgroundColor: theme.canvas, borderColor: theme.canvasEdge },
      ]}>
      <GestureDetector gesture={canvasGesture}>
        <View
          style={styles.surface}
          onLayout={(e) => {
            surfaceSize.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
          }}>
          <Animated.View style={[styles.content, contentStyle]} pointerEvents="box-none">
            {/* Wrapped in a pointerEvents:none View — react-native-svg can swallow
                touches on native, which would block the canvas pan gesture. */}
            <View pointerEvents="none" style={styles.grid}>
              <Svg width={GRID} height={GRID}>
                <Defs>
                  <Pattern id="dots" width={26} height={26} patternUnits="userSpaceOnUse">
                    <Circle cx={1.6} cy={1.6} r={1.3} fill={theme.canvasDot} />
                  </Pattern>
                </Defs>
                <Rect width={GRID} height={GRID} fill="url(#dots)" />
              </Svg>
            </View>

            {nodes
              .filter((n) => n.kind === 'group')
              .map((g) => (
                <GroupView
                  key={g.id}
                  node={g}
                  scale={scale}
                  groupDragId={groupDragId}
                  groupDx={groupDx}
                  groupDy={groupDy}
                  onMoveEnd={handleGroupMoveEnd}
                  onUngroup={onUngroup}
                />
              ))}

            {nodes
              .filter((n) => n.kind !== 'group')
              .map((n) => (
              <NodeView
                key={n.id}
                node={n}
                design={
                  n.kind === 'design'
                    ? designs[n.refId]
                    : n.kind === 'composition'
                      ? designs[n.designRef ?? '']
                      : undefined
                }
                blank={
                  n.kind === 'template'
                    ? blanks[n.refId]
                    : n.kind === 'composition'
                      ? blanks[n.blankRef ?? '']
                      : undefined
                }
                scale={scale}
                selected={selectedIds.has(n.id)}
                activeScale={activeScale}
                groupDragId={groupDragId}
                groupDx={groupDx}
                groupDy={groupDy}
                pinchActive={pinchActive}
                selGroupId={selGroupId}
                justMovedGroupRef={justMovedGroupRef}
                onMoveEnd={onNodeMove}
                onTap={handleNodeTap}
                onRemove={onNodeRemove}
                onEdit={onNodeEdit}
                hoverTargetId={hoverTargetId}
                dropRects={dropRects}
              />
            ))}
          </Animated.View>
        </View>
      </GestureDetector>

      {nodes.length === 0 ? (
        <View pointerEvents="none" style={styles.hintWrap}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
            Generate a design, then tap it (or a blank below) to drop it here. Drag to arrange,
            pinch to zoom.
          </ThemedText>
        </View>
      ) : null}

      {/* Marquee (box-select) */}
      <Animated.View pointerEvents="none" style={[styles.marquee, marqueeStyle]} />

      {/* Zoom controls: + / − / center frame */}
      <View style={[styles.zoomCluster, { borderColor: theme.backgroundSelected }]}>
        <Pressable onPress={() => zoomBy(1.3)} style={styles.zoomBtn} hitSlop={4}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            ＋
          </ThemedText>
        </Pressable>
        <Pressable onPress={() => zoomBy(1 / 1.3)} style={styles.zoomBtn} hitSlop={4}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            －
          </ThemedText>
        </Pressable>
        <Pressable onPress={resetView} style={styles.zoomBtn} hitSlop={4}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            ⛶
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: {
    flex: 1,
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  surface: { flex: 1 },
  content: {
    // Fill the surface (was 0×0). A transform on a zero-size view can fail to move its
    // overflowing children on the new architecture, even though the shared value updates.
    ...StyleSheet.absoluteFillObject,
  },
  grid: {
    position: 'absolute',
    left: -GRID / 2,
    top: -GRID / 2,
    width: GRID,
    height: GRID,
  },
  node: {
    position: 'absolute',
    width: NODE_W,
    gap: Spacing.one,
  },
  // Product/blank label: a touch wider than the thumb + centered, so full Printful names
  // (e.g. "All-Over Print Men's Sports Warmup Hoodie") read without abbreviating.
  nodeLabel: { width: NODE_W + 28, marginHorizontal: -14, textAlign: 'center' },
  designTile: { width: NODE_W },
  designImage: { width: NODE_W, height: NODE_W, borderRadius: Spacing.three },
  thumb: {
    width: NODE_W,
    height: NODE_W,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbFill: { width: '100%', height: '100%' },
  renderingWrap: { alignItems: 'center', gap: Spacing.one },
  removeBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeX: { color: '#fff', fontSize: 16, lineHeight: 18, fontWeight: '600' },
  selectRing: {
    position: 'absolute',
    top: -4,
    left: -4,
    width: NODE_W + 8,
    height: NODE_W + 8,
    borderRadius: Spacing.three + 4,
    borderWidth: 2,
    borderColor: '#3b82f6',
  },
  // The grouping affordance — accent ring + glow on the drop target under a dragged design.
  dropRing: {
    position: 'absolute',
    top: -5,
    left: -5,
    width: NODE_W + 10,
    height: NODE_W + 10,
    borderRadius: Spacing.three + 5,
    borderWidth: 2.5,
    shadowOpacity: 0.9,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  group: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'rgba(128,128,128,0.45)',
    borderRadius: Spacing.three,
    backgroundColor: 'rgba(128,128,128,0.06)',
  },
  groupLabelRow: {
    position: 'absolute',
    top: -24,
    left: 2,
    right: 0,
    height: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  groupName: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    color: 'rgba(140,140,140,1)',
  },
  groupXBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(140,140,140,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupX: { fontSize: 12, lineHeight: 13, fontWeight: '600', color: 'rgba(140,140,140,1)' },
  hintWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.six,
  },
  hint: { textAlign: 'center', lineHeight: 20 },
  marquee: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: '#3b82f6',
    backgroundColor: 'rgba(59,130,246,0.12)',
    borderRadius: 4,
  },
  zoomCluster: {
    position: 'absolute',
    bottom: Spacing.three,
    left: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  zoomBtn: {
    width: 34,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
