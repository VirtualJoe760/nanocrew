// NATIVE Venus avatar. The scene (venus-head-scene) uses @react-three/fiber, which resolves to its
// expo-gl NATIVE reconciler here (the package's `react-native` entry) — and three (its static class
// blocks) is handled by the @babel/plugin-transform-class-static-block in babel.config.js.
//
// `require`d lazily so three/R3F is pulled into the native bundle only where the avatar is actually
// mounted (the gated Lab on Account, and the Studio build-a-brand interview). Web build lives in
// venus-avatar.web.tsx. `stage` drives her lifecycle (pre-render → morphing → silence → talking).
export type VenusStage = 'pre-render' | 'morphing' | 'silence' | 'talking';

export default function VenusAvatar({ stage }: { stage: VenusStage }) {
  const VenusHeadScene = require('@/components/backgrounds/venus-head-scene').default;
  return <VenusHeadScene stage={stage} />;
}
