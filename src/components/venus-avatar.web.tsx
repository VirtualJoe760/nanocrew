import VenusOrbScene, { type VenusStage } from '@/components/backgrounds/venus-orb-scene';

// WEB build of the Venus avatar: the live R3F scene (three + @react-three/fiber web reconciler).
// Kept behind a component split so the NATIVE bundle (venus-avatar.tsx) never imports three at
// module load — see that file. Mounted by the gated Lab (Account) and the Studio interview.
// `lowPower` runs the scene's frameloop on demand (a coarse invalidate ticker instead of 60fps).
export type { VenusStage };

export default function VenusAvatar({ stage, lowPower }: { stage: VenusStage; lowPower?: boolean }) {
  return <VenusOrbScene stage={stage} lowPower={lowPower} />;
}
