import { useRef, useState } from 'react';
import { Dimensions, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';

import { FabricBackground, NCMark, type Palette, usePalette } from '@/components/nc-screen';
import { ThemedText } from '@/components/themed-text';

// First-launch welcome carousel. Advertises the app's value (Studio · Design · Market) and offers
// three ways in: a 7-day Pro free trial, a free account ($3 of credits), or "just here to shop".
// Pure presentation — the parent (studio.tsx) persists the chosen intent + handles auth/routing.
// Slide copy doubles as the App Store screenshot captions.

export type OnboardChoice = 'trial' | 'free' | 'shop' | 'login';

type Slide = { key: string; eyebrow: string; title: string; body: string; screen: ScreenKind };
type ScreenKind = 'venus' | 'studio' | 'design' | 'market';

// TODO(screenshots): drop real logged-in captures into assets/onboarding/<key>.png and render them
// in the preview frame below (Market can use the public Discover screen; Studio/Design need a brand).
const SLIDES: Slide[] = [
  {
    key: 'welcome',
    eyebrow: 'INTELLIGENCE IS THE NEW FABRIC',
    title: 'Welcome to Nano Crew',
    body: 'Start a real clothing brand from a conversation. Meet Venus, your AI brand consultant — tell her your vision and she builds it with you.',
    screen: 'venus',
  },
  {
    key: 'studio1',
    eyebrow: 'STUDIO',
    title: 'Say it. Venus builds it.',
    body: 'Describe your vibe in plain words. Venus names your brand, designs its identity, and spins up a store — in minutes, no design skills, no code.',
    screen: 'studio',
  },
  {
    key: 'studio2',
    eyebrow: 'STUDIO',
    title: 'Your brand, run from one screen.',
    body: 'Studio is your command center — brand identity, products, and a full storefront website you edit just by chatting.',
    screen: 'studio',
  },
  {
    key: 'design1',
    eyebrow: 'DESIGN',
    title: 'Designs that drop in seconds.',
    body: 'Generate AI artwork or bring your own, then place it on real apparel — print-ready, on-model, ready to sell.',
    screen: 'design',
  },
  {
    key: 'design2',
    eyebrow: 'DESIGN',
    title: 'Publish a product instantly.',
    body: 'One tap puts it on sale in your shop. We print, pack, and ship every order — you never touch inventory.',
    screen: 'design',
  },
  {
    key: 'market',
    eyebrow: 'MARKET',
    title: 'Open for business, day one.',
    body: 'Sell in the Nano Crew Market and on your own website. Checkout, fulfillment, and payouts are handled — you just keep creating.',
    screen: 'market',
  },
];

const SCREEN_LABEL: Record<ScreenKind, string> = { venus: 'Meet Venus', studio: 'Studio', design: 'Design', market: 'Market' };

const appVersion = `v${Constants.expoConfig?.version ?? '1.0.0'}${
  Constants.expoConfig?.ios?.buildNumber ? ` (${Constants.expoConfig.ios.buildNumber})` : ''
}`;

export function Welcome({ onChoose }: { onChoose: (choice: OnboardChoice) => void }) {
  const p = usePalette();
  const s = makeStyles(p);
  const insets = useSafeAreaInsets();
  const scroller = useRef<ScrollView>(null);
  const [width, setWidth] = useState(Dimensions.get('window').width);
  const [page, setPage] = useState(0);
  const lastPage = SLIDES.length; // the extra CTA page
  const pageCount = SLIDES.length + 1;

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    if (i !== page) setPage(i);
  };
  const goTo = (i: number) => scroller.current?.scrollTo({ x: i * width, animated: true });

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <FabricBackground p={p} />

      {/* Top bar: brand mark + Skip-to-offer */}
      <View style={s.topBar}>
        <NCMark size={20} color={p.ink} />
        {page < lastPage ? (
          <Pressable onPress={() => goTo(lastPage)} hitSlop={8}>
            <ThemedText type="code" style={[s.skip, { color: p.dim }]}>Skip</ThemedText>
          </Pressable>
        ) : (
          <View style={{ width: 36 }} />
        )}
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onLayout={onLayout}
        onMomentumScrollEnd={onScroll}
        onScroll={onScroll}
        scrollEventThrottle={32}
        style={s.pager}
      >
        {SLIDES.map((slide) => (
          <View key={slide.key} style={[s.slide, { width }]}>
            <ScreenPreview kind={slide.screen} p={p} />
            <View style={s.copy}>
              <ThemedText type="code" style={[s.eyebrow, { color: p.dim }]}>{slide.eyebrow}</ThemedText>
              <ThemedText type="title" style={[s.title, { color: p.ink }]}>{slide.title}</ThemedText>
              <ThemedText type="small" style={[s.body, { color: p.dim }]}>{slide.body}</ThemedText>
            </View>
          </View>
        ))}

        {/* CTA page */}
        <View style={[s.slide, s.ctaSlide, { width }]}>
          <NCMark size={64} color={p.ink} />
          <ThemedText type="title" style={[s.title, s.ctaTitle, { color: p.ink }]}>Start your label today.</ThemedText>
          <ThemedText type="small" style={[s.body, { color: p.dim, marginBottom: 28 }]}>
            Try Pro free for 7 days — a full week of credits to build your first drop. Cancel anytime before it renews at $50/mo.
          </ThemedText>

          <Pressable onPress={() => onChoose('trial')} style={[s.btnPrimary, { backgroundColor: p.accent }]}>
            <ThemedText type="smallBold" style={{ color: p.bg }}>Start 7-day free trial</ThemedText>
          </Pressable>
          <Pressable onPress={() => onChoose('free')} style={[s.btnOutline, { borderColor: p.accent }]}>
            <ThemedText type="smallBold" style={{ color: p.ink }}>Start free — $3 in credits</ThemedText>
          </Pressable>
          <Pressable onPress={() => onChoose('shop')} hitSlop={8} style={s.btnText}>
            <ThemedText type="code" style={[s.textLink, { color: p.dim }]}>No thanks — I’m just here to shop</ThemedText>
          </Pressable>

          <ThemedText type="code" style={[s.finePrint, { color: p.faint }]}>
            Free to explore. Plans start a store; credits power the AI.
          </ThemedText>
        </View>
      </ScrollView>

      {/* Footer — Next (advances; mouse can't drag-swipe on web), tappable dots, log-in + version. */}
      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        {page < lastPage ? (
          <Pressable onPress={() => goTo(page + 1)} style={[s.nextBtn, { backgroundColor: p.accent }]}>
            <ThemedText type="smallBold" style={{ color: p.bg }}>Next</ThemedText>
          </Pressable>
        ) : null}
        <View style={s.dots}>
          {Array.from({ length: pageCount }).map((_, i) => (
            <Pressable key={i} onPress={() => goTo(i)} hitSlop={6}>
              <View style={[s.dot, { backgroundColor: i === page ? p.accent : p.faint, opacity: i === page ? 1 : 0.4 }]} />
            </Pressable>
          ))}
        </View>
        <View style={s.footerRow}>
          <Pressable onPress={() => onChoose('login')} hitSlop={8}>
            <ThemedText type="code" style={[s.textLink, { color: p.dim }]}>Already have an account? Log in</ThemedText>
          </Pressable>
          <ThemedText type="code" style={[s.version, { color: p.faint }]}>{appVersion}</ThemedText>
        </View>
      </View>
    </SafeAreaView>
  );
}

