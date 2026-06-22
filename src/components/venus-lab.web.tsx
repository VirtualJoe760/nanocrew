import VenusHeadScene, { type VenusStage } from '@/components/backgrounds/venus-head-scene';

// WEB build of the Venus Lab scene: the live R3F avatar (three + @react-three/fiber web reconciler).
// Kept behind a component split so the NATIVE bundle (venus-lab.tsx) never imports three — see that
// file for why. Rendered by VenusLabScreen (the gated test tool opened from the Account screen).
export type { VenusStage };

export default function VenusLab({ stage }: { stage: VenusStage }) {
  return <VenusHeadScene stage={stage} />;
}
