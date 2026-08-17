import { useEffect, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { usePathname } from 'expo-router';
import * as Device from 'expo-device';

import VenusAvatar from '@/components/venus-avatar';
import { EveGlyph } from '@/components/eve/eve-glyph';
import { subscribeEveStage, type EveStage } from '@/lib/eve-stage-bus';

// THE PERSISTENT EVE (docs/studio/EVE_CONTROL.md — THE PIVOT). Eve is the living background of the
// whole app: her ONE GL avatar mounts here, at the app root behind every tab page. The pages sit on
// translucent scrims (withScreenFade `eveThrough`) so she shows through, dimmed for text contrast.
// This is the only GL context in the app — the pull-down overlay (which mounted its own) is retired;
// the voice surface on the Eve tab DRIVES this avatar through the stage bus instead.
//
// PERFORMANCE: away from the Eve tab she drops to a low-power trickle (frameloop 'demand' + a slow
// invalidate tick inside the scene) — she's behind a 62% scrim there, so the slow tick is invisible,
// and ~90% of the GPU/JS frame cost goes away while you're heads-down in Design/Market/Account.
export default function EveBackground() {
  const [stage, setStage] = useState<EveStage>('silence');
  useEffect(() => subscribeEveStage(setStage), []);

  // The Eve tab is where she performs at full rate; everywhere else is ambience behind a scrim.
  const pathname = usePathname();
  const lowPower = !pathname.startsWith('/studio');

  // EXPLICIT window size (not flex): at the app root the container's measured size isn't settled at
  // mount, and the R3F Canvas (flex:1) measures its container ONCE — a 0×0 mount sticks the canvas at
  // its 300×150 default forever. A concrete width/height gives it a size to fill. We also defer the
  // avatar one frame (rAF, after the first layout) so the Canvas never mounts into a still-zero
  // container. `ready` latches — the context is created once and never torn back down.
  const { width, height } = useWindowDimensions();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // The iOS SIMULATOR runs the GL scene but renders the point-sprite constellation invisibly
  // (its GLES emulation, not our shaders — she renders fine on hardware). Rather than debug a
  // rig no creator ever sees, the sim shows her static glyph so the surface is never a void.
  const simulator = !Device.isDevice;

  return (
    // A brand-dark bed under the GL so nothing flashes white before/while the context paints.
    <View style={[styles.root, styles.bed, { width, height }]} pointerEvents="none">
      {!ready ? null : simulator ? (
        <View style={styles.glyphWrap}>
          <EveGlyph size={Math.round(Math.min(width, height) * 0.55)} />
        </View>
      ) : (
        <VenusAvatar stage={stage} lowPower={lowPower} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0 },
  bed: { backgroundColor: '#08080a' },
  glyphWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