/** Placeholder "screen" frame until real screenshots land (see TODO above). */
function ScreenPreview({ kind, p }: { kind: ScreenKind; p: Palette }) {
  const s = makeStyles(p);
  return (
    <View style={s.previewWrap}>
      <View style={[s.previewFrame, { borderColor: p.faint, backgroundColor: p.dark ? '#0d0d10' : '#ffffff' }]}>
        <NCMark size={40} color={p.faint} />
        <ThemedText type="code" style={[s.previewLabel, { color: p.faint }]}>{SCREEN_LABEL[kind]}</ThemedText>
      </View>
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: p.bg },
    topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 6, paddingBottom: 4 },
    skip: { fontSize: 13, letterSpacing: 0.5 },
    pager: { flex: 1 },
    slide: { flex: 1, paddingHorizontal: 28, justifyContent: 'center' },
    previewWrap: { alignItems: 'center', justifyContent: 'center', flex: 1, maxHeight: 360, marginBottom: 24 },
    previewFrame: { width: '78%', aspectRatio: 0.62, borderRadius: 28, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    previewLabel: { fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase' },
    copy: { paddingBottom: 8 },
    eyebrow: { fontSize: 11, letterSpacing: 2, marginBottom: 10 },
    title: { fontSize: 28, lineHeight: 34, marginBottom: 12 },
    body: { fontSize: 15, lineHeight: 22 },
    ctaSlide: { alignItems: 'center', justifyContent: 'center', gap: 0 },
    ctaTitle: { textAlign: 'center', marginTop: 20 },
    btnPrimary: { width: '100%', borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginBottom: 12 },
    btnOutline: { width: '100%', borderRadius: 16, paddingVertical: 16, alignItems: 'center', borderWidth: 1, marginBottom: 18 },
    btnText: { paddingVertical: 6 },
    textLink: { fontSize: 13, letterSpacing: 0.3 },
    finePrint: { fontSize: 11, letterSpacing: 0.5, marginTop: 22, textAlign: 'center' },
    footer: { paddingHorizontal: 22, paddingTop: 8 },
    nextBtn: { alignSelf: 'center', minWidth: 180, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 28, alignItems: 'center', marginBottom: 16 },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: 7, marginBottom: 14 },
    dot: { width: 7, height: 7, borderRadius: 4 },
    footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    version: { fontSize: 11, letterSpacing: 0.5 },
  });
}
