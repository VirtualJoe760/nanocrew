import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { EveDeveloping } from '@/components/eve/eve-developing';
import { EveHome } from '@/components/eve/eve-home';
import {
  registerEveSummonListener,
  emitEveEvent,
  type EveState,
  type EveSummon,
} from '@/lib/eve-bus';

// THE EVE OVERLAY — Eve's full-screen stage, mounted ONCE in _layout above the tab navigator
// (docs/studio/VENUS_CENTRAL.md, revised architecture). The interaction contract, per Joe:
//
//   · HIDDEN → an always-visible handle at the TOP edge; slide down (or tap) to summon her.
//   · PRESENT → she owns the whole screen (the Lab look — full-bleed orb, subtitles, no button
//     wall); the handle moves to the BOTTOM lip; slide up (or tap) to pause + dismiss.
//
// STATES: hidden · home (steady state — greeting, tools, the brand interview) · developing ·
// design (Phases B/C — typed now, land later). The GL avatar is EXPENSIVE: EveHome mounts it only
// after the slide-in completes (`ready`), so the 340ms entrance never competes with GL context
// creation — and there is never more than one GL context (Studio no longer mounts an avatar).

const OPEN_MS = 340;

export default function EveOverlay() {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();

  const [eve, setEve] = useState<EveState>('hidden');
  const [mounted, setMounted] = useState(false); // content exists while open or animating out
  const [ready, setReady] = useState(false); // slide-in done — safe to mount the GL avatar
  const [payload, setPayload] = useState<Record<string, unknown> | undefined>(undefined);

  const ty = useSharedValue(-winH);

  // Summon AND in-place state transition (home→developing routes through here too — when already
  // on screen the 0→0 timing is a no-op and only the state/payload change).
  const open = useCallback(
    (s: EveSummon) => {
      setPayload(s.payload);
      setEve(s.state);
      setMounted(true);
      ty.value = withTiming(0, { duration: OPEN_MS, easing: Easing.out(Easing.cubic) }, (done) => {
        if (done) runOnJS(setReady)(true);
      });
    },
    [ty],
  );

  const close = useCallback(() => {
    setReady(false); // tear the GL avatar down before the slide so the exit stays 60fps
    ty.value = withTiming(-winH, { duration: OPEN_MS, easing: Easing.in(Easing.cubic) }, (done) => {
      if (done) {
        runOnJS(setMounted)(false);
        runOnJS(setEve)('hidden');
      }
    });
    emitEveEvent({ kind: 'dismissed' });
  }, [ty, winH]);

  useEffect(() => {
    const off = registerEveSummonListener(open);
    if (__DEV__) {
      // deterministic testability, same idiom as __venusOrbStep / the old __venusSheet
      (globalThis as { __eve?: (state: EveState | null, payload?: Record<string, unknown>) => void }).__eve = (state, p) => {
        if (!state || state === 'hidden') close();
        else open({ state, payload: p });
      };
    }
    return () => {
      off();
      if (__DEV__) delete (globalThis as { __eve?: unknown }).__eve;
    };
  }, [open, close]);

  // SLIDE DOWN on the top-edge handle summons · SLIDE UP anywhere on the overlay pauses her.
  const summonPan = Gesture.Pan()
    .activeOffsetY(12)
    .onEnd((e) => {
      if (e.translationY > 30 || e.velocityY > 500) runOnJS(open)({ state: 'home' });
    });
  const dismissPan = Gesture.Pan()
    .activeOffsetY(-16)
    .onEnd((e) => {
      if (e.translationY < -40 || e.velocityY < -500) runOnJS(close)();
    });

  const overlayStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));

  return (
    <>
      {/* HIDDEN: the always-visible summon handle peeking under the status bar. */}
      {!mounted ? (
        <GestureDetector gesture={summonPan}>
          <View style={[styles.summonZone, { height: insets.top + 22 }]}>
            <Pressable
              accessibilityLabel="Summon Eve"
              hitSlop={{ top: 8, bottom: 14, left: 30, right: 30 }}
              onPress={() => open({ state: 'home' })}
              style={[styles.summonPill, { top: insets.top + 6 }]}
            />
          </View>
        </GestureDetector>
      ) : null}

      {/* DEVELOPING: the WebView + circle-pen own every gesture. The slide-up-to-dismiss pan and the
          bottom pill are DELIBERATELY absent here — an upward scroll or an upward circle stroke would
          otherwise trigger close() and silently drop captured-but-unsubmitted edits, and the pill
          overlaps PreviewContent's Submit bar. EveDeveloping has its own exits (header ✕ → home;
          submit → Studio review). */}
      {mounted && eve === 'developing' ? (
        <Animated.View style={[styles.overlay, overlayStyle]}>
          <EveDeveloping
            url={typeof payload?.url === 'string' ? payload.url : undefined}
            slug={typeof payload?.slug === 'string' ? payload.slug : undefined}
            onExit={() => open({ state: 'home' })}
            onSubmitted={(slug) => {
              close();
              router.push({ pathname: '/studio', params: { reviewSlug: slug } });
            }}
          />
        </Animated.View>
      ) : mounted ? (
        <GestureDetector gesture={dismissPan}>
          <Animated.View style={[styles.overlay, overlayStyle]}>
            {/* design renders home until Phase C lands — the machine is already typed. */}
            <EveHome open={mounted} ready={ready} onRequestClose={close} onGo={open} />
            {/* PRESENT: the dismiss handle on the bottom lip — slide up (or tap) to pause. */}
            <Pressable
              accessibilityLabel="Pause Eve"
              hitSlop={{ top: 14, bottom: 8, left: 30, right: 30 }}
              onPress={close}
              style={[styles.dismissPill, { bottom: Math.max(insets.bottom, 10) }]}
            />
          </Animated.View>
        </GestureDetector>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  summonZone: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 40,
    alignItems: 'center',
  },
  summonPill: {
    position: 'absolute',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(207,232,243,0.32)',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    backgroundColor: '#05070b', // the Lab stage — she owns the whole screen
  },
  dismissPill: {
    position: 'absolute',
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(207,232,243,0.35)',
  },
});
