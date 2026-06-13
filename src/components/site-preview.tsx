import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line, Path, Polyline } from 'react-native-svg';
import { WebView } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

// A live, navigable view of the creator's real storefront — the in-app "iframe".
// Full-screen modal with a slim chrome bar (back, reload, open-in-browser, host).

const BG = '#0a0a0c';
const GOLD = '#c9a86a';
const DIM = 'rgba(243,241,236,0.6)';

function host(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function SitePreview({ visible, url, onClose }: { visible: boolean; url: string; onClose: () => void }) {
  // A fresh SafeAreaProvider inside the Modal re-measures the window so the chrome bar
  // clears the Dynamic Island even when this opens nested inside another modal.
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaProvider>
        <PreviewContent url={url} onClose={onClose} />
      </SafeAreaProvider>
    </Modal>
  );
}

function PreviewContent({ url, onClose }: { url: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const ref = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);

  return (
    <View style={[styles.fill, { paddingTop: Math.max(insets.top, 12), paddingBottom: insets.bottom }]}>
      <View style={styles.bar}>
        <Pressable onPress={onClose} hitSlop={12} style={styles.iconBtn}>
          <Svg width={20} height={20}>
            <Line x1={5} y1={5} x2={15} y2={15} stroke={DIM} strokeWidth={1.6} strokeLinecap="round" />
            <Line x1={15} y1={5} x2={5} y2={15} stroke={DIM} strokeWidth={1.6} strokeLinecap="round" />
          </Svg>
        </Pressable>
        <Pressable onPress={() => canGoBack && ref.current?.goBack()} hitSlop={12} style={[styles.iconBtn, !canGoBack && { opacity: 0.3 }]}>
          <Svg width={20} height={20}>
            <Polyline points="12,4 6,10 12,16" fill="none" stroke={DIM} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
        <View style={styles.urlPill}>
          <ThemedText type="code" style={styles.urlText} numberOfLines={1}>
            {host(url)}
          </ThemedText>
        </View>
        <Pressable onPress={() => ref.current?.reload()} hitSlop={12} style={styles.iconBtn}>
          <Svg width={20} height={20}>
            <Path d="M5 10 a5 5 0 1 1 1.5 3.5" fill="none" stroke={DIM} strokeWidth={1.6} strokeLinecap="round" />
            <Polyline points="4,6 5,10 9,9" fill="none" stroke={DIM} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
        <Pressable onPress={() => Linking.openURL(url)} hitSlop={12} style={styles.iconBtn}>
          <Svg width={20} height={20}>
            <Path d="M8 4 H5 a1 1 0 0 0 -1 1 V15 a1 1 0 0 0 1 1 H15 a1 1 0 0 0 1 -1 V12" fill="none" stroke={DIM} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            <Line x1={10} y1={10} x2={16} y2={4} stroke={DIM} strokeWidth={1.5} strokeLinecap="round" />
            <Polyline points="12,4 16,4 16,8" fill="none" stroke={DIM} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
      </View>
      <View style={styles.webWrap}>
        <WebView
          ref={ref}
          source={{ uri: url }}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onNavigationStateChange={(s) => setCanGoBack(s.canGoBack)}
          style={styles.web}
        />
        {loading ? (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator color={GOLD} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: BG },
  bar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  urlPill: { flex: 1, backgroundColor: 'rgba(201,168,106,0.07)', borderWidth: 1, borderColor: 'rgba(201,168,106,0.2)', borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 6 },
  urlText: { color: DIM, fontSize: 12 },
  webWrap: { flex: 1, backgroundColor: '#fff' },
  web: { flex: 1 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },
});
