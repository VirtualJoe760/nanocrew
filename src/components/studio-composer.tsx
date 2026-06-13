import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';

import { SitePreview } from '@/components/site-preview';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { apiUrl } from '@/lib/api';
import { type StudioPalette, useStudioPalette } from '@/lib/studio-palette';

// Venus's management surface for a returning creator: request site changes in plain
// words (→ forge revision) and write journal posts. Calls the same creator endpoints
// the brand-site /admin uses. Opens from the Studio header. Theme-aware.

type StoreRow = { slug: string; name: string; deploymentUrl?: string | null; ogImageUrl?: string | null };

/** The public storefront URL — only when a real site is deployed. A brand can live on
 *  the Nanocrew shop with no website, so we never fabricate a URL that would 404. */
function siteUrlFor(s: StoreRow | undefined): string | null {
  if (!s?.deploymentUrl || s.deploymentUrl.includes('github.com')) return null;
  return s.deploymentUrl;
}
type Post = { id: string; slug: string; title: string; excerpt: string | null; bodyMd: string; isPublished: boolean };
type Revision = { id: string; requestMd: string; status: 'building' | 'ready' | 'approved' | 'failed'; previewUrl: string | null };
type Product = { id: string; name: string; imageUrl: string | null; videoUrl: string | null; isPublished: boolean };
type Draft = { id?: string; title: string; excerpt: string; bodyMd: string };
const EMPTY: Draft = { title: '', excerpt: '', bodyMd: '' };

type Insights = { revenueCents: number; orders: number; views30d: number; avgMarginPct: number | null; margins: MarginRow[] };
type MarginRow = { productId: string; name: string; retailCents: number | null; costCents: number | null; marginCents: number | null; marginPct: number | null };
type OrderRow = { id: string; status: string; totalCents: number; createdAt: string; storeSlug?: string };
type ConsoleTab = 'edit' | 'posts' | 'sell' | 'insights';
const TAB_LABEL: Record<ConsoleTab, string> = { edit: 'Edit site', posts: 'Posts', sell: 'Sell', insights: 'Insights' };

