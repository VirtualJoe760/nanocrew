// NATIVE Venus avatar. The scene uses @react-three/fiber, which resolves to its expo-gl NATIVE
// reconciler here (the package's `react-native` entry) — and three (its static class blocks) is
// handled by the @babel/plugin-transform-class-static-block in babel.config.js.
//
// `require`d lazily so three/R3F is pulled into the native bundle only where the avatar is actually
// mounted (the gated Lab on Account, and the Studio build-a-brand interview). Web build lives in
// venus-avatar.web.tsx. `stage` drives her lifecycle (pre-render → morphing → silence → talking).
// `lowPower` runs the scene's frameloop on demand (a coarse invalidate ticker instead of 60fps).
export type VenusStage = 'pre-render' | 'morphing' | 'silence' | 'talking';

export default function VenusAvatar({ stage, lowPower }: { stage: VenusStage; lowPower?: boolean }) {
  const VenusOrbScene = require('@/components/backgrounds/venus-orb-scene').default;
  return <VenusOrbScene stage={stage} lowPower={lowPower} />;
}
