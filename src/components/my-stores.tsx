import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';
import { apiFetch, readJson } from '@/lib/api';

// MY STORES — the creator's own marketplace, inside the Market tab (Joe, 2026-08-18: "we need a My
// stores section on the market… we should be able to remove, or hide products there"). It shows
// what shoppers see PLUS what they can't: hidden products, dimmed with a badge. Tap a tile to open
// the store the way a shopper sees it; long-press for hide / show / delete.

type OwnedStore = { name: string; slug: string };
type OwnedProduct = {
  id: string;
  name: string;
  imageUrl: string | null;
  modelShots: string[] | null;
  isPublished: boolean;
};

export function MyStores({ width, onOpen }: { width: number; onOpen: (slug: string) => void }) {
  const theme = useTheme();
  const [stores, setStores] = useState<OwnedStore[] | null>(null);
  const [byStore, setByStore] = useState<Record<string, OwnedProduct[]>>({});
  const [busy, setBusy] = useState<string | null>(null); // product id mid-mutation

  useEffect(() => {
    let alive = true;
    apiFetch('/api/me')
      .then(readJson<{ stores?: OwnedStore[] }>)
      .then((d) => alive && setStores(d.stores ?? []))
      .catch(() => alive && setStores([]));
    return () => {
      alive = false;
    };
  }, []);

  const loadProducts = useCallback((slug: string) => {
    apiFetch(`/api/creator/products?storeSlug=${encodeURIComponent(slug)}`)
      .then(readJson<{ products?: OwnedProduct[] }>)
      .then((d) => setByStore((m) => ({ ...m, [slug]: d.products ?? [] })))
      .catch(() => setByStore((m) => ({ ...m, [slug]: [] })));
  }, []);

  useEffect(() => {
    for (const s of stores ?? []) loadProducts(s.slug);
  }, [stores, loadProducts]);

  const setPublished = useCallback(async (slug: string, p: OwnedProduct, next: boolean) => {
    setBusy(p.id);
    try {
      const r = await apiFetch(`/api/creator/products/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublished: next }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Failed');
      setByStore((m) => ({
        ...m,
        [slug]: (m[slug] ?? []).map((x) => (x.id === p.id ? { ...x, isPublished: next } : x)),
      }));
    } catch (e) {
      Alert.alert('Could not update', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(null);
    }
  }, []);

  const remove = useCallback(async (slug: string, p: OwnedProduct) => {
    setBusy(p.id);
    try {
      const r = await apiFetch(`/api/creator/products/${p.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Failed');
      setByStore((m) => ({ ...m, [slug]: (m[slug] ?? []).filter((x) => x.id !== p.id) }));
    } catch (e) {
      Alert.alert('Could not remove', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(null);
    }
  }, []);

  const actions = useCallback(
    (slug: string, p: OwnedProduct) => {
      Alert.alert(p.name, p.isPublished ? 'Live in your store.' : 'Hidden — nobody can see this.', [
        p.isPublished
          ? { text: 'Hide from store', onPress: () => void setPublished(slug, p, false) }
          : { text: 'Show in store', onPress: () => void setPublished(slug, p, true) },
        {
          text: 'Remove for good',
          style: 'destructive' as const,
          onPress: () =>
            Alert.alert('Remove this product?', 'It comes off your store, your website and Printful. This cannot be undone.', [
              { text: 'Cancel', style: 'cancel' as const },
              { text: 'Remove', style: 'destructive' as const, onPress: () => void remove(slug, p) },
            ]),
        },
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    },
    [setPublished, remove],
  );

  if (!stores) return <ActivityIndicator style={styles.pad} color={theme.tint} />;
  if (!stores.length) {
    return (
      <View style={[styles.emptyCard, styles.pad]}>
        <ThemedText type="small" themeColor="textSecondary">
          No stores yet — talk to Eve and she&rsquo;ll build your first one.
        </ThemedText>
      </View>
    );
  }

  const col = Math.floor((width - Spacing.four * 2 - Spacing.three) / 2);

  return (
    <View style={styles.wrap}>
      {stores.map((s) => {
        const items = byStore[s.slug];
        const live = (items ?? []).filter((p) => p.isPublished).length;
        return (
          <View key={s.slug} style={styles.storeBlock}>
            <Pressable onPress={() => onOpen(s.slug)} style={styles.storeHead} hitSlop={6}>
              <View style={styles.flex}>
                <ThemedText type="subtitle">{s.name}</ThemedText>
                <ThemedText type="code" themeColor="textSecondary" style={styles.meta}>
                  {items ? `${live} LIVE${items.length - live ? ` · ${items.length - live} HIDDEN` : ''}` : 'LOADING…'}
                </ThemedText>
              </View>
              <ThemedText type="small" themeColor="tint">
                View store →
              </ThemedText>
            </Pressable>

            {!items ? (
              <ActivityIndicator color={theme.textSecondary} />
            ) : items.length ? (
              <View style={styles.grid}>
                {items.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => onOpen(s.slug)}
                    onLongPress={() => actions(s.slug, p)}
                    delayLongPress={300}
                    style={{ width: col, opacity: p.isPublished ? 1 : 0.45 }}>
                    <ThemedView type="backgroundElement" style={[styles.tile, { height: col }]}>
                      {p.modelShots?.[0] || p.imageUrl ? (
                        <Image source={{ uri: p.modelShots?.[0] ?? p.imageUrl! }} style={styles.tileImg} contentFit="cover" />
                      ) : null}
                      {busy === p.id ? (
                        <View style={styles.tileBusy}>
                          <ActivityIndicator color={theme.text} />
                        </View>
                      ) : null}
                      {!p.isPublished ? (
                        <View style={styles.badge}>
                          <ThemedText type="code" style={styles.badgeText}>
                            HIDDEN
                          </ThemedText>
                        </View>
                      ) : null}
                    </ThemedView>
                    <ThemedText type="small" numberOfLines={1} style={styles.tileName}>
                      {p.name}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            ) : (
              <View style={styles.emptyCard}>
                <ThemedText type="small" themeColor="textSecondary">
                  Nothing published yet.
                </ThemedText>
              </View>
            )}
          </View>
        );
      })}
      <ThemedText type="code" themeColor="textSecondary" style={styles.hint}>
        LONG-PRESS A PRODUCT TO HIDE OR REMOVE IT
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.six, paddingHorizontal: Spacing.four },
  pad: { marginHorizontal: Spacing.four },
  flex: { flex: 1 },
  storeBlock: { gap: Spacing.three },
  storeHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  meta: { fontSize: 10, letterSpacing: 1.2, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  tile: { borderRadius: Spacing.three, overflow: 'hidden' },
  tileImg: { width: '100%', height: '100%' },
  tileBusy: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  badge: { position: 'absolute', top: 8, left: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(8,8,10,0.85)' },
  badgeText: { fontSize: 9, letterSpacing: 1.2, color: '#e8eef4' },
  tileName: { marginTop: 4 },
  emptyCard: { padding: Spacing.four, borderRadius: Spacing.three, backgroundColor: 'rgba(255,255,255,0.04)' },
  hint: { fontSize: 9, letterSpacing: 1.2, textAlign: 'center', opacity: 0.7 },
});
