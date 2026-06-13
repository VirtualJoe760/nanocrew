import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { SitePreview } from '@/components/site-preview';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { apiUrl } from '@/lib/api';

// Venus's management surface for a returning creator: request site changes in plain
// words (→ forge revision) and write journal posts. Calls the same creator endpoints
// the brand-site /admin uses. Opens from the Studio header.

const BG = '#04140c';
const GREEN = '#00ff7f';
const DIM = 'rgba(220,255,235,0.55)';
const FIELD = 'rgba(0,255,127,0.06)';

type StoreRow = { slug: string; name: string; deploymentUrl?: string | null };

/** The public storefront URL — the deployment when known, else the default subdomain. */
function siteUrlFor(s: StoreRow | undefined): string | null {
  if (!s) return null;
  if (s.deploymentUrl && !s.deploymentUrl.includes('github.com')) return s.deploymentUrl;
  return `https://store-${s.slug}.vercel.app`;
}
type Post = { id: string; slug: string; title: string; excerpt: string | null; bodyMd: string; isPublished: boolean };
type Draft = { id?: string; title: string; excerpt: string; bodyMd: string };
const EMPTY: Draft = { title: '', excerpt: '', bodyMd: '' };

export function StudioComposer({ visible, onClose, token }: { visible: boolean; onClose: () => void; token: string }) {
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [change, setChange] = useState('');
  const [changeState, setChangeState] = useState<'idle' | 'sending' | 'queued'>('idle');
  const [showPreview, setShowPreview] = useState(false);
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

  useEffect(() => {
    if (visible) void loadStores();
  }, [visible, loadStores]);
  useEffect(() => {
    if (visible && active) void loadPosts();
  }, [visible, active, loadPosts]);

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
      const res = await fetch(apiUrl('/api/creator/revise'), { method: 'POST', headers, body: JSON.stringify({ storeSlug: active, request: change.trim() }) });
      if (!res.ok) throw new Error();
      setChange('');
      setChangeState('queued');
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
            <ActivityIndicator style={styles.center} color={GREEN} />
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
              <TextInput style={styles.input} placeholder="Post title" placeholderTextColor={DIM} value={draft.title} onChangeText={(t) => setDraft({ ...draft, title: t })} />
              <TextInput style={styles.input} placeholder="Short excerpt" placeholderTextColor={DIM} value={draft.excerpt} onChangeText={(t) => setDraft({ ...draft, excerpt: t })} />
              <TextInput style={[styles.input, styles.body]} placeholder="Write your post… Markdown works." placeholderTextColor={DIM} value={draft.bodyMd} onChangeText={(t) => setDraft({ ...draft, bodyMd: t })} multiline />
              {note ? <ThemedText type="small" style={styles.warn}>{note}</ThemedText> : null}
              <View style={styles.row}>
                <Pressable onPress={() => savePost(true)} disabled={busy} style={styles.primaryBtn}>
                  <ThemedText type="smallBold" style={{ color: BG }}>{busy ? 'Saving…' : 'Publish'}</ThemedText>
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
                      <ThemedText type="code" style={active === s.slug ? { color: BG } : styles.dim}>{s.name}</ThemedText>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {/* Live site preview */}
              {siteUrl ? (
                <>
                  <ThemedText type="code" style={styles.sectionLabel}>YOUR SITE</ThemedText>
                  <Pressable onPress={() => setShowPreview(true)} style={styles.previewFrame}>
                    <WebView source={{ uri: siteUrl }} style={styles.previewWeb} pointerEvents="none" scrollEnabled={false} />
                    <View style={styles.previewTap}>
                      <ThemedText type="code" style={styles.previewTapText}>tap to explore your live site →</ThemedText>
                    </View>
                  </Pressable>
                </>
              ) : null}

              {/* Site changes */}
              <ThemedText type="code" style={styles.sectionLabel}>IMPROVE YOUR SITE</ThemedText>
              <ThemedText type="small" style={styles.dim}>Describe a change in your own words — &ldquo;add a slideshow up top,&rdquo; &ldquo;make the buttons rounder.&rdquo;</ThemedText>
              <TextInput style={[styles.input, styles.change]} placeholder="What would you like to change?" placeholderTextColor={DIM} value={change} onChangeText={(t) => { setChange(t); setChangeState('idle'); }} multiline />
              {changeState === 'queued' ? (
                <ThemedText type="small" style={styles.green}>On it — Venus is updating your site. It goes live in a few minutes.</ThemedText>
              ) : (
                <Pressable onPress={sendChange} disabled={changeState === 'sending' || !change.trim()} style={[styles.primaryBtn, (!change.trim() || changeState === 'sending') && { opacity: 0.5 }]}>
                  <ThemedText type="smallBold" style={{ color: BG }}>{changeState === 'sending' ? 'Sending…' : 'Send to Venus'}</ThemedText>
                </Pressable>
              )}

              {/* Journal */}
              <ThemedText type="code" style={[styles.sectionLabel, { marginTop: Spacing.five }]}>JOURNAL</ThemedText>
              <Pressable onPress={() => { setDraft({ ...EMPTY }); setNote(null); }} style={styles.primaryBtn}>
                <ThemedText type="smallBold" style={{ color: BG }}>Write a post</ThemedText>
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
      {siteUrl ? <SitePreview visible={showPreview} url={siteUrl} onClose={() => setShowPreview(false)} /> : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { flex: 1, marginTop: Spacing.six, backgroundColor: BG, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: 'rgba(0,255,127,0.18)', overflow: 'hidden' },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.four, paddingVertical: Spacing.four },
  eyebrow: { color: GREEN, letterSpacing: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.six },
  scroll: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginBottom: Spacing.two },
  pill: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(0,255,127,0.2)' },
  pillOn: { backgroundColor: GREEN, borderColor: GREEN },
  sectionLabel: { color: GREEN, letterSpacing: 1.5, fontSize: 11 },
  previewFrame: { height: 240, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(0,255,127,0.22)', backgroundColor: '#fff' },
  previewWeb: { flex: 1, opacity: 0.99 },
  previewTap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: Spacing.two, alignItems: 'center', backgroundColor: 'rgba(4,20,12,0.82)' },
  previewTapText: { color: GREEN, fontSize: 11, letterSpacing: 0.5 },
  input: { borderWidth: 1, borderColor: 'rgba(0,255,127,0.2)', backgroundColor: FIELD, borderRadius: 10, padding: Spacing.three, color: '#fff', fontSize: 15 },
  body: { minHeight: 220, textAlignVertical: 'top' },
  change: { minHeight: 90, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four, marginTop: Spacing.one },
  primaryBtn: { backgroundColor: GREEN, borderRadius: 10, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.one },
  postRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' },
  postTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  postExcerpt: { color: DIM, fontSize: 11, marginTop: 2 },
  postActions: { flexDirection: 'row', gap: Spacing.three },
  badge: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)' },
  badgeLive: { backgroundColor: 'rgba(0,255,127,0.18)' },
  badgeText: { color: '#fff', fontSize: 9, letterSpacing: 0.5 },
  white: { color: '#fff' },
  dim: { color: DIM },
  green: { color: GREEN },
  warn: { color: '#ff7a7a' },
});
