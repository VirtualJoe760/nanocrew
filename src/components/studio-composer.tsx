import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';

import { GoLiveComposer } from '@/components/go-live-composer';
import { SceneShortComposer } from '@/components/scene-short-composer';
import { SiteEditor } from '@/components/site-editor';
import { SitePreview } from '@/components/site-preview';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { apiUrl } from '@/lib/api';
import { type StudioPalette, useStudioPalette } from '@/lib/studio-palette';

// Venus's management surface for a returning creator: request site changes in plain
// words (→ forge revision) and write journal posts. Calls the same creator endpoints
// the brand-site /admin uses. Opens from the Studio header. Theme-aware.

type StoreRow = { slug: string; name: string; deploymentUrl?: string | null; ogImageUrl?: string | null; status?: string; customDomain?: string | null };

/** The public storefront URL — only when a real site is deployed. A brand can live on
 *  the Nano Crew shop with no website, so we never fabricate a URL that would 404. */
function siteUrlFor(s: StoreRow | undefined): string | null {
  if (!s?.deploymentUrl || s.deploymentUrl.includes('github.com')) return null;
  return s.deploymentUrl;
}
type Post = { id: string; slug: string; title: string; excerpt: string | null; bodyMd: string; coverImageUrl?: string | null; isPublished: boolean };
type Revision = { id: string; requestMd: string; status: 'building' | 'ready' | 'approved' | 'failed'; previewUrl: string | null };
type Product = { id: string; name: string; imageUrl: string | null; videoUrl: string | null; modelShots?: string[] | null; modelVideos?: string[] | null; isPublished: boolean };
type Draft = { id?: string; title: string; excerpt: string; bodyMd: string; coverImageUrl?: string | null };
const EMPTY: Draft = { title: '', excerpt: '', bodyMd: '', coverImageUrl: null };

type Insights = { revenueCents: number; orders: number; views30d: number; avgMarginPct: number | null; margins: MarginRow[] };
type MarginRow = { productId: string; name: string; retailCents: number | null; costCents: number | null; marginCents: number | null; marginPct: number | null };
type OrderRow = { id: string; status: string; totalCents: number; createdAt: string; storeSlug?: string };
// Order statuses a creator can still refund (matches the server's REFUNDABLE list).
const REFUNDABLE_STATUSES = new Set(['paid', 'submitted_to_printful', 'in_production', 'shipped', 'delivered', 'on_hold', 'returned']);

type ConsoleTab = 'edit' | 'posts' | 'sell' | 'settings';
const TAB_LABEL: Record<ConsoleTab, string> = { edit: 'Edit site', posts: 'Posts', sell: 'Sell', settings: 'Settings' };

