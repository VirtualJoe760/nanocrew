import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VenusBubble } from '@/components/venus-bubble';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { apiUrl } from '@/lib/api';
import { sendDesignCommand } from '@/lib/design-bus';
import { venusGuide, type VenusGuidance, type VenusToolKey } from '@/lib/venus-guide';

// THE VENUS SHEET — her STEADY STATE (docs/studio/VENUS_CENTRAL.md). The interaction contract,
// per Joe: SLIDE DOWN from the top edge to ACTIVATE Venus; SLIDE UP to PAUSE her. She greets,
// reads the creator's world (/api/me), and offers her tools: build brand · edit site · create
// designs · memes · blog posts. Today the tools ROUTE into the existing flows (interview,
// console, the design command bus); the conversational lanes (chat + live voice) land here next,
// and the same guidance output becomes her opening context.
//
// Mounted ONCE in src/app/_layout.tsx above the tab navigator; other code can open her
// programmatically via openVenusSheet().

const SHEET_EVENTS: { open?: () => void } = {};
/** Programmatic activation (e.g. a Venus glyph in a header, a 402 gate moment later). */
export function openVenusSheet(): void {
  SHEET_EVENTS.open?.();
}

const HANDLE_ZONE = 26; // invisible top-edge strip that catches the slide-down

export default function VenusSheet() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { height: winH } = useWindowDimensions();
  const [mounted, setMounted] = useState(false); // sheet content (and the GL bubble) exist only while active
  const [guidance, setGuidance] = useState<VenusGuidance | null>(null);

  const sheetH = Math.min(480 + insets.top, winH * 0.72);
  const ty = useSharedValue(-sheetH); // -sheetH = paused (hidden) · 0 = active

  const setSheet = useCallback(
    (open: boolean) => {
      if (open) setMounted(true);
      ty.value = withTiming(open ? 0 : -sheetH, { duration: 340, easing: Easing.out(Easing.cubic) }, (done) => {
        if (done && !open) runOnJS(setMounted)(false);
      });
    },
    [sheetH, ty],
  );

  useEffect(() => {
    SHEET_EVENTS.open = () => setSheet(true);
    if (__DEV__) {
      // deterministic testability, same idiom as the orb's __venusOrbStep hooks
      (globalThis as { __venusSheet?: (open: boolean) => void }).__venusSheet = (open) => setSheet(open);
    }
    return () => {
      if (SHEET_EVENTS.open) SHEET_EVENTS.open = undefined;
      if (__DEV__) delete (globalThis as { __venusSheet?: unknown }).__venusSheet;
    };
  }, [setSheet]);

  // Her read of the creator's world — fetched on activation, cheap (/api/me is the landing call).
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (!mounted || fetchedRef.current || !session?.access_token) return;
    fetchedRef.current = true;
    (async () => {
      try {
        const r = await fetch(apiUrl('/api/me'), { headers: { Authorization: `Bearer ${session.access_token}` } });
        const d = (await r.json().catch(() => ({}))) as {
          profile?: { name?: string };
          stores?: { name: string; slug: string; status: string }[];
        };
        const firstName = (d.profile?.name ?? (session.user?.user_metadata?.name as string | undefined))
          ?.trim()
          .split(/\s+/)[0];
        setGuidance(venusGuide({ firstName, stores: d.stores ?? [] }));
      } catch {
        setGuidance(venusGuide({ stores: [] }));
      }
    })();
  }, [mounted, session]);

  // SLIDE DOWN (top-edge zone) activates · SLIDE UP (on the sheet) pauses.
  const openPan = Gesture.Pan()
    .activeOffsetY(12)
    .onEnd((e) => {
      if (e.translationY > 30 || e.velocityY > 500) runOnJS(setSheet)(true);
    });
  const closePan = Gesture.Pan()
    .activeOffsetY(-12)
    .onEnd((e) => {
      if (e.translationY < -30 || e.velocityY < -500) runOnJS(setSheet)(false);
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));

  const runTool = (key: VenusToolKey) => {
    setSheet(false);
    switch (key) {
      case 'build-brand':
        router.push('/studio?mode=interview');
        break;
      case 'edit-site':
        router.push('/studio');
        break;
      case 'create-designs':
        sendDesignCommand({ kind: 'open-generate' });
        router.push('/design');
        break;
      case 'make-meme':
        sendDesignCommand({ kind: 'open-generate', meme: true });
        router.push('/design');
        break;
      case 'blog-post':
        router.push('/studio'); // the composer's Posts surface; scheduling lands with her chat lane
        break;
    }
  };

  return (
    <>
      {/* the always-armed top-edge slide-down zone (invisible; below the sheet when open) */}
      <GestureDetector gesture={openPan}>
        <View
          style={[styles.edgeZone, { height: insets.top + HANDLE_ZONE }]}
          pointerEvents={mounted ? 'none' : 'auto'}
        />
      </GestureDetector>

      {mounted ? (
        <GestureDetector gesture={closePan}>
          <Animated.View style={[styles.sheet, { height: sheetH, paddingTop: insets.top + 10 }, sheetStyle]}>
            <View style={styles.bubbleRow}>
              <VenusBubble active speaking={false} size={84} />
            </View>
            <ThemedText style={styles.greeting}>{guidance?.greeting ?? '…'}</ThemedText>
            <View style={styles.chips}>
              {(guidance?.suggestions ?? []).map((s) => (
                <Pressable key={s.key} onPress={() => runTool(s.key)} style={styles.chip}>
                  <ThemedText style={styles.chipLabel}>{s.label}</ThemedText>
                  <ThemedText style={styles.chipDetail}>{s.detail}</ThemedText>
                </Pressable>
              ))}
            </View>
            <ThemedText style={styles.hint}>slide up to pause · chat & voice land here next</ThemedText>
            {/* the grab handle at the sheet's bottom lip */}
            <View style={styles.handle} />
          </Animated.View>
        </GestureDetector>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  edgeZone: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 40,
  },
  sheet: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    backgroundColor: 'rgba(6,9,15,0.96)',
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
    borderBottomWidth: 1,
    borderColor: 'rgba(124,199,223,0.18)',
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
  },
  bubbleRow: { marginTop: 4, marginBottom: 8 },
  greeting: {
    textAlign: 'center',
    color: '#eaf4f9',
    fontSize: 16,
    lineHeight: 23,
    maxWidth: 420,
    marginBottom: 14,
  },
  chips: { alignSelf: 'stretch', maxWidth: 460, width: '100%', gap: 8, marginHorizontal: 'auto' },
  chip: {
    borderWidth: 1,
    borderColor: 'rgba(124,199,223,0.22)',
    backgroundColor: 'rgba(12,18,26,0.7)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  chipLabel: { color: '#dff4ff', fontSize: 14, fontFamily: 'Jost-Medium' },
  chipDetail: { color: 'rgba(207,232,243,0.55)', fontSize: 12, marginTop: 1 },
  hint: {
    marginTop: 'auto',
    marginBottom: 10,
    color: 'rgba(124,199,223,0.45)',
    fontSize: 11,
    letterSpacing: 0.6,
  },
  handle: {
    position: 'absolute',
    bottom: 6,
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(207,232,243,0.35)',
  },
});
