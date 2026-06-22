import { View } from 'react-native';

// NATIVE no-op for the Venus Lab scene. The avatar (venus-head-scene) uses the @react-three/fiber
// WEB reconciler + three; three ships ES static class blocks that the native Babel transform
// rejects, and the native expo-gl R3F swap is "a later step" (see venus-head-scene.tsx). The real
// scene is in venus-lab.web.tsx; this stub keeps three out of the native bundle entirely. Mirror
// venus-head-scene's VenusStage union so the playground route type-checks on both platforms.
export type VenusStage = 'pre-render' | 'morphing' | 'silence' | 'talking';

export default function VenusLab(_props: { stage: VenusStage }) {
  return <View />;
}
