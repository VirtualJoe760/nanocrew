import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlowButton } from '@/components/glow-button';
import { GlowInput } from '@/components/glow-input';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';
import { ApiError, apiFetch, readJson } from '@/lib/api';

// BRAND COLLABORATORS — the owner's management surface (Account → Brand collaborators). Invite by
// email (consent-based: the invitee accepts from their own Account or the emailed link — nobody is
// added to a brand silently), see who's on the brand, revoke pending invites, remove members.
// Membership administration is OWNER-only; a collaborator opening this for a brand they don't own
// gets the API's opaque 404, surfaced here as a plain explanation rather than an error tone.

type Theme = ReturnType<typeof useTheme>; // same idiom as purchases.tsx

type Member = { id: string; email: string; name: string | null; role: string; createdAt: string };
type Invite = { id: string; email: string; role: string; createdAt: string; expiresAt: string };
type StoreLite = { slug: string; name: string };

export function Collaborators({
  visible,
  onClose,
  stores,
}: {
  visible: boolean;
  onClose: () => void;
  /** The creator's stores (owned first is ideal — the API rejects non-owned slugs). */
  stores: StoreLite[];
}) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [slug, setSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [notOwner, setNotOwner] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Default to the first store on open; reset transient state when the sheet closes.
  useEffect(() => {
    if (visible) setSlug((cur) => cur ?? stores[0]?.slug ?? null);
    else {
      setSlug(null);
      setEmail('');
      setNotice(null);
      setError(null);
    }
  }, [visible, stores]);

  const load = useCallback(async (s: string) => {
    setLoading(true);
    setNotOwner(false);
    setError(null);
    try {
      const r = await apiFetch(`/api/creator/stores/${s}/collaborators`);
      if (r.status === 404) {
        // The API is opaque on purpose; here we know the likely cause — they're a collaborator,
        // not the owner, and only the owner administers membership.
        setNotOwner(true);
        setMembers([]);
        setInvites([]);
        return;
      }
      const d = await readJson<{ collaborators?: Member[]; invites?: Invite[] }>(r);
      setMembers(d.collaborators ?? []);
      setInvites(d.invites ?? []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load collaborators.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible && slug) void load(slug);
  }, [visible, slug, load]);

  const sendInvite = useCallback(async () => {
    if (!slug || sending) return;
    const to = email.trim().toLowerCase();
    if (!to) return;
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const r = await apiFetch(`/api/creator/stores/${slug}/collaborators`, {
        method: 'POST',
        body: JSON.stringify({ email: to }),
      });
      await readJson(r);
      setEmail('');
      setNotice(`Invite sent to ${to} — they'll get an email, and it's waiting in their Account.`);
      await load(slug);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send the invite.');
    } finally {
      setSending(false);
    }
  }, [slug, email, sending, load]);

  const remove = useCallback(
    async (body: { collaboratorId?: string; inviteId?: string }) => {
      if (!slug) return;
      setError(null);
      try {
        const r = await apiFetch(`/api/creator/stores/${slug}/collaborators`, {
          method: 'DELETE',
          body: JSON.stringify(body),
        });
        await readJson(r);
        await load(slug);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Could not remove.');
      }
    },
    [slug, load],
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <ThemedText type="code" style={styles.eyebrow}>
              {'// COLLABORATORS'}
            </ThemedText>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose} hitSlop={12}>
              <ThemedText type="code" themeColor="textSecondary">
                close ✕
              </ThemedText>
            </Pressable>
          </View>

          {/* Brand picker — only when there's a choice to make. */}
          {stores.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={{ gap: Spacing.two }}>
              {stores.map((s) => (
                <Pressable
                  key={s.slug}
                  onPress={() => setSlug(s.slug)}
                  style={[styles.chip, slug === s.slug && { borderColor: theme.tint }]}>
                  <ThemedText type="code" themeColor={slug === s.slug ? 'tint' : 'textSecondary'} style={styles.chipText}>
                    {s.name}
                  </ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {loading ? (
            <ActivityIndicator style={styles.center} color={theme.tint} />
          ) : notOwner ? (
            <View style={styles.center}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
                Only the brand owner manages collaborators.
              </ThemedText>
            </View>
          ) : (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
              {/* Invite */}
              <ThemedText type="code" themeColor="textSecondary" style={styles.sectionLabel}>
                INVITE BY EMAIL
              </ThemedText>
              <GlowInput
                value={email}
                onChangeText={setEmail}
                placeholder="their@email.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                containerStyle={{ marginBottom: Spacing.two }}
              />
              <GlowButton label={sending ? 'Sending…' : 'Send invite'} onPress={() => void sendInvite()} disabled={sending || !email.trim()} />
              <ThemedText type="code" themeColor="textSecondary" style={styles.fine}>
                They accept from the email or their Account tab. No account yet? The invite waits for
                their sign-up. Collaborators can design and manage the brand; only you can go live,
                publish, or manage members.
              </ThemedText>

              {notice ? (
                <ThemedText type="small" themeColor="tint" style={styles.notice}>
                  {notice}
                </ThemedText>
              ) : null}
              {error ? (
                <ThemedText type="small" style={[styles.notice, { color: '#e24b4a' }]}>
                  {error}
                </ThemedText>
              ) : null}

              {/* Pending invites */}
              {invites.length ? (
                <>
                  <ThemedText type="code" themeColor="textSecondary" style={styles.sectionLabel}>
                    PENDING
                  </ThemedText>
                  {invites.map((i) => (
                    <View key={i.id} style={styles.row}>
                      <View style={styles.rowMeta}>
                        <ThemedText type="smallBold">{i.email}</ThemedText>
                        <ThemedText type="code" themeColor="textSecondary" style={styles.rowSub}>
                          invited · expires {new Date(i.expiresAt).toLocaleDateString()}
                        </ThemedText>
                      </View>
                      <Pressable onPress={() => void remove({ inviteId: i.id })} hitSlop={10}>
                        <ThemedText type="code" themeColor="textSecondary">
                          revoke
                        </ThemedText>
                      </Pressable>
                    </View>
                  ))}
                </>
              ) : null}

              {/* Members */}
              <ThemedText type="code" themeColor="textSecondary" style={styles.sectionLabel}>
                ON THIS BRAND
              </ThemedText>
              {members.length ? (
                members.map((m) => (
                  <View key={m.id} style={styles.row}>
                    <View style={styles.rowMeta}>
                      <ThemedText type="smallBold">{m.name || m.email}</ThemedText>
                      <ThemedText type="code" themeColor="textSecondary" style={styles.rowSub}>
                        {m.name ? `${m.email} · ` : ''}
                        {m.role}
                      </ThemedText>
                    </View>
                    <Pressable onPress={() => void remove({ collaboratorId: m.id })} hitSlop={10}>
                      <ThemedText type="code" themeColor="textSecondary">
                        remove
                      </ThemedText>
                    </Pressable>
                  </View>
                ))
              ) : (
                <ThemedText type="small" themeColor="textSecondary">
                  Just you so far.
                </ThemedText>
              )}
            </ScrollView>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    fill: { flex: 1, backgroundColor: theme.background },
    sheet: { flex: 1, paddingHorizontal: Spacing.four, paddingTop: Spacing.three },
    headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.three },
    eyebrow: { letterSpacing: 2, color: theme.textSecondary },
    chips: { flexGrow: 0, marginBottom: Spacing.three },
    chip: { borderWidth: 1, borderColor: `${theme.textSecondary}44`, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
    chipText: { fontSize: 12 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
    centerText: { textAlign: 'center' },
    scroll: { paddingBottom: Spacing.six },
    sectionLabel: { letterSpacing: 1.5, fontSize: 11, marginTop: Spacing.four, marginBottom: Spacing.two },
    fine: { fontSize: 11, lineHeight: 16, marginTop: Spacing.two },
    notice: { marginTop: Spacing.three },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: Spacing.three,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: `${theme.textSecondary}22`,
    },
    rowMeta: { flex: 1, gap: 2 },
    rowSub: { fontSize: 11 },
  });
}
