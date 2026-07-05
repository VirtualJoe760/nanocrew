import { useMemo, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { PreviewContent } from '@/components/site-preview';
import { ThemedText } from '@/components/themed-text';
import { usePalette } from '@/components/nc-screen';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';

// EVE'S DEVELOPING STATE — site editing inside the overlay (docs/studio/VENUS_CENTRAL.md §2).
// The existing critique experience RE-HOMED, not rebuilt: PreviewContent (site-preview.tsx) is the
// whole UI — WebView + circle-pen + its own critique voice session (critiqueInstruction persona,
// started on mount, stopped on unmount). That self-hosting IS the session model here:
// reconnect-per-state — Eve's home session dies when EveHome unmounts, the critique session takes
// the mic (the activeLiveSession singleton makes the handoff safe), and exiting reverses it.
//
// Payload comes from the summoner (eve-home routing, the composer tile): the REAL storefront url
// (deploymentUrl/customDomain — never derived from the slug) + slug + brand name.

export function EveDeveloping({
  url,
  slug,
  onExit,
  onSubmitted,
}: {
  url?: string;
  slug?: string;
  /** Back to Eve's home state — fired by the header ✕ and the guard fallback. */
  onExit: () => void;
  /** A revision was submitted — hand off to the Studio review surface (where it builds + is
   *  approved). Without this the pending change is invisible until the creator reopens Studio. */
  onSubmitted: (slug: string) => void;
}) {
  const p = usePalette();
  const { session } = useAuth();
  const token = session?.access_token;
  // PreviewContent fires critique.onSent() THEN onClose() on a successful submit. Latch so the
  // trailing onClose doesn't bounce us back to Eve home after we've already handed off to review.
  const submittedRef = useRef(false);

  const critique = useMemo(
    () =>
      slug && token
        ? {
            slug,
            token,
            onSent: () => {
              submittedRef.current = true;
              onSubmitted(slug);
            },
          }
        : undefined,
    [slug, token, onSubmitted],
  );

  if (!url || !critique) {
    // Guarded upstream (only stores with a live site route here) — but never strand the user.
    return (
      <View style={styles.emptyWrap}>
        <ThemedText type="code" style={{ color: p.dim, textAlign: 'center' }}>
          {token ? 'This brand doesn’t have a live website yet.' : 'Sign in to edit your site.'}
        </ThemedText>
        <Pressable onPress={onExit} hitSlop={10} style={[styles.backPill, { borderColor: `${p.dim}66` }]}>
          <ThemedText type="code" style={{ color: p.dim }}>‹ back to Eve</ThemedText>
        </Pressable>
      </View>
    );
  }

  // The header ✕ / manual exit returns home; a submit-triggered close is swallowed (onSubmitted
  // already navigated to review).
  const handleClose = () => {
    if (submittedRef.current) return;
    onExit();
  };

  return <PreviewContent url={url} onClose={handleClose} critique={critique} />;
}

const styles = StyleSheet.create({
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.four, padding: Spacing.four },
  backPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
});
