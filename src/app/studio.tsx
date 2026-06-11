import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { apiUrl } from '@/lib/api';

// The Studio tab: an AI brand interview. Answer a handful of questions and Nanocrew
// turns them into a brand profile + design system, then creates your store.

type ChatMessage = { role: 'user' | 'assistant'; text: string };

type Brand = {
  name: string;
  tagline: string;
  mission: string;
  audience: string;
  voice: string;
  story: string;
  vibeKeywords: string[];
  designSystem: {
    palette: { role: string; hex: string }[];
    typography: { display: string; body: string };
    texture: string[];
    motion: string[];
  };
};

function Bubble({ msg }: { msg: ChatMessage }) {
  const theme = useTheme();
  const mine = msg.role === 'user';
  return (
    <View
      style={[
        styles.bubble,
        mine
          ? [styles.bubbleMine, { backgroundColor: theme.text }]
          : [styles.bubbleTheirs, { backgroundColor: theme.backgroundElement }],
      ]}
    >
      <ThemedText type="small" style={mine ? { color: theme.background } : undefined}>
        {msg.text}
      </ThemedText>
    </View>
  );
}

function BrandCard({
  brand,
  creating,
  created,
  error,
  onCreate,
}: {
  brand: Brand;
  creating: boolean;
  created: string | null;
  error: string | null;
  onCreate: () => void;
}) {
  const theme = useTheme();
  return (
    <ThemedView type="backgroundElement" style={styles.brandCard}>
      <ThemedText type="code" style={styles.eyebrow}>
        Your brand
      </ThemedText>
      <ThemedText type="subtitle">{brand.name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {brand.tagline}
      </ThemedText>

      <View style={styles.paletteRow}>
        {brand.designSystem.palette.map((p) => (
          <View key={p.role} style={styles.swatchCol}>
            <View style={[styles.swatch, { backgroundColor: p.hex }]} />
            <ThemedText type="code" themeColor="textSecondary" style={styles.swatchLabel}>
              {p.role}
            </ThemedText>
          </View>
        ))}
      </View>

      <View style={styles.chipsRow}>
        {brand.vibeKeywords.map((k) => (
          <View key={k} style={[styles.chip, { borderColor: theme.textSecondary }]}>
            <ThemedText type="small" themeColor="textSecondary">
              {k}
            </ThemedText>
          </View>
        ))}
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        {brand.story}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Type · {brand.designSystem.typography.display} / {brand.designSystem.typography.body}
      </ThemedText>

      {created ? (
        <View style={[styles.createBtn, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="smallBold">Store created · @{created}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Head to Design to start your first drop.
          </ThemedText>
        </View>
      ) : (
        <Pressable onPress={onCreate} disabled={creating}>
          <View style={[styles.createBtn, { backgroundColor: theme.text, opacity: creating ? 0.5 : 1 }]}>
            {creating ? (
              <ActivityIndicator color={theme.background} />
            ) : (
              <ThemedText type="smallBold" style={{ color: theme.background }}>
                Create my store
              </ThemedText>
            )}
          </View>
        </Pressable>
      )}
      {error ? (
        <ThemedText type="small" style={styles.error}>
          {error}
        </ThemedText>
      ) : null}
    </ThemedView>
  );
}

export default function StudioScreen() {
  const theme = useTheme();
  const { session, loading } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const ask = useCallback(
    async (history: ChatMessage[]) => {
      if (!session) return;
      setBusy(true);
      setChatError(null);
      try {
        const r = await fetch(apiUrl('/api/interview'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ messages: history }),
        });
        const d = (await r.json()) as { done?: boolean; question?: string; brand?: Brand; error?: string };
        if (d.error) throw new Error(d.error);
        if (d.done && d.brand) {
          setBrand(d.brand);
        } else if (d.question) {
          setMessages([...history, { role: 'assistant', text: d.question }]);
        }
      } catch (e) {
        setChatError(e instanceof Error ? e.message : 'Something went wrong — try again.');
      } finally {
        setBusy(false);
      }
    },
    [session],
  );

  // Kick off the interview once signed in.
  useEffect(() => {
    if (session && !messages.length && !brand) void ask([]);
  }, [session, messages.length, brand, ask]);

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text || busy) return;
    const history: ChatMessage[] = [...messages, { role: 'user', text }];
    setMessages(history);
    setDraft('');
    void ask(history);
  }, [draft, busy, messages, ask]);

  const createStore = useCallback(async () => {
    if (!session || !brand) return;
    setCreating(true);
    setCreateError(null);
    try {
      const r = await fetch(apiUrl('/api/store'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ brand }),
      });
      const d = (await r.json()) as { store?: { slug: string }; error?: string };
      if (!d.store) throw new Error(d.error || 'Failed to create store');
      setCreated(d.store.slug);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create store');
    } finally {
      setCreating(false);
    }
  }, [session, brand]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.flex}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
          <View style={styles.inner}>
            <View style={styles.header}>
              <ThemedText type="code" style={styles.eyebrow}>
                Your store
              </ThemedText>
              <ThemedText type="title">Studio</ThemedText>
            </View>

            {loading ? (
              <ActivityIndicator style={styles.center} />
            ) : !session ? (
              <View style={styles.center}>
                <ThemedText themeColor="textSecondary" style={styles.signInNote}>
                  Sign in on the Account tab to start your brand interview.
                </ThemedText>
              </View>
            ) : (
              <>
                <ScrollView
                  ref={scrollRef}
                  style={styles.flex}
                  contentContainerStyle={styles.chat}
                  showsVerticalScrollIndicator={false}
                  onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
                >
                  {messages.map((m, i) => (
                    <Bubble key={i} msg={m} />
                  ))}
                  {brand ? (
                    <BrandCard
                      brand={brand}
                      creating={creating}
                      created={created}
                      error={createError}
                      onCreate={createStore}
                    />
                  ) : null}
                  {busy ? <ActivityIndicator style={styles.typing} /> : null}
                  {chatError ? (
                    <ThemedText type="small" style={styles.error}>
                      {chatError}
                    </ThemedText>
                  ) : null}
                </ScrollView>

                {!brand ? (
                  <View style={styles.inputRow}>
                    <TextInput
                      value={draft}
                      onChangeText={setDraft}
                      placeholder="Type your answer…"
                      placeholderTextColor={theme.textSecondary}
                      multiline
                      style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
                      onSubmitEditing={send}
                    />
                    <Pressable onPress={send} disabled={busy || !draft.trim()} hitSlop={8}>
                      <View
                        style={[
                          styles.sendBtn,
                          { backgroundColor: theme.text, opacity: busy || !draft.trim() ? 0.4 : 1 },
                        ]}
                      >
                        <ThemedText type="smallBold" style={{ color: theme.background }}>
                          ↑
                        </ThemedText>
                      </View>
                    </Pressable>
                  </View>
                ) : null}
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  inner: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
  },
  header: { gap: Spacing.one, paddingTop: Spacing.three, paddingBottom: Spacing.three },
  eyebrow: { textTransform: 'uppercase' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  signInNote: { textAlign: 'center', maxWidth: 280 },
  chat: { gap: Spacing.two, paddingBottom: Spacing.three },
  bubble: {
    maxWidth: '85%',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  bubbleMine: { alignSelf: 'flex-end' },
  bubbleTheirs: { alignSelf: 'flex-start' },
  typing: { alignSelf: 'flex-start', margin: Spacing.two },
  error: { color: '#e24b4a' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.three,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    fontSize: 15,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandCard: {
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
    marginTop: Spacing.two,
  },
  paletteRow: { flexDirection: 'row', gap: Spacing.two },
  swatchCol: { alignItems: 'center', gap: Spacing.one, flex: 1 },
  swatch: { width: '100%', aspectRatio: 1, borderRadius: Spacing.two },
  swatchLabel: { fontSize: 10 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one,
  },
  createBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    gap: 2,
    minHeight: 48,
  },
});