export function StudioComposer({ visible, onClose, token, onOpenBilling, onDeleted, slug, brandName }: { visible: boolean; onClose: () => void; token: string; onOpenBilling?: () => void; onDeleted?: () => void; slug?: string; brandName?: string }) {
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
  const [siteAction, setSiteAction] = useState<'idle' | 'building'>('idle');
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [credits, setCredits] = useState<number | null>(null);
  const [voiceoverCost, setVoiceoverCost] = useState(25);
  const [veoCost, setVeoCost] = useState(400);
  const [genId, setGenId] = useState<string | null>(null); // product currently generating an ad
  const [refundingId, setRefundingId] = useState<string | null>(null); // order currently being refunded
  const [shortComposer, setShortComposer] = useState(false); // the "make a scene short" flow
  const [goLive, setGoLive] = useState(false); // the domain / go-live flow
  const [editor, setEditor] = useState(false); // the mini-CMS: text / colors / fonts (direct, instant)
  const [deleting, setDeleting] = useState(false); // brand deletion in flight
  const [uploading, setUploading] = useState(false); // post cover image upload in flight
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
      const d = (await r.json()) as { balance?: number; costs?: { video_voiceover?: number; video_veo?: number } };
      if (typeof d.balance === 'number') setCredits(d.balance);
      if (typeof d.costs?.video_voiceover === 'number') setVoiceoverCost(d.costs.video_voiceover);
      if (typeof d.costs?.video_veo === 'number') setVeoCost(d.costs.video_veo);
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

  const makeModelShots = async (p: Product) => {
    if (genId) return;
    setGenId(p.id);
    setNote(null);
    try {
      const res = await fetch(apiUrl('/api/creator/model-shots'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ productId: p.id }),
      });
      const d = (await res.json()) as { modelShots?: string[]; error?: string; needed?: number; balance?: number };
      if (res.status === 402) {
        setCredits(d.balance ?? credits);
        setNote(`Not enough credits — on-model shots cost ${d.needed ?? 20}.`);
        return;
      }
      if (!res.ok || !d.modelShots?.length) throw new Error(d.error ?? 'failed');
      await Promise.all([loadProducts(), loadCredits()]);
    } catch {
      setNote('Could not make on-model shots — your credits were not charged.');
    } finally {
      setGenId(null);
    }
  };

  const makeModelVideo = async (p: Product) => {
    if (genId) return;
    if (credits !== null && credits < veoCost) {
      setNote(`You need ${veoCost} credits for an on-model video — you have ${credits}.`);
      return;
    }
    setGenId(p.id);
    setNote('Filming your on-model video — this takes a few minutes.');
    try {
      const res = await fetch(apiUrl('/api/creator/model-videos'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ productId: p.id }),
      });
      const d = (await res.json()) as { modelVideos?: string[]; error?: string; needed?: number; balance?: number };
      if (res.status === 402) {
        setCredits(d.balance ?? credits);
        setNote(`Not enough credits — an on-model video costs ${d.needed ?? veoCost}.`);
        return;
      }
      if (res.status === 429) {
        setNote('Slow down a moment — on-model videos are rate-limited. Try again shortly.');
        return;
      }
      if (!res.ok || !d.modelVideos?.length) throw new Error(d.error ?? 'failed');
      setNote(null);
      await Promise.all([loadProducts(), loadCredits()]);
    } catch {
      setNote('Could not make the on-model video — your credits were not charged.');
    } finally {
      setGenId(null);
    }
  };

  // Delete a product everywhere: our catalog, the storefront website (it refreshes within
  // ~5 min via ISR), and the Printful store. Cannot be undone.
  const deleteProduct = (p: Product) => {
    Alert.alert(
      'Delete product?',
      `"${p.name}" will be removed from your store, your storefront website, and Printful. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const r = await fetch(apiUrl(`/api/creator/products/${p.id}`), {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!r.ok) {
                const e = (await r.json().catch(() => ({}))) as { error?: string };
                throw new Error(e.error ?? 'Failed to delete');
              }
              setProducts((prev) => prev.filter((x) => x.id !== p.id));
            } catch (e) {
              Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.');
            }
          },
        },
      ],
    );
  };

  useEffect(() => {
    if (slug) setActive(slug);
  }, [slug]);
  useEffect(() => {
    if (visible) {
      setTab('edit');
      setSiteAction('idle');
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

  const refundOrder = async (id: string) => {
    setRefundingId(id);
    setNote(null);
    try {
      const res = await fetch(apiUrl(`/api/creator/orders/${id}/refund`), { method: 'POST', headers });
      const d = (await res.json()) as { status?: string; error?: string };
      if (!res.ok) { setNote(d.error ?? 'Refund failed.'); return; }
      await loadInsights();
    } catch {
      setNote('Refund failed — try again.');
    } finally {
      setRefundingId(null);
    }
  };

  const confirmRefund = (id: string) =>
    Alert.alert('Refund order?', 'The customer is paid back in full and any transfer is reversed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Refund', style: 'destructive', onPress: () => void refundOrder(id) },
    ]);

  // Permanently delete this brand — its store, products, designs, posts, orders, and site records.
  const deleteBrand = async () => {
    if (!active) return;
    setDeleting(true);
    setNote(null);
    try {
      const res = await fetch(apiUrl(`/api/creator/stores/${encodeURIComponent(active)}`), { method: 'DELETE', headers });
      if (!res.ok) throw new Error();
      onDeleted?.();
      onClose();
    } catch {
      setNote('Could not delete this brand — try again.');
    } finally {
      setDeleting(false);
    }
  };

  const confirmDeleteBrand = () => {
    const name = brandName ?? activeStore?.name ?? 'this brand';
    Alert.alert(
      `Delete ${name}?`,
      'This permanently deletes the brand — its store, products, designs, posts, and sales records. The live website stops serving. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete brand', style: 'destructive', onPress: () => void deleteBrand() },
      ],
    );
  };

  const buildSite = async () => {
    if (!active) return;
    setSiteAction('building');
    setNote(null);
    try {
      const res = await fetch(apiUrl('/api/creator/build-site'), { method: 'POST', headers, body: JSON.stringify({ storeSlug: active }) });
      if (res.status === 402) {
        setSiteAction('idle');
        setNote('A website is a Pro feature — upgrade your plan to add one.');
        return;
      }
      if (!res.ok) throw new Error();
      setNote('Building your site — Venus will have it ready shortly. Check back in a few minutes.');
    } catch {
      setNote('Could not start building your site.');
      setSiteAction('idle');
    }
  };

  const pickCover = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.85 });
    const a = res.assets?.[0];
    if (res.canceled || !a?.base64) return;
    const dataUrl = `data:${a.mimeType ?? 'image/jpeg'};base64,${a.base64}`;
    setUploading(true);
    setNote(null);
    try {
      const r = await fetch(apiUrl('/api/creator/upload'), { method: 'POST', headers, body: JSON.stringify({ dataUrl }) });
      const d = (await r.json()) as { url?: string };
      if (d.url) setDraft((dr) => (dr ? { ...dr, coverImageUrl: d.url } : dr));
      else setNote('Could not upload the image.');
    } catch {
      setNote('Could not upload the image.');
    } finally {
      setUploading(false);
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
      const body = JSON.stringify({ storeSlug: active, title: draft.title, excerpt: draft.excerpt, bodyMd: draft.bodyMd, coverImageUrl: draft.coverImageUrl ?? null, publish });
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
              {draft.coverImageUrl ? (
                <Pressable onPress={pickCover} disabled={uploading}>
                  <Image source={{ uri: draft.coverImageUrl }} style={styles.coverImg} contentFit="cover" />
                </Pressable>
              ) : (
                <Pressable onPress={pickCover} disabled={uploading} style={styles.coverPick}>
                  <ThemedText type="code" style={styles.dim}>{uploading ? 'uploading…' : '+ add cover image'}</ThemedText>
                </Pressable>
              )}
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
                {(['edit', 'posts', 'sell', 'settings'] as const).map((t) => (
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
                  ) : (
                    <>
                      <ThemedText type="code" style={styles.sectionLabel}>NO WEBSITE YET</ThemedText>
                      <ThemedText type="small" style={styles.dim}>This brand sells on the Nano Crew shop. Give it a storefront:</ThemedText>
                      <Pressable onPress={buildSite} style={styles.primaryBtn}>
                        <ThemedText type="smallBold" style={{ color: pal.onAccent }}>Build site</ThemedText>
                      </Pressable>
                    </>
                  )}
                  {note && !draft ? <ThemedText type="small" style={styles.warn}>{note}</ThemedText> : null}
                </View>
              ) : (
                <>
                  <Pressable onPress={() => setEditor(true)} style={styles.primaryBtn}>
                    <ThemedText type="smallBold" style={{ color: pal.onAccent }}>✦ Customize — text, colors &amp; fonts</ThemedText>
                  </Pressable>
                  <ThemedText type="code" style={styles.dim}>Exact edits, applied instantly. For a bigger redesign, ask Venus below.</ThemedText>

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
                  <ThemedText type="small" style={styles.dim}>Venus turns a product into a feed video ad ({voiceoverCost}), on-model shots (20), or an on-model film for your website ({veoCost}).</ThemedText>
                  <Pressable onPress={() => setShortComposer(true)} style={styles.primaryBtn}>
                    <ThemedText type="smallBold" style={{ color: pal.onAccent }}>✦ Make a scene short</ThemedText>
                  </Pressable>
                  <ThemedText type="code" style={styles.dim}>Put a model in a real scene — skateboarding, on a beach — and pick the quality: Wan, Seedance or Veo 3.</ThemedText>
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
                        <ThemedText type="code" style={styles.dim}>
                          {p.videoUrl ? 'video ad ✓' : 'no video'} · {p.modelShots?.length ? `${p.modelShots.length} shots ✓` : 'no shots'} · {p.modelVideos?.length ? `${p.modelVideos.length} films ✓` : 'no film'}
                        </ThemedText>
                      </View>
                      {genId === p.id ? (
                        <ActivityIndicator size="small" color={pal.accent} />
                      ) : (
                        <View style={styles.adActions}>
                          <Pressable onPress={() => makeModelShots(p)} disabled={!!genId} hitSlop={6} style={styles.adBtn}>
                            <ThemedText type="code" style={styles.adBtnText}>{p.modelShots?.length ? 'shots ↻' : 'shots · 20'}</ThemedText>
                          </Pressable>
                          <Pressable onPress={() => makeModelVideo(p)} disabled={!!genId} hitSlop={6} style={styles.adBtn}>
                            <ThemedText type="code" style={styles.adBtnText}>{p.modelVideos?.length ? `film ↻ · ${veoCost}` : `film · ${veoCost}`}</ThemedText>
                          </Pressable>
                          <Pressable onPress={() => makeVideoAd(p)} disabled={!!genId} hitSlop={6} style={styles.adBtn}>
                            <ThemedText type="code" style={styles.adBtnText}>{p.videoUrl ? 'video ↻' : `video · ${voiceoverCost}`}</ThemedText>
                          </Pressable>
                          <Pressable onPress={() => deleteProduct(p)} disabled={!!genId} hitSlop={6} style={styles.adBtn}>
                            <ThemedText type="code" style={styles.adBtnDanger}>delete</ThemedText>
                          </Pressable>
                        </View>
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
                    <Pressable onPress={() => setDraft({ id: p.id, title: p.title, excerpt: p.excerpt ?? '', bodyMd: p.bodyMd, coverImageUrl: p.coverImageUrl ?? null })} hitSlop={6}>
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

              {/* Settings — domain, this brand's performance, and the danger zone */}
              {tab === 'settings' ? (
                <>
                  {/* Custom domain / go live */}
                  <ThemedText type="code" style={styles.sectionLabel}>DOMAIN</ThemedText>
                  {siteUrl ? (
                    <Pressable onPress={() => setGoLive(true)} style={styles.settingRow}>
                      <View style={{ flex: 1 }}>
                        <ThemedText type="smallBold" style={styles.white}>
                          {activeStore?.customDomain ? 'Custom domain' : 'Assign a custom domain'}
                        </ThemedText>
                        <ThemedText type="code" style={styles.dim}>
                          {activeStore?.customDomain ? `● Live · ${activeStore.customDomain}` : 'Connect your own domain & go live'}
                        </ThemedText>
                      </View>
                      <ThemedText type="code" style={styles.green}>{activeStore?.customDomain ? 'manage →' : 'set up →'}</ThemedText>
                    </Pressable>
                  ) : (
                    <ThemedText type="small" style={styles.dim}>Build a website first (in Edit site) to assign a domain.</ThemedText>
                  )}

                  {/* Performance */}
                  <ThemedText type="code" style={[styles.sectionLabel, { marginTop: Spacing.four }]}>PERFORMANCE</ThemedText>
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
                          {REFUNDABLE_STATUSES.has(o.status) ? (
                            refundingId === o.id ? (
                              <ActivityIndicator size="small" color={pal.accent} />
                            ) : (
                              <Pressable onPress={() => confirmRefund(o.id)} hitSlop={6}>
                                <ThemedText type="code" style={styles.warn}>refund</ThemedText>
                              </Pressable>
                            )
                          ) : null}
                        </View>
                      ))}
                    </>
                  ) : (
                    <ThemedText type="small" style={[styles.dim, { marginTop: Spacing.three }]}>No orders yet — share your store to make the first sale.</ThemedText>
                  )}

                  {/* Danger zone */}
                  <ThemedText type="code" style={[styles.sectionLabel, styles.dangerLabel, { marginTop: Spacing.five }]}>DANGER ZONE</ThemedText>
                  <Pressable onPress={confirmDeleteBrand} disabled={deleting} style={[styles.deleteBrandBtn, deleting && { opacity: 0.5 }]}>
                    <ThemedText type="smallBold" style={styles.deleteBrandText}>{deleting ? 'Deleting…' : 'Delete this brand'}</ThemedText>
                  </Pressable>
                  <ThemedText type="code" style={styles.dim}>
                    Permanently removes the brand — its store, products, designs, posts, and sales records. The live site stops serving. This can&apos;t be undone.
                  </ThemedText>
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
      {shortComposer && active ? (
        <SceneShortComposer
          visible={shortComposer}
          onClose={() => setShortComposer(false)}
          token={token}
          slug={active}
          onPublished={() => { void loadProducts(); void loadCredits(); }}
        />
      ) : null}
      {goLive && active ? (
        <GoLiveComposer
          visible={goLive}
          onClose={() => setGoLive(false)}
          token={token}
          slug={active}
          onLive={() => { void loadStores(); }}
        />
      ) : null}
      {editor && active ? (
        <SiteEditor visible={editor} onClose={() => setEditor(false)} token={token} slug={active} />
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
    coverImg: { width: '100%', height: 160, borderRadius: 12, marginBottom: Spacing.two },
    coverPick: { height: 72, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: pal.line, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.two },
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
    adActions: { gap: Spacing.one, alignItems: 'flex-end' },
    adBtn: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: 999, borderWidth: 1, borderColor: pal.line },
    adBtnText: { color: pal.accent, fontSize: 11, letterSpacing: 0.5 },
    adBtnDanger: { color: '#e24b4a', fontSize: 11, letterSpacing: 0.5 },
    previewFrame: { height: 200, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: pal.line, backgroundColor: pal.surface },
    previewImg: { flex: 1 },
    previewFallback: { alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
    previewFallbackText: { color: pal.ink, textAlign: 'center' },
    previewTap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: Spacing.two, alignItems: 'center', backgroundColor: 'rgba(6,11,22,0.82)' },
    previewTapText: { color: pal.accent, fontSize: 11, letterSpacing: 0.5 },
    goLiveRow: { paddingVertical: Spacing.two, alignItems: 'center' },
    settingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: pal.line },
    dangerLabel: { color: '#e24b4a' },
    deleteBrandBtn: { borderWidth: 1, borderColor: 'rgba(226,75,74,0.5)', borderRadius: 10, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.two },
    deleteBrandText: { color: '#e24b4a' },
    revRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: pal.line },
    revStatus: { color: pal.dim, fontSize: 11, marginTop: 2 },
    revActions: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center' },
    input: { borderWidth: 1, borderColor: pal.line, backgroundColor: pal.field, borderRadius: 10, padding: Spacing.three, color: pal.ink, fontSize: 15 },
    body: { minHeight: 220, textAlignVertical: 'top' },
    change: { minHeight: 90, textAlignVertical: 'top' },
    row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four, marginTop: Spacing.one },
    primaryBtn: { backgroundColor: pal.accent, borderRadius: 10, paddingVertical: Spacing.three, paddingHorizontal: Spacing.four, alignItems: 'center', marginTop: Spacing.one },
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
