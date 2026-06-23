import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';

import { ThemedText } from '@/components/themed-text';
import { usePalette } from '@/components/nc-screen';
import { Spacing } from '@/constants/theme';
import { apiUrl, readJson } from '@/lib/api';
import { glow } from '@/constants/glow';

// Guided coachmark tour: dims the app, highlights each tab in the bottom bar, and Venus NARRATES each
// step in her own voice (/api/say, Aoede). Next/Skip; first-run + re-openable from a "?" affordance.
// Self-contained — owns its own audio player so it can run from anywhere without the Studio session.

type TabKey = 'studio' | 'design' | 'market' | 'account';
const TAB_ORDER: TabKey[] = ['studio', 'design', 'market', 'account'];

type Step = { tab?: TabKey; title: string; body: string; say: string };

const STEPS: Step[] = [
  {
    title: 'Hi, I’m Venus',
    body: 'I’ll help you start a real clothing brand — right from your phone. Let me show you around in a few seconds.',
    say: 'Hi, I’m Venus. I’ll help you start a real clothing brand, right from your phone. Let me show you around.',
  },
  {
    tab: 'studio',
    title: 'Studio — talk to me',
    body: 'This is home. Tell me your idea out loud and I’ll name your brand, design its identity, and spin up a whole store and website with you.',
    say: 'This is Studio — your home base. Just talk to me, and I’ll build your brand, your store, and your website with you.',
  },
  {
    tab: 'design',
    title: 'Design — make products',
    body: 'Generate artwork or bring your own, drop it onto real apparel, and publish it for sale — print-ready, no inventory.',
    say: 'Design is where you make products. Generate artwork, drop it on real apparel, and publish it for sale.',
  },
  {
    tab: 'market',
    title: 'Market — discover & sell',
    body: 'Browse brands and shop right here. Your own brand shows up here too once you publish it.',
    say: 'Market is where you discover and sell. Browse brands, and your own brand shows up here once you publish.',
  },
  {
    tab: 'account',
    title: 'Account — plan & settings',
    body: 'Your plan, credits, payouts and settings live here whenever you need them.',
    say: 'And Account holds your plan, your credits, and your settings, whenever you need them.',
  },
  {
    tab: 'studio',
    title: 'Let’s build your brand',
    body: 'That’s the tour. Tap Studio whenever you’re ready and just start talking — I’ll take it from there.',
    say: 'That’s the tour. Tap Studio whenever you’re ready, and just start talking. I’ll take it from there.',
  },
];

// Rough bottom-bar geometry — 4 evenly-spaced tabs across the width, ~49pt tall above the safe area.
const TAB_BAR_H = 49;

