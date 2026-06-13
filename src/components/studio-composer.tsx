import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Image } from 'expo-image';

import { SitePreview } from '@/components/site-preview';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { apiUrl } from '@/lib/api';
import { type StudioPalette, useStudioPalette } from '@/lib/studio-palette';

// Venus's management surface for a returning creator: request site changes in plain
// words (→ forge revision) and write journal posts. Calls the same creator endpoints
// the brand-site /admin uses. Opens from the Studio header. Theme-aware.

type StoreRow = { slug: string; name: string; deploymentUrl?: string | null };

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

export function StudioComposer({ visible, onClose, token, onOpenBilling }: { visible: boolean; onClose: () => void; token: string; onOpenBilling?: () => void }) {
  const pal = useStudioPalette();
  const styles = useMemo(() => makeStyles(pal), [pal]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [change, setChange] = useState('');
  const [changeState, setChangeState] = useState<'idle' | 'sending' | 'queued'>('idle');
  const [previewTarget, setPreviewTarget] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [credits, setCredits] = useState<number | null>(null);
  const [voiceoverCost, setVoiceoverCost] = useState(25);
  const [genId, setGenId] = useState<string | null>(null); // product currently generating an ad
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const siteUrl = siteUrlFor(stores.find((s) => s.slug === active));

  const loadStores = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(apiUrl('/api/creator/stats'), { headers: { Authorization: `Bearer ${token}` } });
      const d = (await r.json()) as { stores?: StoreRow[] };
      setStores(d.stores ?? []);
      setActive((a) => a ?? d.stores?.[0]?.slug ?? null);
    } catch {
      setNote('Could not reach your store.');
    } finally {
      setLoading(false);
    }
  }, [token]);

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
    if (visible) {
      void loadStores();
      void loadCredits();
    }
  }, [visible, loadStores, loadCredits]);
  useEffect(() => {
    if (visible && active) {
      void loadPosts();
      void loadRevisions();
      void loadProducts();
    }
  }, [visible, active, loadPosts, loadRevisions, loadProducts]);

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
            <ThemedText type="code" style={styles.eyebrow}>
              {draft ? '// WRITE A POST' : '// MANAGE YOUR STORE'}
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
              {stores.length > 1 ? (
                <View style={styles.pills}>
                  {stores.map((s) => (
                    <Pressable key={s.slug} onPress={() => setActive(s.slug)} style={[styles.pill, active === s.slug && styles.pillOn]}>
                      <ThemedText type="code" style={active === s.slug ? { color: pal.onAccent } : styles.dim}>{s.name}</ThemedText>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {/* Live site preview */}
              {siteUrl ? (
                <>
                  <ThemedText type="code" style={styles.sectionLabel}>YOUR SITE</ThemedText>
                  <Pressable onPress={() => setPreviewTarget(siteUrl)} style={styles.previewFrame}>
                    <WebView source={{ uri: siteUrl }} style={styles.previewWeb} pointerEvents="none" scrollEnabled={false} />
                    <View style={styles.previewTap}>
                      <ThemedText type="code" style={styles.previewTapText}>tap to explore your live site →</ThemedText>
                    </View>
                  </Pressable>
                </>
              ) : null}

              {/* Site changes — only when a website exists; a brand can sell on the Nanocrew shop alone */}
              {!siteUrl ? (
                <View style={styles.noSite}>
                  <ThemedText type="code" style={styles.sectionLabel}>NO WEBSITE YET</ThemedText>
                  <ThemedText type="small" style={styles.dim}>
                    This brand sells on the Nanocrew shop. Launch a website any time to get a
                    storefront you can customize.
                  </ThemedText>
                </View>
              ) : (
                <>
                  <ThemedText type="code" style={styles.sectionLabel}>IMPROVE YOUR SITE</ThemedText>
                  <ThemedText type="small" style={styles.dim}>Describe a change in your own words — &ldquo;add a slideshow up top,&rdquo; &ldquo;make the buttons rounder.&rdquo; Venus builds it on a preview first; nothing goes live until you approve.</ThemedText>
                  <TextInput style={[styles.input, styles.change]} placeholder="What would you like to change?" placeholderTextColor={pal.dim} value={change} onChangeText={(t) => { setChange(t); setChangeState('idle'); }} multiline />
                  {changeState === 'queued' ? (
                    <ThemedText type="small" style={styles.green}>On it — Venus is building a preview. We&rsquo;ll notify you when it&rsquo;s ready to review below.</ThemedText>
                  ) : (
                    <Pressable onPress={sendChange} disabled={changeState === 'sending' || !change.trim()} style={[styles.primaryBtn, (!change.trim() || changeState === 'sending') && { opacity: 0.5 }]}>
                      <ThemedText type="smallBold" style={{ color: pal.onAccent }}>{changeState === 'sending' ? 'Sending…' : 'Send to Venus'}</ThemedText>
                    </Pressable>
                  )}
                </>
              )}

              {/* Changes in review */}
              {siteUrl && revisions.length ? (
                <>
                  <ThemedText type="code" style={[styles.sectionLabel, { marginTop: Spacing.four }]}>CHANGES IN REVIEW</ThemedText>
                  {revisions.slice(0, 6).map((rev) => (
                    <View key={rev.id} style={styles.revRow}>
                      <View style={{ flex: 1 }}>
                        <ThemedText type="small" style={styles.white} numberOfLines={2}>{rev.requestMd}</ThemedText>
                        <ThemedText type="code" style={styles.revStatus}>
                          {rev.status === 'building' ? 'preparing a preview…' : rev.status === 'ready' ? 'ready to review' : rev.status === 'approved' ? 'published' : 'needs another try'}
                        </ThemedText>
                      </View>
                      {rev.status === 'ready' ? (
                        <View style={styles.revActions}>
                          {rev.previewUrl ? (
                            <Pressable onPress={() => setPreviewTarget(rev.previewUrl)} hitSlop={6}>
                              <ThemedText type="code" style={styles.dim}>review</ThemedText>
                            </Pressable>
                          ) : null}
                          <Pressable onPress={() => approve(rev)} hitSlop={6}>
                            <ThemedText type="code" style={styles.green}>publish</ThemedText>
                          </Pressable>
                        </View>
                      ) : rev.status === 'building' ? (
                        <ActivityIndicator size="small" color={pal.accent} />
                      ) : null}
                    </View>
                  ))}
                </>
              ) : null}

              {/* Video ads — turn a product photo into a feed-ready voiceover ad */}
              {products.length ? (
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
              ) : null}

              {/* Journal */}
              <ThemedText type="code" style={[styles.sectionLabel, { marginTop: Spacing.five }]}>JOURNAL</ThemedText>
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
            </ScrollView>
          )}
        </View>
      </SafeAreaView>
      {previewTarget ? <SitePreview visible={!!previewTarget} url={previewTarget} onClose={() => setPreviewTarget(null)} /> : null}
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
    previewFrame: { height: 240, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: pal.line, backgroundColor: '#fff' },
    previewWeb: { flex: 1, opacity: 0.99 },
    previewTap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: Spacing.two, alignItems: 'center', backgroundColor: 'rgba(6,11,22,0.82)' },
    previewTapText: { color: pal.accent, fontSize: 11, letterSpacing: 0.5 },
    revRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: pal.line },
    revStatus: { color: pal.dim, fontSize: 11, marginTop: 2 },
    revActions: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center' },
    input: { borderWidth: 1, borderColor: pal.line, backgroundColor: pal.field, borderRadius: 10, padding: Spacing.three, color: pal.ink, fontSize: 15 },
    body: { minHeight: 220, textAlignVertical: 'top' },
    change: { minHeight: 90, textAlignVertical: 'top' },
    row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four, marginTop: Spacing.one },
    primaryBtn: { backgroundColor: pal.accent, borderRadius: 10, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.one },
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
