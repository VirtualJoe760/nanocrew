import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SiteEditor } from '@/components/site-editor';
import { SitePreview } from '@/components/site-preview';
import { StudioComposer } from '@/components/studio-composer';
import { summonEve } from '@/lib/eve-bus';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { glow } from '@/constants/glow';
import { apiUrl, readJson } from '@/lib/api';
import { type StudioPalette, useStudioPalette } from '@/lib/studio-palette';

// THE BRAND DECK — the brands page, opened only by the wheel's BRANDS spoke. A full-screen deck that
// slides down over Eve, holding your brands as a horizontally-PAGED carousel (one brand per screen,
// swipe left/right), the "+ new brand" page last. It paints its own dark scrim over the persistent
// Eve — no second GL context. Card order (Joe, 2026-08-17): title → console nav → thumbnail →
// FINISH YOUR SITE. Dismiss: the ✕ top-right (swipe-up on the top bar still works).

const OPEN_MS = 320;
const BACKDROP = 'rgba(6,8,12,0.9)'; // near-opaque so brand imagery reads; Eve still glows faintly through

type Bounties = { product: boolean; hero: boolean; logo: boolean; cover: boolean };
type Revision = { id: string; requestMd: string; status: 'building' | 'ready' | 'approved' | 'failed'; previewUrl: string | null; createdAt?: string };
type StoreRow = { slug: string; name: string; revenueCents: number; orders: number; bannerUrl?: string | null; logoUrl?: string | null; ogImageUrl?: string | null; deploymentUrl?: string | null; customDomain?: string | null; productImages?: string[]; bounties?: Bounties };

/** The live site URL — custom domain first, else a real (non-placeholder) deployment. */
function siteUrlFor(st: StoreRow): string | null {
  if (st.customDomain) return `https://${st.customDomain}`;
  if (st.deploymentUrl && !st.deploymentUrl.includes('github.com')) return st.deploymentUrl;
  return null;
}

const BOUNTY_STEPS: { key: keyof Bounties; label: string; panel: 'products' | 'web'; slot?: 'hero' | 'cover' | 'logo' }[] = [
  { key: 'product', label: 'Add your first product', panel: 'products' },
  { key: 'hero', label: 'Design your website hero', panel: 'web', slot: 'hero' },
  { key: 'logo', label: 'Add your logo', panel: 'web', slot: 'logo' },
  { key: 'cover', label: 'Add a collection cover', panel: 'web', slot: 'cover' },
];

