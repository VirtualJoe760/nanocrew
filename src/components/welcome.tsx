import { useEffect, useRef, useState } from 'react';
import { Dimensions, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';

import { NCMark, type Palette, usePalette } from '@/components/nc-screen';
import { AppBackground } from '@/components/backgrounds/app-background';
import PhoneScene from '@/components/phone-scene';
import { ThemedText } from '@/components/themed-text';
import { glow, textGlow } from '@/constants/glow';

// First-launch welcome carousel (presented as a full-screen Modal by studio.tsx). Advertises the app
// (Studio · Design · Market), then a plan picker with the sign-up offer, or "shop & browse for free".
// Pure presentation — the parent persists the chosen intent + handles auth/routing. Slide copy
// doubles as the App Store screenshot captions.

export type OnboardChoice = 'subscribe' | 'shop' | 'login';

type ScreenKind = 'venus' | 'studio' | 'design' | 'market';
type Slide = { key: string; eyebrow: string; title: string; body: string; screen: ScreenKind };

// TODO(screenshots): drop real logged-in captures into assets/onboarding/<key>.png and render them
// in the phone frame below (Market can use the public Discover screen; Studio/Design need a brand).
const SLIDES: Slide[] = [
  {
    key: 'welcome',
    eyebrow: 'FROM IDEA TO BRAND IN SECONDS',
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
    title: 'Your whole brand, one screen.',
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
    body: 'One tap puts it on sale. We print, pack, and ship every order — you never touch inventory.',
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

// ── Sign-up offer + pricing (tune here) ─────────────────────────────────────────────────────────
// 15% off — first MONTH on a monthly plan, the whole YEAR on an annual plan. Platform-aware pricing:
// Apple (in-app) is higher to cover Apple's cut; Stripe (web) is lower. These are DISPLAY values; the
// real prices/discount/annual products live in App Store Connect + Stripe and mirror billing.ts TIERS.
const DISCOUNT = 0.15;
const isApple = Platform.OS === 'ios';
const PLANS = [
  { plan: 'starter', label: 'Starter', stripe: 1000, apple: 1399, blurb: '500 credits/mo · sell in-app', popular: false },
  { plan: 'pro', label: 'Pro', stripe: 5000, apple: 6000, blurb: '3,000 credits/mo · website + domain', popular: true },
  { plan: 'advanced', label: 'Advanced', stripe: 17500, apple: 19900, blurb: '12,000 credits/mo · best rate', popular: false },
] as const;
const baseMonthly = (pl: (typeof PLANS)[number]) => (isApple ? pl.apple : pl.stripe);
const money = (c: number) => {
  const v = c / 100;
  return `$${Number.isInteger(v) ? v : v.toFixed(2)}`;
};

const appVersion = `v${Constants.expoConfig?.version ?? '1.0.0'}${
  Constants.expoConfig?.ios?.buildNumber ? ` (${Constants.expoConfig.ios.buildNumber})` : ''
}`;

export function Welcome({
  onChoose,
  topInset = 0,
  bottomInset = 0,
}: {
  onChoose: (choice: OnboardChoice) => void;
  topInset?: number;
  bottomInset?: number;
}) {
  const p = usePalette();
  const s = makeStyles(p);
  const scroller = useRef<ScrollView>(null);
  const [width, setWidth] = useState(Dimensions.get('window').width);
  const [page, setPage] = useState(0);
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly');
  const scrollXRef = useRef(0);
  const widthRef = useRef(width);
  const lastPage = SLIDES.length;
  const pageCount = SLIDES.length + 1;

  const onLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width;
    setWidth(e.nativeEvent.layout.width);
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollXRef.current = e.nativeEvent.contentOffset.x;
    const i = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    if (i !== page) setPage(i);
  };
  const goTo = (i: number) => scroller.current?.scrollTo({ x: i * width, animated: true });

  // Web: RN-web's ScrollView only scrolls via wheel/touch, not mouse drag — wire up grab-to-swipe,
  // driving the ScrollView's own scrollTo (reliable across RN-web's nested nodes) + snap on release.
  // No-op on native (touch handles paging).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let down = false;
    let startX = 0;
    let startScroll = 0;
    let moved = false;
    const onDown = (e: any) => {
      down = true;
      moved = false;
      startX = e.clientX;
      startScroll = scrollXRef.current;
    };
    const onMove = (e: any) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      scroller.current?.scrollTo({ x: Math.max(0, startScroll - dx), animated: false });
      e.preventDefault();
    };
    const onUp = (e: any) => {
      if (!down) return;
      down = false;
      if (!moved) return; // a plain click — let it through to buttons
      const w = widthRef.current || 1;
      const dragged = startScroll - (e.clientX - startX);
      scroller.current?.scrollTo({ x: Math.max(0, Math.round(dragged / w) * w), animated: true });
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <View style={s.root}>
      {/* App-wide dot-field background (the welcome is a Modal, a separate layer, so the root one
          isn't behind it — render our own here). It carries its own scrim for text contrast. */}
      <AppBackground />

      {/* Top bar: just log in (brand mark removed per design) */}
      <View style={[s.topBar, { paddingTop: topInset + 14 }]}>
        <Pressable onPress={() => onChoose('login')} hitSlop={8}>
          <ThemedText type="code" style={[s.loginLink, { color: p.accent }, textGlow(p.accent, 8)]}>Log in</ThemedText>
        </Pressable>
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onLayout={onLayout}
        onMomentumScrollEnd={onScroll}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={s.pager}>
        {SLIDES.map((slide, i) => (
          <View key={slide.key} style={[s.slide, { width }]}>
            <PhoneFrame kind={slide.screen} p={p} active={i === page} />
            <View style={s.copy}>
              <ThemedText type="code" style={[s.eyebrow, { color: p.accent }, textGlow(p.accent, 7)]}>{slide.eyebrow}</ThemedText>
              <ThemedText type="title" style={[s.title, { color: p.ink }, textGlow('rgba(205,209,217,0.55)', 16)]}>{slide.title}</ThemedText>
              <ThemedText type="small" style={[s.body, { color: p.dim }]}>{slide.body}</ThemedText>
            </View>
          </View>
        ))}

        {/* Offer / plan picker */}
        <View key="cta" style={[s.slide, s.ctaSlide, { width }]}>
          <ThemedText type="title" style={[s.title, s.ctaTitle, { color: p.ink }, textGlow('rgba(205,209,217,0.55)', 16)]}>Start your label today.</ThemedText>
          <ThemedText type="code" style={[s.offerBanner, { color: p.accent }, textGlow(p.accent, 9)]}>
            {billing === 'annual' ? 'LIMITED — 15% OFF YOUR FIRST YEAR' : 'LIMITED — 15% OFF YOUR FIRST MONTH'}
          </ThemedText>

          {/* Monthly / annual toggle */}
          <View style={[s.toggle, { borderColor: p.faint }]}>
            <Pressable onPress={() => setBilling('monthly')} style={[s.toggleBtn, billing === 'monthly' && { backgroundColor: p.accent }]}>
              <ThemedText type="code" style={{ color: billing === 'monthly' ? p.bg : p.dim }}>Monthly</ThemedText>
            </Pressable>
            <Pressable onPress={() => setBilling('annual')} style={[s.toggleBtn, billing === 'annual' && { backgroundColor: p.accent }]}>
              <ThemedText type="code" style={{ color: billing === 'annual' ? p.bg : p.dim }}>Annual · save 15%</ThemedText>
            </Pressable>
          </View>

          {PLANS.map((pl) => {
            const m = baseMonthly(pl);
            const firstMonth = Math.round(m * (1 - DISCOUNT));
            const year = m * 12;
            const yearDisc = Math.round(year * (1 - DISCOUNT));
            return (
              <Pressable
                key={pl.plan}
                onPress={() => onChoose('subscribe')}
                style={[
                  s.planCard,
                  { borderColor: pl.popular ? p.accent : p.faint, backgroundColor: pl.popular ? (p.dark ? '#101014' : '#fbfbfc') : 'transparent' },
                  pl.popular && glow(p.accent, 16, 0.45),
                ]}>
                <View style={s.planRow}>
                  <ThemedText type="smallBold" style={{ color: p.ink }}>
                    {pl.label}
                    {pl.popular ? <ThemedText type="code" style={{ color: p.accent }}>  · POPULAR</ThemedText> : null}
                  </ThemedText>
                  {billing === 'monthly' ? (
                    <View style={s.planPrice}>
                      <ThemedText type="code" style={[s.strike, { color: p.faint }]}>{money(m)}</ThemedText>
                      <ThemedText type="smallBold" style={{ color: p.ink }}>{` ${money(firstMonth)}`}</ThemedText>
                      <ThemedText type="code" style={{ color: p.dim }}> 1st mo</ThemedText>
                    </View>
                  ) : (
                    <View style={s.planPrice}>
                      <ThemedText type="code" style={[s.strike, { color: p.faint }]}>{money(year)}</ThemedText>
                      <ThemedText type="smallBold" style={{ color: p.ink }}>{` ${money(yearDisc)}`}</ThemedText>
                      <ThemedText type="code" style={{ color: p.dim }}> /yr</ThemedText>
                    </View>
                  )}
                </View>
                <ThemedText type="code" style={[s.planBlurb, { color: p.dim }]}>
                  {billing === 'monthly' ? `${pl.blurb} · then ${money(m)}/mo` : `${pl.blurb} · billed yearly`}
                </ThemedText>
              </Pressable>
            );
          })}

          <Pressable onPress={() => onChoose('shop')} hitSlop={8} style={s.declineLink}>
            <ThemedText type="small" style={[s.declineText, { color: p.dim }]}>Not ready? Shop and browse for free</ThemedText>
          </Pressable>
        </View>
      </ScrollView>

      {/* Footer: Next + dots + version */}
      <View style={[s.footer, { paddingBottom: bottomInset + 14 }]}>
        {page < lastPage ? (
          <Pressable onPress={() => goTo(page + 1)} style={[s.nextBtn, { backgroundColor: p.accent }, glow(p.accent, 20, 0.6)]}>
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
        <ThemedText type="code" style={[s.version, { color: p.faint }]}>{appVersion}</ThemedText>
      </View>
    </View>
  );
}

/**
 * The hero phone for a slide. On WEB the active slide shows a softly-spinning 3D iPhone
 * (PhoneScene — R3F web entry, like the Venus Lab); inactive slides + all of native fall back to a
 * static iPhone frame until the expo-gl/native R3F swap lands. Real per-slide app captures replace
 * the 3D screen texture once we have the screenshots (see the TODO above SLIDES).
 */
function PhoneFrame({ kind, p, active }: { kind: ScreenKind; p: Palette; active: boolean }) {
  const s = makeStyles(p);
  const h = Math.min(Dimensions.get('window').height * 0.5, 540);
  const w = h * 0.46;
  if (Platform.OS === 'web' && active) {
    return (
      <View style={s.previewWrap}>
        <View style={{ width: w * 1.6, height: h }}>
          <PhoneScene />
        </View>
      </View>
    );
  }
  return (
    <View style={s.previewWrap}>
      <View style={[s.phone, { width: w, height: h, borderColor: p.faint, backgroundColor: p.dark ? '#0c0c0f' : '#ffffff' }]}>
        <View style={[s.notch, { backgroundColor: p.dark ? '#000' : '#e9e9ec' }]} />
        <NCMark size={Math.round(w * 0.2)} color={p.faint} />
        <ThemedText type="code" style={[s.previewLabel, { color: p.faint }]}>{SCREEN_LABEL[kind]}</ThemedText>
      </View>
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: p.bg },
    topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: 22, paddingTop: 14, paddingBottom: 4 },
    loginLink: { fontSize: 13, letterSpacing: 0.5 },
    pager: { flex: 1 },
    slide: { flex: 1, paddingHorizontal: 28, justifyContent: 'center' },
    previewWrap: { alignItems: 'center', justifyContent: 'center', flex: 1, marginBottom: 20 },
    phone: { borderRadius: 40, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 14, overflow: 'hidden' },
    notch: { position: 'absolute', top: 14, width: 64, height: 18, borderRadius: 11 },
    previewLabel: { fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase' },
    copy: { paddingBottom: 6 },
    eyebrow: { fontSize: 11, letterSpacing: 2, marginBottom: 10 },
    title: { fontSize: 28, lineHeight: 34, marginBottom: 12 },
    body: { fontSize: 15, lineHeight: 22 },
    ctaSlide: { justifyContent: 'center' },
    ctaTitle: { textAlign: 'center', marginTop: 6, marginBottom: 4 },
    offerBanner: { fontSize: 11, letterSpacing: 1.2, textAlign: 'center', marginBottom: 16 },
    toggle: { flexDirection: 'row', alignSelf: 'center', borderWidth: 1, borderRadius: 12, padding: 3, marginBottom: 18 },
    toggleBtn: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 9 },
    planCard: { width: '100%', borderWidth: 1, borderRadius: 16, paddingVertical: 13, paddingHorizontal: 16, marginBottom: 12 },
    planRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    planPrice: { flexDirection: 'row', alignItems: 'baseline' },
    strike: { textDecorationLine: 'line-through', fontSize: 12 },
    planBlurb: { fontSize: 11, marginTop: 5 },
    declineLink: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
    declineText: { fontSize: 14 },
    footer: { paddingHorizontal: 22, paddingTop: 8, alignItems: 'center' },
    nextBtn: { alignSelf: 'center', minWidth: 200, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 28, alignItems: 'center', marginBottom: 14 },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: 7, marginBottom: 10 },
    dot: { width: 7, height: 7, borderRadius: 4 },
    version: { fontSize: 10, letterSpacing: 0.5 },
  });
}
