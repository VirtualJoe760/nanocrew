import VenusHeadScene, { type VenusStage } from '@/components/backgrounds/venus-head-scene';
import VenusOrbScene from '@/components/backgrounds/venus-orb-scene';

// WEB build of the Venus avatar: the live R3F scenes (three + @react-three/fiber web reconciler).
// Kept behind a component split so the NATIVE bundle (venus-avatar.tsx) never imports three at
// module load — see that file. Mounted by the gated Lab (Account) and the Studio interview.
//
// `variant` picks the embodiment: 'orb' (default — the JARVIS-style sphere of light) or 'face'
// (the Cortana-era humanoid build, kept behind the Lab's Face toggle).
export type { VenusStage };
export type VenusVariant = 'orb' | 'face';

export default function VenusAvatar({ stage, variant = 'orb' }: { stage: VenusStage; variant?: VenusVariant }) {
  return variant === 'face' ? <VenusHeadScene stage={stage} /> : <VenusOrbScene stage={stage} />;
}