export function StudioComposer({ visible, onClose, token, onOpenBilling, slug, brandName }: { visible: boolean; onClose: () => void; token: string; onOpenBilling?: () => void; slug?: string; brandName?: string }) {
  const pal = useStudioPalette();
  const styles = useMemo(() => makeStyles(pal), [pal]);
  const [tab, setTab] = useState<ConsoleTab>('edit');
  const [insights, setInsights] = useState<Insights | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [active, setActive] = useState<string | null>(slug ?? null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [change, setChange] = useState('');
  const [changeState, setChangeState] = useState<'idle' | 'sending' | 'queued'>('idle');
  const [previewTarget, setPreviewTarget] = useState<string | null>(null);
  const [critiquePreview, setCritiquePreview] = useState(false);
  const [siteAction, setSiteAction] = useState<'idle' | 'building' | 'importing'>('idle');
  const [importUrl, setImportUrl] = useState('');
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [credits, setCredits] = useState<number | null>(null);
  const [voiceoverCost, setVoiceoverCost] = useState(25);
  const [genId, setGenId] = useState<string | null>(null); // product currently generating an ad
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const activeStore = stores.find((s) => s.slug === active);
  const siteUrl = siteUrlFor(activeStore);
  const ogImageUrl = activeStore?.ogImageUrl ?? null;

  const loadStores = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(apiUrl('/api/creator/stats'), { headers: { Authorization: `Bearer ${token}` } });
      const d = (await r.json()) as { stores?: StoreRow[] };
      setStores(d.stores ?? []);
      setActive((a) => slug ?? a ?? d.stores?.[0]?.slug ?? null);
    } catch {
      setNote('Could not reach your store.');
    } finally {
      setLoading(false);
    }
  }, [token, slug]);

  const loadInsights = useCallback(async () => {
    if (!active) return;
    try {
      const [statsRes, ordersRes, marginsRes] = await Promise.all([
        fetch(apiUrl('/api/creator/stats'), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(apiUrl('/api/creator/orders'), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(apiUrl('/api/creator/margins'), { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const sd = (await statsRes.json()) as { stores?: { slug: string; name: string; revenueCents: number; orders: number; views30d: number }[] };
      const store = sd.stores?.find((s) => s.slug === active);
      const od = (await ordersRes.json()) as { orders?: OrderRow[] };
      const md = (await marginsRes.json()) as { products?: (MarginRow & { storeName: string })[] };
      const name = brandName ?? store?.name;
      const mine = (md.products ?? []).filter((m) => m.storeName === name);
      const withCost = mine.filter((m) => m.marginPct != null);
      setInsights({
        revenueCents: store?.revenueCents ?? 0,
        orders: store?.orders ?? 0,
        views30d: store?.views30d ?? 0,
        avgMarginPct: withCost.length ? Math.round(withCost.reduce((n, m) => n + (m.marginPct ?? 0), 0) / withCost.length) : null,
        margins: mine,
      });
      setOrders((od.orders ?? []).filter((o) => o.storeSlug === active).slice(0, 10));
    } catch {
      /* leave as-is */
    }
  }, [active, token, brandName]);

  const loadPosts = useCallback(async () => {
    if (!active) return;
    try {
      const r = await fetch(apiUrl(`/api/creator/posts?storeSlug=${encodeURIComponent(active)}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = (await r.json()) as { posts?: Post[] };
      setPosts(d.posts ?? []);
    } catch {
      /* leave list as-is */
    }
  }, [active, token]);

  const loadRevisions = useCallback(async () => {
    if (!active) return;
    try {
      const r = await fetch(apiUrl(`/api/creator/revisions?storeSlug=${encodeURIComponent(active)}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = (await r.json()) as { revisions?: Revision[] };
      setRevisions(d.revisions ?? []);
    } catch {
      /* leave as-is */
    }
  }, [active, token]);

  const loadProducts = useCallback(async () => {
    if (!active) return;
    try {
      const r = await fetch(apiUrl(`/api/creator/products?storeSlug=${encodeURIComponent(active)}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = (await r.json()) as { products?: Product[] };
      setProducts(d.products ?? []);
    } catch {
      /* leave as-is */
    }
  }, [active, token]);

  const loadCredits = useCallback(async () => {
    try {
      const r = await fetch(apiUrl('/api/creator/credits'), { headers: { Authorization: `Bearer ${token}` } });
      const d = (await r.json()) as { balance?: number; costs?: { video_voiceover?: number } };
      if (typeof d.balance === 'number') setCredits(d.balance);
      if (typeof d.costs?.video_voiceover === 'number') setVoiceoverCost(d.costs.video_voiceover);
    } catch {
      /* leave as-is */
    }
  }, [token]);

  const makeVideoAd = async (p: Product) => {
    if (genId) return;
    if (credits !== null && credits < voiceoverCost) {
      setNote(`You need ${voiceoverCost} credits for a video ad — you have ${credits}.`);
      return;
    }
    setGenId(p.id);
    setNote(null);
    try {
      const res = await fetch(apiUrl('/api/video'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ productId: p.id, mode: 'voiceover', force: !!p.videoUrl }),
      });
      const d = (await res.json()) as { videoUrl?: string; error?: string; needed?: number; balance?: number };
      if (res.status === 402) {
        setCredits(d.balance ?? credits);
        setNote(`Not enough credits — a video ad costs ${d.needed ?? voiceoverCost}.`);
        return;
      }
      if (!res.ok || !d.videoUrl) throw new Error(d.error ?? 'failed');
      await Promise.all([loadProducts(), loadCredits()]);
    } catch {
      setNote('Could not create the video ad — your credits were not charged.');
    } finally {
      setGenId(null);
    }
  };

  useEffect(() => {
    if (slug) setActive(slug);
  }, [slug]);
  useEffect(() => {
    if (visible) {
      setTab('edit');
      setSiteAction('idle');
      setImportUrl('');
      void loadStores();
      void loadCredits();
    }
  }, [visible, loadStores, loadCredits]);
  useEffect(() => {
    if (visible && active) {
      void loadPosts();
      void loadRevisions();
      void loadProducts();
      void loadInsights();
    }
  }, [visible, active, loadPosts, loadRevisions, loadProducts, loadInsights]);

  const buildSite = async () => {
    if (!active) return;
    setSiteAction('building');
    setNote(null);
    try {
      const res = await fetch(apiUrl('/api/creator/build-site'), { method: 'POST', headers, body: JSON.stringify({ storeSlug: active }) });
      if (!res.ok) throw new Error();
      setNote('Building your site — Venus will have it ready shortly. Check back in a few minutes.');
    } catch {
      setNote('Could not start building your site.');
      setSiteAction('idle');
    }
  };

  const importSite = async () => {
    if (!active || !importUrl.trim()) return;
    setNote(null);
    try {
      const res = await fetch(apiUrl('/api/creator/import-site'), { method: 'POST', headers, body: JSON.stringify({ storeSlug: active, url: importUrl.trim() }) });
      const d = (await res.json()) as { ok?: boolean };
      if (!res.ok || !d.ok) throw new Error();
      setImportUrl('');
      setSiteAction('idle');
      await loadStores();
    } catch {
      setNote('Could not connect that site — check the URL.');
    }
  };

  const approve = async (rev: Revision) => {
    await fetch(apiUrl(`/api/creator/revisions/${rev.id}/approve`), { method: 'POST', headers });
    await loadRevisions();
  };

  const savePost = async (publish: boolean) => {
    if (!draft?.title.trim() || !active) {
      setNote('A title is required.');
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const body = JSON.stringify({ storeSlug: active, title: draft.title, excerpt: draft.excerpt, bodyMd: draft.bodyMd, publish });
      const url = draft.id ? apiUrl(`/api/creator/posts/${draft.id}`) : apiUrl('/api/creator/posts');
      const res = await fetch(url, { method: draft.id ? 'PATCH' : 'POST', headers, body });
      if (!res.ok) throw new Error('save failed');
      setDraft(null);
      await loadPosts();
    } catch {
      setNote('Could not save the post.');
    } finally {
      setBusy(false);
    }
  };

  const mutatePost = async (p: Post, method: 'PATCH' | 'DELETE', body?: object) => {
    await fetch(apiUrl(`/api/creator/posts/${p.id}`), { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    await loadPosts();
  };

  const sendChange = async () => {
    if (!change.trim() || !active) return;
    setChangeState('sending');
    try {
      const res = await fetch(apiUrl('/api/creator/revise'), { method: 'POST', headers, body: JSON.stringify({ storeSlug: active, requestMd: change.trim() }) });
      if (!res.ok) throw new Error();
      setChange('');
      setChangeState('queued');
      await loadRevisions();
    } catch {
      setChangeState('idle');
      setNote('Could not send your change.');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <ThemedText type="subtitle" style={styles.consoleTitle} numberOfLines={1}>
              {draft ? 'Write a post' : (brandName ?? stores.find((s) => s.slug === active)?.name ?? 'Brand console')}
            </ThemedText>
            <View style={{ flex: 1 }} />
            <Pressable onPress={draft ? () => { setDraft(null); setNote(null); } : onClose} hitSlop={12}>
              <ThemedText type="code" style={styles.dim}>
                {draft ? 'back' : 'close ✕'}
              </ThemedText>
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator style={styles.center} color={pal.accent} />
          ) : !stores.length ? (
            <View style={styles.center}>
              <ThemedText type="subtitle" style={styles.white}>
                No store yet
              </ThemedText>
              <ThemedText type="small" style={styles.dim}>
                Build one with your consultant first.
              </ThemedText>
            </View>
          ) : draft ? (
            <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
              <TextInput style={styles.input} placeholder="Post title" placeholderTextColor={pal.dim} value={draft.title} onChangeText={(t) => setDraft({ ...draft, title: t })} />
              <TextInput style={styles.input} placeholder="Short excerpt" placeholderTextColor={pal.dim} value={draft.excerpt} onChangeText={(t) => setDraft({ ...draft, excerpt: t })} />
              <TextInput style={[styles.input, styles.body]} placeholder="Write your post… Markdown works." placeholderTextColor={pal.dim} value={draft.bodyMd} onChangeText={(t) => setDraft({ ...draft, bodyMd: t })} multiline />
              {note ? <ThemedText type="small" style={styles.warn}>{note}</ThemedText> : null}
              <View style={styles.row}>
                <Pressable onPress={() => savePost(true)} disabled={busy} style={styles.primaryBtn}>
                  <ThemedText type="smallBold" style={{ color: pal.onAccent }}>{busy ? 'Saving…' : 'Publish'}</ThemedText>
                </Pressable>
                <Pressable onPress={() => savePost(false)} disabled={busy} hitSlop={8}>
                  <ThemedText type="code" style={styles.dim}>save draft</ThemedText>
                </Pressable>
              </View>
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
              {!slug && stores.length > 1 ? (
                <View style={styles.pills}>
                  {stores.map((s) => (
                    <Pressable key={s.slug} onPress={() => setActive(s.slug)} style={[styles.pill, active === s.slug && styles.pillOn]}>
                      <ThemedText type="code" style={active === s.slug ? { color: pal.onAccent } : styles.dim}>{s.name}</ThemedText>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <View style={styles.tabBar}>
                {(['edit', 'posts', 'sell', 'insights'] as const).map((t) => (
                  <Pressable key={t} onPress={() => setTab(t)} style={[styles.tabItem, tab === t && styles.tabItemOn]}>
                    <ThemedText type="code" style={tab === t ? styles.tabTextOn : styles.tabText}>{TAB_LABEL[t]}</ThemedText>
                  </Pressable>
                ))}
              </View>

              {tab === 'edit' ? (
                <>
              {/* Live site preview */}
              {siteUrl ? (
                <>
                  <ThemedText type="code" style={styles.sectionLabel}>YOUR SITE</ThemedText>
                  <Pressable onPress={() => { setPreviewTarget(siteUrl); setCritiquePreview(true); }} style={styles.previewFrame}>
                    {ogImageUrl ? (
                      <Image source={{ uri: ogImageUrl }} style={styles.previewImg} contentFit="cover" />
                    ) : (
                      <View style={[styles.previewImg, styles.previewFallback]}>
                        <ThemedText type="subtitle" style={styles.previewFallbackText} numberOfLines={2}>{brandName ?? activeStore?.name}</ThemedText>
                      </View>
                    )}
                    <View style={styles.previewTap}>
                      <ThemedText type="code" style={styles.previewTapText}>tap to explore your live site →</ThemedText>
                    </View>
                  </Pressable>
                </>
              ) : null}

              {/* Edit the site by chatting with Venus — a brand can also sell on the shop with no site */}
              {!siteUrl ? (
                <View style={styles.noSite}>
                  {siteAction === 'building' ? (
                    <>
                      <ThemedText type="code" style={styles.sectionLabel}>BUILDING YOUR SITE</ThemedText>
                      <ThemedText type="small" style={styles.dim}>Venus is building your storefront — this takes a few minutes. It’ll appear here when it’s ready.</ThemedText>
                    </>
                  ) : siteAction === 'importing' ? (
                    <>
                      <ThemedText type="code" style={styles.sectionLabel}>IMPORT A SITE</ThemedText>
                      <ThemedText type="small" style={styles.dim}>Already have a website? Connect it by URL and we’ll link your shop to it.</ThemedText>
                      <TextInput style={styles.input} placeholder="yourbrand.com" placeholderTextColor={pal.dim} value={importUrl} onChangeText={setImportUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
                      <View style={styles.row}>
                        <Pressable onPress={importSite} disabled={!importUrl.trim()} style={[styles.primaryBtn, !importUrl.trim() && { opacity: 0.5 }]}>
                          <ThemedText type="smallBold" style={{ color: pal.onAccent }}>Connect</ThemedText>
                        </Pressable>
                        <Pressable onPress={() => { setSiteAction('idle'); setNote(null); }} hitSlop={8}>
                          <ThemedText type="code" style={styles.dim}>cancel</ThemedText>
                        </Pressable>
                      </View>
                    </>
                  ) : (
                    <>
                      <ThemedText type="code" style={styles.sectionLabel}>NO WEBSITE YET</ThemedText>
                      <ThemedText type="small" style={styles.dim}>This brand sells on the Nanocrew shop. Give it a storefront:</ThemedText>
                      <View style={styles.row}>
                        <Pressable onPress={buildSite} style={styles.primaryBtn}>
                          <ThemedText type="smallBold" style={{ color: pal.onAccent }}>Build site</ThemedText>
                        </Pressable>
                        <Pressable onPress={() => { setSiteAction('importing'); setNote(null); }} style={styles.secondaryBtn}>
                          <ThemedText type="smallBold" style={styles.accentText}>Import site</ThemedText>
                        </Pressable>
                      </View>
                    </>
                  )}
                  {note && !draft ? <ThemedText type="small" style={styles.warn}>{note}</ThemedText> : null}
                </View>
              ) : (
                <>
                  <ThemedText type="code" style={[styles.sectionLabel, { marginTop: Spacing.three }]}>CHAT WITH VENUS</ThemedText>
                  <View style={styles.venusBubble}>
                    <ThemedText type="small" style={styles.bubbleVenusText}>Tell me what to change about your site — &ldquo;add a slideshow up top,&rdquo; &ldquo;make the buttons rounder.&rdquo; I build it on a preview first; nothing goes live until you approve.</ThemedText>
                  </View>

                  {revisions.slice(0, 8).reverse().map((rev) => (
                    <View key={rev.id}>
                      <View style={styles.youBubble}>
                        <ThemedText type="small" style={styles.bubbleYouText} numberOfLines={4}>{rev.requestMd}</ThemedText>
                      </View>
                      <View style={styles.venusBubble}>
                        <ThemedText type="small" style={styles.bubbleVenusText}>
                          {rev.status === 'building' ? 'On it — building a preview…' : rev.status === 'ready' ? 'Ready to review.' : rev.status === 'approved' ? 'Published — it’s live.' : 'That one didn’t take — try rewording it.'}
                        </ThemedText>
                        {rev.status === 'ready' ? (
                          <View style={styles.revActions}>
                            {rev.previewUrl ? (
                              <Pressable onPress={() => { setPreviewTarget(rev.previewUrl); setCritiquePreview(false); }} hitSlop={6}>
                                <ThemedText type="code" style={styles.dim}>review</ThemedText>
                              </Pressable>
                            ) : null}
                            <Pressable onPress={() => approve(rev)} hitSlop={6}>
                              <ThemedText type="code" style={styles.green}>publish →</ThemedText>
                            </Pressable>
                          </View>
                        ) : rev.status === 'building' ? (
                          <ActivityIndicator size="small" color={pal.accent} style={{ alignSelf: 'flex-start', marginTop: 4 }} />
                        ) : null}
                      </View>
                    </View>
                  ))}

                  <View style={styles.composerRow}>
                    <TextInput style={styles.composerInput} placeholder="Message Venus…" placeholderTextColor={pal.dim} value={change} onChangeText={(t) => { setChange(t); setChangeState('idle'); }} multiline />
                    <Pressable onPress={sendChange} disabled={changeState === 'sending' || !change.trim()} hitSlop={6} style={[styles.composerSend, (!change.trim() || changeState === 'sending') && { opacity: 0.4 }]}>
                      <ThemedText type="code" style={{ color: pal.onAccent }}>{changeState === 'sending' ? '…' : 'send'}</ThemedText>
                    </Pressable>
                  </View>
                  {changeState === 'queued' ? (
                    <ThemedText type="code" style={styles.green}>Sent — I’ll notify you when the preview’s ready.</ThemedText>
                  ) : null}
                </>
              )}
                </>
              ) : null}

              {/* Sell — turn a product photo into a feed-ready voiceover ad */}
              {tab === 'sell' ? (
                products.length ? (
                <>
                  <View style={[styles.sectionRow, { marginTop: Spacing.five }]}>
                    <ThemedText type="code" style={styles.sectionLabel}>VIDEO ADS</ThemedText>
                    {credits !== null ? (
                      <Pressable onPress={onOpenBilling} disabled={!onOpenBilling} hitSlop={6}>
                        <ThemedText type="code" style={styles.green}>{credits} credits{onOpenBilling ? ' +' : ''}</ThemedText>
                      </Pressable>
                    ) : null}
                  </View>
                  <ThemedText type="small" style={styles.dim}>Venus turns a product into a short video ad for the feed — {voiceoverCost} credits each.</ThemedText>
                  {note && !draft ? <ThemedText type="small" style={styles.warn}>{note}</ThemedText> : null}
                  {note && !draft && onOpenBilling && credits !== null && credits < voiceoverCost ? (
                    <Pressable onPress={onOpenBilling} style={styles.primaryBtn}>
                      <ThemedText type="smallBold" style={{ color: pal.onAccent }}>Top up credits</ThemedText>
                    </Pressable>
                  ) : null}
                  {products.map((p) => (
                    <View key={p.id} style={styles.adRow}>
                      {p.imageUrl ? (
                        <Image source={{ uri: p.imageUrl }} style={styles.adThumb} contentFit="cover" />
                      ) : (
                        <View style={[styles.adThumb, styles.adThumbEmpty]} />
                      )}
                      <View style={{ flex: 1 }}>
                        <ThemedText type="small" style={styles.white} numberOfLines={1}>{p.name}</ThemedText>
                        <ThemedText type="code" style={p.videoUrl ? styles.green : styles.dim}>
                          {p.videoUrl ? 'has a video ad' : 'no video ad yet'}
                        </ThemedText>
                      </View>
                      {genId === p.id ? (
                        <ActivityIndicator size="small" color={pal.accent} />
                      ) : (
                        <Pressable onPress={() => makeVideoAd(p)} disabled={!!genId} hitSlop={6} style={styles.adBtn}>
                          <ThemedText type="code" style={styles.adBtnText}>{p.videoUrl ? 'remake' : `create · ${voiceoverCost}`}</ThemedText>
                        </Pressable>
                      )}
                    </View>
                  ))}
                </>
                ) : (
                  <ThemedText type="small" style={styles.dim}>No products yet — create a drop in the Design tab to make video ads.</ThemedText>
                )
              ) : null}

              {/* Posts — the brand journal */}
              {tab === 'posts' ? (
                <>
              <Pressable onPress={() => { setDraft({ ...EMPTY }); setNote(null); }} style={styles.primaryBtn}>
                <ThemedText type="smallBold" style={{ color: pal.onAccent }}>Write a post</ThemedText>
              </Pressable>
              {note && !draft ? <ThemedText type="small" style={styles.warn}>{note}</ThemedText> : null}
              {posts.map((p) => (
                <View key={p.id} style={styles.postRow}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.postTitleRow}>
                      <ThemedText type="small" style={styles.white} numberOfLines={1}>{p.title}</ThemedText>
                      <View style={[styles.badge, p.isPublished && styles.badgeLive]}>
                        <ThemedText type="code" style={styles.badgeText}>{p.isPublished ? 'live' : 'draft'}</ThemedText>
                      </View>
                    </View>
                    <ThemedText type="code" style={styles.postExcerpt} numberOfLines={1}>{p.excerpt ?? '—'}</ThemedText>
                  </View>
                  <View style={styles.postActions}>
                    <Pressable onPress={() => setDraft({ id: p.id, title: p.title, excerpt: p.excerpt ?? '', bodyMd: p.bodyMd })} hitSlop={6}>
                      <ThemedText type="code" style={styles.dim}>edit</ThemedText>
                    </Pressable>
                    <Pressable onPress={() => mutatePost(p, 'PATCH', { publish: !p.isPublished })} hitSlop={6}>
                      <ThemedText type="code" style={styles.green}>{p.isPublished ? 'hide' : 'publish'}</ThemedText>
                    </Pressable>
                    <Pressable onPress={() => mutatePost(p, 'DELETE')} hitSlop={6}>
                      <ThemedText type="code" style={styles.warn}>del</ThemedText>
                    </Pressable>
                  </View>
                </View>
              ))}
              {!posts.length ? <ThemedText type="small" style={styles.dim}>No posts yet.</ThemedText> : null}
                </>
              ) : null}

              {/* Insights — this brand's analytics + earnings */}
              {tab === 'insights' ? (
                <>
                  <View style={styles.metricRow}>
                    <View style={styles.metric}>
                      <ThemedText type="code" style={styles.metricLabel}>REVENUE</ThemedText>
                      <ThemedText type="subtitle" style={styles.metricBig}>${((insights?.revenueCents ?? 0) / 100).toFixed(2)}</ThemedText>
                    </View>
                    <View style={styles.metric}>
                      <ThemedText type="code" style={styles.metricLabel}>ORDERS</ThemedText>
                      <ThemedText type="subtitle" style={styles.metricBig}>{insights?.orders ?? 0}</ThemedText>
                    </View>
                  </View>
                  <View style={styles.metricRow}>
                    <View style={styles.metric}>
                      <ThemedText type="code" style={styles.metricLabel}>VIEWS · 30D</ThemedText>
                      <ThemedText type="subtitle" style={styles.metricBig}>{(insights?.views30d ?? 0).toLocaleString()}</ThemedText>
                    </View>
                    <View style={styles.metric}>
                      <ThemedText type="code" style={styles.metricLabel}>AVG MARGIN</ThemedText>
                      <ThemedText type="subtitle" style={styles.metricBig}>{insights?.avgMarginPct != null ? `${insights.avgMarginPct}%` : '—'}</ThemedText>
                    </View>
                  </View>

                  {insights?.margins.length ? (
                    <>
                      <ThemedText type="code" style={[styles.sectionLabel, { marginTop: Spacing.four }]}>PRODUCT MARGINS</ThemedText>
                      {insights.margins.map((m) => (
                        <View key={m.productId} style={styles.revRow}>
                          <ThemedText type="small" style={[styles.white, { flex: 1 }]} numberOfLines={1}>{m.name}</ThemedText>
                          {m.marginCents != null ? (
                            <ThemedText type="small" style={styles.green}>${(m.marginCents / 100).toFixed(2)} · {m.marginPct}%</ThemedText>
                          ) : (
                            <ThemedText type="code" style={styles.dim}>cost n/a</ThemedText>
                          )}
                        </View>
                      ))}
                    </>
                  ) : null}

                  {orders.length ? (
                    <>
                      <ThemedText type="code" style={[styles.sectionLabel, { marginTop: Spacing.four }]}>RECENT ORDERS</ThemedText>
                      {orders.map((o) => (
                        <View key={o.id} style={styles.revRow}>
                          <ThemedText type="small" style={[styles.white, { flex: 1 }]}>${(o.totalCents / 100).toFixed(2)}</ThemedText>
                          <ThemedText type="code" style={styles.dim}>{o.status.replace(/_/g, ' ')}</ThemedText>
                        </View>
                      ))}
                    </>
                  ) : (
                    <ThemedText type="small" style={[styles.dim, { marginTop: Spacing.three }]}>No orders yet — share your store to make the first sale.</ThemedText>
                  )}
                </>
              ) : null}
            </ScrollView>
          )}
        </View>
      </SafeAreaView>
      {previewTarget ? (
        <SitePreview
          visible={!!previewTarget}
          url={previewTarget}
          onClose={() => setPreviewTarget(null)}
          critique={critiquePreview && active ? { slug: active, token, onSent: () => { void loadRevisions(); } } : undefined}
        />
      ) : null}
    </Modal>
  );
}

function makeStyles(pal: StudioPalette) {
  const onAccentInk = pal.onAccent;
  return StyleSheet.create({
    fill: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
    sheet: { flex: 1, marginTop: Spacing.six, backgroundColor: pal.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: pal.line, overflow: 'hidden' },
    headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.four, paddingVertical: Spacing.four },
    eyebrow: { color: pal.accent, letterSpacing: 2 },
    consoleTitle: { color: pal.ink, fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }), maxWidth: 220 },
    tabBar: { flexDirection: 'row', gap: Spacing.one, marginBottom: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: pal.line },
    tabItem: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderBottomWidth: 2, borderBottomColor: 'transparent' },
    tabItemOn: { borderBottomColor: pal.accent },
    tabText: { color: pal.dim, fontSize: 11, letterSpacing: 0.5 },
    tabTextOn: { color: pal.accent, fontSize: 11, letterSpacing: 0.5 },
    metricRow: { flexDirection: 'row', gap: Spacing.three },
    metric: { flex: 1, backgroundColor: pal.card, borderWidth: 1, borderColor: pal.line, borderRadius: 14, padding: Spacing.four, gap: Spacing.one, marginBottom: Spacing.three },
    metricLabel: { color: pal.dim, fontSize: 10, letterSpacing: 1.5 },
    metricBig: { color: pal.ink, fontSize: 24 },
    venusBubble: { alignSelf: 'flex-start', maxWidth: '88%', backgroundColor: pal.card, borderWidth: 1, borderColor: pal.line, borderRadius: 14, borderTopLeftRadius: 4, padding: Spacing.three, marginTop: Spacing.two, gap: Spacing.one },
    youBubble: { alignSelf: 'flex-end', maxWidth: '88%', backgroundColor: pal.accent, borderRadius: 14, borderTopRightRadius: 4, padding: Spacing.three, marginTop: Spacing.two },
    bubbleVenusText: { color: pal.ink },
    bubbleYouText: { color: pal.onAccent },
    composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two, marginTop: Spacing.three },
    composerInput: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderColor: pal.line, backgroundColor: pal.field, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, color: pal.ink, fontSize: 15, textAlignVertical: 'top' },
    composerSend: { backgroundColor: pal.accent, borderRadius: 999, paddingHorizontal: Spacing.four, paddingVertical: Spacing.three, alignItems: 'center', justifyContent: 'center' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.six },
    scroll: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginBottom: Spacing.two },
    pill: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: 999, borderWidth: 1, borderColor: pal.line },
    pillOn: { backgroundColor: pal.accent, borderColor: pal.accent },
    sectionLabel: { color: pal.accent, letterSpacing: 1.5, fontSize: 11 },
    noSite: { gap: Spacing.two, padding: Spacing.three, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: pal.line },
    sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    adRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: pal.line },
    adThumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: pal.surface },
    adThumbEmpty: { borderWidth: 1, borderColor: pal.line },
    adBtn: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: 999, borderWidth: 1, borderColor: pal.line },
    adBtnText: { color: pal.accent, fontSize: 11, letterSpacing: 0.5 },
    previewFrame: { height: 200, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: pal.line, backgroundColor: pal.surface },
    previewImg: { flex: 1 },
    previewFallback: { alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
    previewFallbackText: { color: pal.ink, textAlign: 'center' },
    previewTap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: Spacing.two, alignItems: 'center', backgroundColor: 'rgba(6,11,22,0.82)' },
    previewTapText: { color: pal.accent, fontSize: 11, letterSpacing: 0.5 },
    revRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: pal.line },
    revStatus: { color: pal.dim, fontSize: 11, marginTop: 2 },
    revActions: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center' },
    input: { borderWidth: 1, borderColor: pal.line, backgroundColor: pal.field, borderRadius: 10, padding: Spacing.three, color: pal.ink, fontSize: 15 },
    body: { minHeight: 220, textAlignVertical: 'top' },
    change: { minHeight: 90, textAlignVertical: 'top' },
    row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four, marginTop: Spacing.one },
    primaryBtn: { backgroundColor: pal.accent, borderRadius: 10, paddingVertical: Spacing.three, paddingHorizontal: Spacing.four, alignItems: 'center', marginTop: Spacing.one },
    secondaryBtn: { borderWidth: 1, borderColor: pal.accent, borderRadius: 10, paddingVertical: Spacing.three, paddingHorizontal: Spacing.four, alignItems: 'center', marginTop: Spacing.one },
    accentText: { color: pal.accent },
    postRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: pal.line },
    postTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
    postExcerpt: { color: pal.dim, fontSize: 11, marginTop: 2 },
    postActions: { flexDirection: 'row', gap: Spacing.three },
    badge: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: 999, backgroundColor: pal.card },
    badgeLive: { backgroundColor: pal.dark ? 'rgba(53,214,255,0.18)' : 'rgba(14,159,206,0.16)' },
    badgeText: { color: pal.ink, fontSize: 9, letterSpacing: 0.5 },
    white: { color: pal.ink },
    dim: { color: pal.dim },
    green: { color: pal.accent },
    warn: { color: pal.warn },
    onAccent: { color: onAccentInk },
  });
}
