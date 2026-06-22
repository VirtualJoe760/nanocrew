import VenusHeadScene, { type VenusStage } from '@/components/backgrounds/venus-head-scene';

// WEB build of the Venus avatar: the live R3F scene (three + @react-three/fiber web reconciler).
// Kept behind a component split so the NATIVE bundle (venus-avatar.tsx) never imports three at
// module load — see that file. Mounted by the gated Lab (Account) and the Studio interview.
export type { VenusStage };

export default function VenusAvatar({ stage, bubble }: { stage: VenusStage; bubble?: boolean }) {
  return <VenusHeadScene stage={stage} bubble={bubble} />;
}