export function BrandDeck({
  shown,
  token,
  refreshKey,
  onClose,
  onBounty,
  focus,
}: {
  shown: boolean;
  token: string;
  /** Bump to force a refetch (e.g. after a brand is created). */
  refreshKey?: number;
  onClose: () => void;
  onBounty?: (panel: 'products' | 'web', slot?: 'hero' | 'cover' | 'logo') => void;
  /** Deep-link landing: open ON this brand with this tab active (push → review, post-submit). */
  focus?: { slug: string; tab?: 'posts' | 'settings' } | null;
}) {
  const p = useStudioPalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const s = makeStyles(p);

  const [stores, setStores] = useState<StoreRow[]>([]);
  const [page, setPage] = useState(0);
  // THE MERGE (Joe, 2026-08-17): the deck IS the console now. null = overview (banner + checklist);
  // a tab renders the embedded StudioComposer inline. One surface — no second panel ever opens.
  const [activeTab, setActiveTab] = useState<'posts' | 'settings' | null>(null);
  const [siteOptions, setSiteOptions] = useState(false); // the overview's ✦ Site Options → SiteEditor
  // ── Forge-revision review, re-homed from the deleted Edit-site tab (task #6): the overview shows
  // a status row for the VISIBLE brand — building → progress line; ready → Review; failed → dismiss.
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [reviewRev, setReviewRev] = useState<Revision | null>(null);
  const [critique, setCritique] = useState(false);
  const [approving, setApproving] = useState(false);
  const pagerRef = useRef<ScrollView>(null);

  // Deep-link landing (push → review, site submitted): jump to the brand's page + open its tab.
  useEffect(() => {
    if (!shown || !focus || !stores.length) return;
    const i = stores.findIndex((st) => st.slug === focus.slug);
    if (i >= 0) {
      pagerRef.current?.scrollTo({ x: i * width, animated: false });
      setPage(i);
      setActiveTab(focus.tab ?? null);
    }
  }, [shown, focus, stores, width]);



  const load = useCallback(async () => {
    try {
      const statsRes = await fetch(apiUrl('/api/creator/stats'), { headers: { Authorization: `Bearer ${token}` } });
      const d = await readJson<{ stores?: StoreRow[] }>(statsRes);
      setStores(d.stores ?? []);
    } catch {
      /* keep prior */
    }
  }, [token]);

  // Refetch on mount + whenever the deck is pulled open (so it's always fresh) + on refreshKey bumps.
  useEffect(() => {
    if (shown) void load();
  }, [shown, refreshKey, load]);

  const currentSlug = stores[page]?.slug ?? null;
  const loadRevisions = useCallback(async () => {
    if (!currentSlug) return;
    try {
      const r = await fetch(apiUrl(`/api/creator/revisions?storeSlug=${encodeURIComponent(currentSlug)}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await readJson<{ revisions?: Revision[] }>(r);
      setRevisions(d.revisions ?? []);
    } catch {
      /* keep prior */
    }
  }, [currentSlug, token]);
  // The edit awaiting the creator (never the initial provision — that's the card's own state).
  const pendingRev = revisions.find(
    (r) => !r.requestMd.includes('"kind":"provision"') &&
      (r.status === 'building' || r.status === 'failed' || (r.status === 'ready' && !!r.previewUrl)),
  );
  useEffect(() => {
    if (!shown || !currentSlug) return;
    void loadRevisions();
    // Poll only while a build is in flight — the row flips to Review on its own.
    const t = setInterval(() => void loadRevisions(), 6000);
    return () => clearInterval(t);
  }, [shown, currentSlug, loadRevisions]);

  const approveRev = async (rev: Revision) => {
    if (approving) return;
    setApproving(true);
    try {
      const res = await fetch(apiUrl(`/api/creator/revisions/${rev.id}/approve`), {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) { setReviewRev(null); setCritique(false); void loadRevisions(); }
    } finally {
      setApproving(false);
    }
  };
  const declineRev = (rev: Revision) => {
    setRevisions((rs) => rs.filter((r) => r.id !== rev.id)); // hide now; server confirms
    void fetch(apiUrl(`/api/creator/revisions/${rev.id}/decline`), {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    }).finally(() => void loadRevisions());
  };

  // ── Cross-dissolve: fades in over Eve, fades out on close (Joe, 2026-08-17 — was a slide). ──
  const fade = useSharedValue(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (shown) {
      setMounted(true);
      fade.value = withTiming(1, { duration: OPEN_MS, easing: Easing.out(Easing.cubic) });
    } else {
      // Closing returns the deck to the overview for its next open (a deep-link focus re-applies
      // its tab on top). Done here, not in a dep-watching effect — that raced the pill taps.
      setActiveTab(null);
      fade.value = withTiming(0, { duration: OPEN_MS, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
    }
  }, [shown, fade]);

  const dissolve = useAnimatedStyle(() => ({ opacity: fade.value }));

  // Swipe UP on the top handle dismisses (scoped to the handle so the horizontal pager keeps its
  // gestures). Distance OR velocity commits — mirrors the old overlay's dismiss thresholds.
  const dismissPan = Gesture.Pan()
    .activeOffsetY(-14)
    .onEnd((e) => {
      if (e.translationY < -40 || e.velocityY < -500) runOnJS(onClose)();
    });

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width > 0) setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  if (!mounted) return null;

  const pageCount = stores.length; // one page per brand — building a NEW one is Eve's job (her wheel), not a deck page

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, dissolve]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: BACKDROP }]} pointerEvents="none" />

      {/* Top bar — just the ✕. Swipe-up on the bar still dismisses. */}
      <GestureDetector gesture={dismissPan}>
        <View style={[styles.handleBar, { paddingTop: insets.top + Spacing.two }]}>
          <View style={styles.flex} />
          <Pressable onPress={onClose} hitSlop={14} accessibilityLabel="Close brands">
            <ThemedText type="code" style={s.closeX}>✕</ThemedText>
          </Pressable>
        </View>
      </GestureDetector>

      {/* Horizontally-paged brands — one per screen; the last page builds a new brand. */}
      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={styles.pager}>
        {stores.map((store, i) => {
          // The brand BANNER (site hero / generated OG card) — never a random product photo (Joe).
          const hero = store.bannerUrl ?? store.ogImageUrl ?? store.productImages?.[0] ?? null;
          const todo = store.bounties ? BOUNTY_STEPS.filter((b) => !store.bounties![b.key]) : [];
          return (
            <View key={store.slug} style={[styles.pageCol, { width }]}>
              {/* 1 — the brand, named first. */}
              <View style={styles.meta}>
                <ThemedText type="title" style={{ color: p.ink }}>{store.name}</ThemedText>
                <ThemedText type="code" style={s.dim}>
                  ${(store.revenueCents / 100).toFixed(2)} · {store.orders} {store.orders === 1 ? 'order' : 'orders'}
                </ThemedText>
              </View>

              {/* 2 — the console nav. Tap toggles the tab inline; tapping the active one returns
                  to the overview. (Sell is gone — rebuilt later, Joe.) */}
              <View style={s.quickRow}>
                {([['posts', 'Posts'], ['settings', 'Settings']] as const).map(([key, label]) => (
                  <Pressable
                    key={key}
                    style={[s.quickPill, activeTab === key && s.quickPillOn]}
                    onPress={() => setActiveTab((cur) => (cur === key ? null : key))}
                    hitSlop={10}>
                    <ThemedText type="code" style={[s.quickPillText, activeTab === key && s.quickPillTextOn]}>{label}</ThemedText>
                  </Pressable>
                ))}
              </View>

              {activeTab && i === page ? (
                /* 3b — the console, INLINE (the merge): only on the visible page so we never mount
                   one fetching console per brand. */
                <View style={styles.consoleFill}>
                  <StudioComposer
                    embedded
                    visible={shown}
                    token={token}
                    slug={store.slug}
                    brandName={store.name}
                    initialTab={activeTab}
                    onClose={() => setActiveTab(null)}
                    onDeleted={() => { setActiveTab(null); void load(); }}
                    onBrandRenamed={() => void load()}
                  />
                </View>
              ) : (
                <>
                  {/* 3 — the banner (tap → Edit site). Wordmark bottom-left, edit tag bottom-right. */}
                  <Pressable
                    onPress={() => {
                      const url = siteUrlFor(store);
                      if (url) { onClose(); summonEve({ state: 'developing', payload: { slug: store.slug, url, name: store.name } }); }
                    }}
                    style={s.hero}>
                    {hero ? (
                      <Image source={{ uri: hero }} style={styles.heroImg} contentFit="cover" />
                    ) : (
                      <View style={[styles.heroImg, s.heroFallback]}>
                        <ThemedText type="title" style={{ color: p.ink }}>{store.name}</ThemedText>
                      </View>
                    )}
                    {store.logoUrl ? (
                      <Image source={{ uri: store.logoUrl }} style={s.heroWordmark} contentFit="contain" contentPosition="left bottom" />
                    ) : null}
                    <View style={s.editTag}>
                      <ThemedText type="code" style={s.editTagText}>edit →</ThemedText>
                    </View>
                  </Pressable>

                  {/* 3c — exact site edits, right here (the old Edit-site tab collapsed into the
                      overview — it was a twin of this page; Joe 2026-08-17). */}
                  <Pressable onPress={() => setSiteOptions(true)} style={[s.siteOptionsBtn, glow(p.accent, 12, 0.35)]}>
                    <ThemedText type="smallBold" style={{ color: p.onAccent }}>✦ Site Options</ThemedText>
                  </Pressable>

                  {/* 3d — forge-revision status for THIS brand (re-homed from the old Edit tab). */}
                  {pendingRev && i === page ? (
                    <View style={s.revRow}>
                      {pendingRev.status === 'building' ? (
                        <ThemedText type="small" style={s.dim}>⟳  Eve&apos;s building your site change…</ThemedText>
                      ) : pendingRev.status === 'failed' ? (
                        <>
                          <ThemedText type="small" style={s.dim}>That change didn&apos;t take.</ThemedText>
                          <Pressable onPress={() => declineRev(pendingRev)} hitSlop={8}>
                            <ThemedText type="code" style={s.dim}>✕</ThemedText>
                          </Pressable>
                        </>
                      ) : (
                        <>
                          <ThemedText type="small" style={{ color: p.ink }}>Site changes ready</ThemedText>
                          <Pressable onPress={() => setReviewRev(pendingRev)} hitSlop={8}>
                            <ThemedText type="smallBold" style={{ color: p.accent }}>Review →</ThemedText>
                          </Pressable>
                        </>
                      )}
                    </View>
                  ) : null}

                  {/* 4 — finish-your-site, right under the banner. */}
                  {todo.length && onBounty ? (
                    <View style={s.bountyBox}>
                      <ThemedText type="code" style={s.bountyHead}>FINISH YOUR SITE</ThemedText>
                      {todo.map((b) => (
                        <Pressable key={b.key} style={s.bountyRow} onPress={() => onBounty(b.panel, b.slot)}>
                          <ThemedText type="small" style={{ color: p.ink }}>○  {b.label}</ThemedText>
                          <ThemedText type="small" style={{ color: p.accent }}>→</ThemedText>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </>
              )}
            </View>
          );
        })}

      </ScrollView>

      {/* Review a ready revision — the same SitePreview review the old Edit tab used. */}
      {reviewRev?.previewUrl && stores[page] ? (
        <SitePreview
          visible
          url={reviewRev.previewUrl}
          onClose={() => { setReviewRev(null); setCritique(false); }}
          critique={critique ? { slug: stores[page].slug, token, onSent: () => { setReviewRev(null); setCritique(false); void loadRevisions(); } } : undefined}
          review={!critique ? { onContinueEditing: () => setCritique(true), onApprove: () => void approveRev(reviewRev), approving } : undefined}
        />
      ) : null}

      {/* ✦ Site Options — the mini-CMS, hosted by the deck for the visible brand. */}
      {siteOptions && stores[page] ? (
        <SiteEditor
          visible={siteOptions}
          onClose={() => setSiteOptions(false)}
          token={token}
          slug={stores[page].slug}
          brandName={stores[page].name}
          onSaved={() => void load()}
        />
      ) : null}

      {/* Paging dots. */}
      {pageCount > 1 ? (
        <View style={[styles.dots, { bottom: insets.bottom + Spacing.four }]} pointerEvents="none">
          {Array.from({ length: pageCount }).map((_, i) => (
            <View key={i} style={[s.dot, i === page && s.dotOn]} />
          ))}
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 50 },
  flex: { flex: 1 },
  handleBar: { flexDirection: 'row', alignItems: 'center', paddingBottom: Spacing.three, paddingHorizontal: Spacing.four },
  pager: { flex: 1 },
  pageCol: { height: '100%', paddingHorizontal: Spacing.four, gap: Spacing.four },
  meta: { gap: Spacing.one },
  consoleFill: { flex: 1 },
  // The banner renders at its own OG ratio (1200x630) so the artwork is never cropped.
  heroImg: { width: '100%', aspectRatio: 1200 / 630 },
  dots: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
});

function makeStyles(p: StudioPalette) {
  return StyleSheet.create({
    closeX: { color: p.ink, fontSize: 17, padding: Spacing.one },
    dim: { color: p.dim },
    hero: { borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(205,209,217,0.14)', backgroundColor: 'rgba(24,25,30,0.92)' },
    heroFallback: { alignItems: 'center', justifyContent: 'center' },
    quickRow: { flexDirection: 'row', gap: Spacing.two },
    quickPill: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: 999, borderWidth: 1, borderColor: p.line, backgroundColor: 'rgba(22,22,25,0.7)' },
    quickPillOn: { backgroundColor: p.accent, borderColor: p.accent },
    quickPillText: { color: p.ink, fontSize: 11, letterSpacing: 0.5 },
    quickPillTextOn: { color: p.onAccent },
    heroWordmark: { position: 'absolute', left: Spacing.three, bottom: Spacing.three, width: '45%', height: 30 },
    editTag: { position: 'absolute', right: Spacing.three, bottom: Spacing.three, backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 5 },
    editTagText: { color: p.onAccent, fontSize: 11, letterSpacing: 0.5 },
    bountyBox: { borderRadius: 14, borderWidth: 1, borderColor: p.line, backgroundColor: 'rgba(22,22,25,0.6)', padding: Spacing.four, gap: Spacing.three },
    bountyHead: { color: p.accent, letterSpacing: 1.5 },
    bountyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    siteOptionsBtn: { alignItems: 'center', paddingVertical: Spacing.three, borderRadius: 999, backgroundColor: p.accent },
    revRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 14, borderWidth: 1, borderColor: p.line, backgroundColor: 'rgba(22,22,25,0.6)', paddingHorizontal: Spacing.four, paddingVertical: Spacing.three },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(205,209,217,0.3)' },
    dotOn: { backgroundColor: p.accent, width: 7, height: 7, borderRadius: 4 },
  });
}
