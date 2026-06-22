// NATIVE Venus Lab scene. The avatar (venus-head-scene) uses @react-three/fiber, which resolves to
// its expo-gl NATIVE reconciler here (the package's `react-native` entry) — and three (its static
// class blocks) is handled by the @babel/plugin-transform-class-static-block in babel.config.js.
//
// Mounted ONLY when the gated "Venus Lab (test)" tool is opened from the Account screen, so the
// three/R3F import is paid for just on that screen. The web build lives in venus-lab.web.tsx.
export type VenusStage = 'pre-render' | 'morphing' | 'silence' | 'talking';

export default function VenusLab({ stage }: { stage: VenusStage }) {
  const VenusHeadScene = require('@/components/backgrounds/venus-head-scene').default;
  return <VenusHeadScene stage={stage} />;
}
