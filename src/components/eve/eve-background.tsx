import { useEffect, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import VenusAvatar from '@/components/venus-avatar';
import { subscribeEveCovered } from '@/lib/eve-background-bus';

// THE PERSISTENT EVE (docs/studio/EVE_CONTROL.md — THE PIVOT). Eve is no longer a pull-down; she is
// the living background of the whole app. Her ONE GL avatar mounts here, at the app root behind every
// tab page — the pages sit on translucent scrims (withScreenFade `eveThrough`) so she shows through,
// dimmed for text contrast.
//
// The pull-down overlay (eve-overlay) still slides a full-screen surface over the tabs and mounts its
// OWN avatar for the home/interview. So while that overlay is up, this root avatar YIELDS — unmounts —
// keeping exactly one GL context alive at any moment (the hard constraint the scene is built on). She
// remounts the instant the overlay closes. As the pivot lands (studio merge, overlay retirement) this
// becomes the single always-on Eve; for now the gate preserves the one-context invariant with zero
// change to the pull-down's behavior. Always-on battery cost is handled later by the idle throttle.
export default function EveBackground() {
  const [covered, setCovered] = useState(false);
  useEffect(() => subscribeEveCovered(setCovered), []);

  // EXPLICIT window size (not flex): at the app root the container's measured size isn't settled at
  // mount, and the R3F Canvas (flex:1) measures its container ONCE — a 0×0 mount sticks the canvas at
  // its 300×150 default forever. A concrete width/height gives it a size to fill. We also defer the
  // avatar one frame (rAF, after the browser's first layout) so the Canvas never mounts into a
  // still-zero container. `ready` latches — the context is created once and never torn back down.
  const { width, height } = useWindowDimensions();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    // A brand-dark bed under the GL so nothing flashes white before/while the context paints. The bed
    // stays even while the avatar yields, so the area behind the translucent pages is never white.
    <View style={[styles.root, styles.bed, { width, height }]} pointerEvents="none">
      {ready && !covered ? <VenusAvatar stage="silence" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0 },
  bed: { backgroundColor: '#08080a' },
});
