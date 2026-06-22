// Native fallback for the welcome carousel's 3D phone. The R3F implementation lives in
// phone-scene.web.tsx and is web-only for now (web reconciler + a canvas screen texture); the
// welcome only renders PhoneScene when Platform.OS === 'web', so on native this stub is imported
// but never mounted. Keeping it here means the native bundle never pulls in @react-three/fiber or
// `document` via this path. When the expo-gl/native R3F swap lands, this becomes the real native
// scene.
export default function PhoneScene() {
  return null;
}
