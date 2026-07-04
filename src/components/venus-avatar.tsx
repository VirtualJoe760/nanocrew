// NATIVE Venus avatar. The scenes use @react-three/fiber, which resolves to its expo-gl NATIVE
// reconciler here (the package's `react-native` entry) — and three (its static class blocks) is
// handled by the @babel/plugin-transform-class-static-block in babel.config.js.
//
// `require`d lazily so three/R3F is pulled into the native bundle only where the avatar is actually
// mounted (the gated Lab on Account, and the Studio build-a-brand interview). Web build lives in
// venus-avatar.web.tsx. `stage` drives her lifecycle (pre-render → morphing → silence → talking).
//
// `variant` picks the embodiment: 'orb' (default — the JARVIS-style sphere of light,
// venus-orb-scene) or 'face' (the Cortana-era humanoid build, venus-head-scene — kept behind the
// Lab's Face toggle).
export type VenusStage = 'pre-render' | 'morphing' | 'silence' | 'talking';
export type VenusVariant = 'orb' | 'face';

export default function VenusAvatar({ stage, variant = 'orb' }: { stage: VenusStage; variant?: VenusVariant }) {
  if (variant === 'face') {
    const VenusHeadScene = require('@/components/backgrounds/venus-head-scene').default;
    return <VenusHeadScene stage={stage} />;
  }
  const VenusOrbScene = require('@/components/backgrounds/venus-orb-scene').default;
  return <VenusOrbScene stage={stage} />;
}