export function OnboardingTour({
  visible,
  onClose,
  accessToken,
}: {
  visible: boolean;
  onClose: () => void;
  accessToken?: string;
}) {
  const p = usePalette();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [i, setI] = useState(0);
  const player = useAudioPlayer();
  const playGen = useRef(0);
  const fileN = useRef(0);

  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  // Narrate the current step in Venus's voice (best-effort — the tour works silently if it fails).
  const narrate = useCallback(
    async (text: string) => {
      if (!accessToken) return;
      const gen = ++playGen.current;
      try {
        const v = await fetch(apiUrl('/api/say'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ text }),
        });
        const s = await readJson<{ audio?: string }>(v);
        if (!s.audio || gen !== playGen.current) return;
        const file = `${FileSystem.cacheDirectory}tour-${fileN.current++}.wav`;
        await FileSystem.writeAsStringAsync(file, s.audio, { encoding: FileSystem.EncodingType.Base64 });
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        if (gen !== playGen.current) return;
        player.replace(file);
        for (let t = 0; t < 25 && !player.isLoaded; t++) {
          await new Promise((r) => setTimeout(r, 100));
          if (gen !== playGen.current) return;
        }
        if (gen === playGen.current) player.play();
      } catch {
        /* narration is optional */
      }
    },
    [accessToken, player],
  );

  // Reset to step 0 each time the tour opens; stop audio when it closes.
  useEffect(() => {
    if (visible) setI(0);
    else {
      playGen.current++;
      try { player.pause(); } catch {}
    }
  }, [visible, player]);

  // Narrate whenever the step changes (while open).
  useEffect(() => {
    if (visible) void narrate(step.say);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, i]);

  const finish = useCallback(() => {
    playGen.current++;
    try { player.pause(); } catch {}
    onClose();
  }, [onClose, player]);

  const next = useCallback(() => {
    if (last) finish();
    else setI((v) => v + 1);
  }, [last, finish]);

  if (!visible) return null;

  // Highlight box over the active tab (if any).
  const tabIdx = step.tab ? TAB_ORDER.indexOf(step.tab) : -1;
  const tabW = width / TAB_ORDER.length;
  const barBottom = insets.bottom;
  const highlight =
    tabIdx >= 0
      ? { left: tabIdx * tabW, width: tabW, bottom: barBottom, height: TAB_BAR_H }
      : null;
  // Tooltip sits above the bar (or centered for the intro/outro with no tab).
  const tooltipBottom = highlight ? barBottom + TAB_BAR_H + Spacing.three : height / 2 - 120;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={finish}>
      {/* Dim backdrop — tap anywhere advances. */}
      <Pressable style={styles.backdrop} onPress={next}>
        {highlight ? (
          <>
            {/* a glowing ring around the highlighted tab */}
            <View
              pointerEvents="none"
              style={[
                styles.ring,
                { left: highlight.left + 6, width: highlight.width - 12, height: highlight.height, bottom: highlight.bottom, borderColor: p.accent },
                glow(p.accent, 18, 0.6),
              ]}
            />
            {/* a little caret pointing down at the tab */}
            <View pointerEvents="none" style={[styles.caret, { left: highlight.left + highlight.width / 2 - 7, bottom: highlight.bottom + highlight.height + 2, borderTopColor: p.accent }]} />
          </>
        ) : null}

        {/* tooltip card */}
        <View style={[styles.card, { bottom: tooltipBottom, backgroundColor: p.bgTop, borderColor: p.line }]}>
          <View style={styles.cardHead}>
            <Image source={require('@/assets/brand/venus-portrait.png')} style={styles.venus} contentFit="cover" />
            <View style={styles.flex}>
              <ThemedText type="smallBold" style={{ color: p.ink }}>{step.title}</ThemedText>
              <ThemedText type="small" style={{ color: p.dim, marginTop: 2 }}>{step.body}</ThemedText>
            </View>
          </View>
          <View style={styles.cardFoot}>
            {/* step dots */}
            <View style={styles.dots}>
              {STEPS.map((_, n) => (
                <View key={n} style={[styles.dot, { backgroundColor: n === i ? p.accent : `${p.dim}55` }]} />
              ))}
            </View>
            <View style={styles.actions}>
              {!last ? (
                <Pressable onPress={finish} hitSlop={8}>
                  <ThemedText type="code" style={{ color: p.faint }}>Skip</ThemedText>
                </Pressable>
              ) : null}
              <Pressable onPress={next} style={({ pressed }) => [styles.nextBtn, { backgroundColor: p.accent }, glow(p.accent, 14, pressed ? 0.3 : 0.6)]}>
                <ThemedText type="smallBold" style={{ color: '#08080a' }}>{last ? 'Start' : 'Next'}</ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.78)' },
  flex: { flex: 1 },
  ring: { position: 'absolute', borderWidth: 2, borderRadius: 14 },
  caret: { position: 'absolute', width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  card: { position: 'absolute', left: Spacing.four, right: Spacing.four, borderRadius: 18, borderWidth: 1, padding: Spacing.four },
  cardHead: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-start' },
  venus: { width: 46, height: 46, borderRadius: 23 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.four },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
  nextBtn: { borderRadius: 999, paddingHorizontal: Spacing.five, paddingVertical: Spacing.two },
});
