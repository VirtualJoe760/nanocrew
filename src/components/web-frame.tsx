import { View } from 'react-native';

// Native uses react-native-webview directly (see SitePreview), so this stub is never rendered on
// iOS/Android — it only satisfies the import; the web build resolves to web-frame.web.tsx.
export function WebFrame(_props: { url: string; reloadKey: number; onLoad: () => void; blocked?: boolean }) {
  return <View />;
}
