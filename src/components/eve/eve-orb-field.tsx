import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { getEveOrbScreenPositions, type EveOrbScreenPos } from '@/components/backgrounds/venus-orb-positions-bus';
import type { EveNode } from '@/lib/eve-capabilities';

// EVE'S ORB HITBOX LAYER — the RN half of the 3D-orb interaction (docs/studio/EVE_CONTROL.md).
// The orbs themselves are real 3D objects glowing in Eve's net (venus-orb-scene); this layer reads
// their per-frame projected screen positions off the positions bus and parks an invisible touch
// target + label over each one. That's how a GL object becomes reliably tappable on expo-gl, which
// has no working R3F pointer picking. `box-none` so only the orbs catch touches — everything else
// (and a swipe from empty space to pause Eve) passes straight through.
//
// Reads on a ~30fps ticker (NOT React state at frame rate — the scene renders at 60). The full
// hold→preview→spawn→drag cascade lands next; this proves the 3D orbs + reliable tracking first.

const HIT = 68; // touch target around each orb

export function EveOrbField({ nodes, onSelect }: { nodes: EveNode[]; onSelect: (node: EveNode) => void }) {
  const { width, height } = useWindowDimensions();
  const [positions, setPositions] = useState<EveOrbScreenPos[]>([]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      // ~30fps is plenty for a touch target following a slow-hovering orb; halves the RN work.
      if (t - last >= 33) {
        last = t;
        setPositions(getEveOrbScreenPositions());
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {positions.map((p) => {
        const node = nodes[p.i];
        if (!node || !p.visible) return null;
        return (
          <Pressable
            key={node.id}
            onPress={() => onSelect(node)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={node.label}
            style={[styles.hit, { left: p.nx * width - HIT / 2, top: p.ny * height - HIT / 2 }]}>
            <ThemedText type="code" style={styles.label} numberOfLines={1}>
              {node.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  hit: {
    position: 'absolute',
    width: HIT,
    height: HIT,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  // The orb's glow comes from the GL scene; the label rides just below it.
  label: {
    color: 'rgba(223,244,255,0.9)',
    fontSize: 11,
    textAlign: 'center',
    marginTop: HIT * 0.5,
    width: 96,
  },
});
