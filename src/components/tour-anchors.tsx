import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, type StyleProp, View, type ViewStyle } from 'react-native';

// Measured-anchor registry for the guided tour. Wrap any real, tappable element in <TourAnchor
// name="…"> and it reports its exact on-screen rect (window coords) into this context. The
// OnboardingTour then spotlights the REAL button instead of guessing a position — the fix for "the
// tour points at the wrong place." Native elements (the iOS NativeTabs bar) can't be measured from
// JS, so those stay geometry-based in the tour; everything rendered as an RN View can anchor here.

export type Rect = { x: number; y: number; width: number; height: number };

type TourAnchorContextValue = {
  rects: Record<string, Rect>;
  register: (name: string, rect: Rect | null) => void;
};

const TourAnchorContext = createContext<TourAnchorContextValue | null>(null);

export function TourAnchorProvider({ children }: { children: ReactNode }) {
  const [rects, setRects] = useState<Record<string, Rect>>({});

  const register = useCallback((name: string, rect: Rect | null) => {
    setRects((prev) => {
      if (!rect) {
        if (!(name in prev)) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      }
      const cur = prev[name];
      if (cur && cur.x === rect.x && cur.y === rect.y && cur.width === rect.width && cur.height === rect.height) {
        return prev; // unchanged — avoid a re-render loop
      }
      return { ...prev, [name]: rect };
    });
  }, []);

  const value = useMemo(() => ({ rects, register }), [rects, register]);
  return <TourAnchorContext.Provider value={value}>{children}</TourAnchorContext.Provider>;
}

/** Read all currently-measured anchor rects (window coords). Empty object if no provider. */
export function useTourAnchorRects(): Record<string, Rect> {
  return useContext(TourAnchorContext)?.rects ?? {};
}

/**
 * Wrap a tappable target so the tour can spotlight it. Measures itself in WINDOW coordinates on
 * layout (and re-measures on demand via the returned key changing). `collapsable={false}` keeps the
 * native view around so measureInWindow has something to read on Android.
 */
export function TourAnchor({
  name,
  children,
  style,
}: {
  name: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const ctx = useContext(TourAnchorContext);
  const ref = useRef<View>(null);

  const measure = useCallback(
    (_e?: LayoutChangeEvent) => {
      const node = ref.current;
      if (!node || !ctx) return;
      // measureInWindow gives screen-relative x/y, which is what the full-screen tour Modal needs.
      node.measureInWindow((x, y, width, height) => {
        if (width > 0 && height > 0) ctx.register(name, { x, y, width, height });
      });
    },
    [ctx, name],
  );

  return (
    // Flatten the style: a TourAnchor can sit inside an expo-router/ui TabTrigger, whose raw Radix
    // Slot merges styles by object-spread on web — a style ARRAY there becomes {0:..,1:..} and crashes
    // react-dom ("indexed property [0]"). A single flattened object is safe on every platform.
    <View ref={ref} collapsable={false} onLayout={measure} style={StyleSheet.flatten(style)}>
      {children}
    </View>
  );
}
