import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type Palette } from '@/components/nc-screen';
import { glow } from '@/constants/glow';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';
import type { ChatMessage } from '@/lib/interview';

// Keyboard mode = a full-screen chat window (its own surface, rendered OVER the studio), not the orb
// layout with a cramped input. Venus's turns + the creator's typed turns render as message bubbles;
// it's a TEXT experience (her voice is muted in this mode). Switching to voice returns to the orb.

// Same reading-scrim eve-home uses (READ_SCRIM) — Eve glows faintly through the chat instead of
// being blacked out; bubbles stay opaque so long copy still reads.
const CHAT_SCRIM = 'rgba(6,8,12,0.82)';
//
// It manages its own bottom inset off the live keyboard height so the composer sits above the
// keyboard when open and above the native tab bar when closed — it does NOT live inside the studio's
// KeyboardAvoidingView (that zeroed the bottom padding and dropped the composer under the tab bar).
export function ChatInterview({
  messages,
  streaming,
  thinking,
  aiName,
  onSend,
  onVoice,
  onExit,
  onFinalize,
  finalizing,
  canBuild,
  p,
  bg,
}: {
  messages: ChatMessage[];
  /** The in-progress Venus reply (streams in as she replies); empty between turns. */
  streaming: string;
  thinking: boolean;
  aiName: string;
  onSend: (text: string) => void;
  /** Switch to the voice orb (stay in the interview). */
  onVoice: () => void;
  /** Leave the interview entirely (back out of text mode). */
  onExit: () => void;
  onFinalize: () => void;
  finalizing: boolean;
  /** Build only appears once Venus has gathered the essentials. */
  canBuild: boolean;
  p: Palette;
  bg: string;
}) {
  const insets = useSafeAreaInsets();
  const s = makeStyles(p);
  const [text, setText] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [kb, setKb] = useState(0);
  const scroller = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e) => setKb(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(hideEvt, () => setKb(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Show the streaming bubble unless it's already been committed as the last message.
  const last = messages[messages.length - 1];
  const showStreaming = !!streaming && !(last && last.role === 'assistant' && last.text === streaming);

  useEffect(() => {
    const t = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [messages.length, streaming, thinking, kb]);

  const send = () => {
    const t = text.trim();
    if (!t || thinking) return;
    inputRef.current?.clear(); // controlled multiline doesn't always re-sync to '' — clear natively too
    setText('');
    onSend(t);
  };

  // Above the keyboard when open; above the native tab bar + home indicator when closed.
  const bottomInset = kb > 0 ? kb + Spacing.two : BottomTabInset + insets.bottom + Spacing.two;

  return (
    <View style={[s.root, { backgroundColor: CHAT_SCRIM, paddingTop: insets.top + Spacing.two, paddingBottom: bottomInset }]}>
      {/* Header: back out · Venus · (switch to voice / build once ready) */}
      <View style={s.header}>
        <Pressable onPress={onExit} hitSlop={10} style={s.leftBtn}>
          <ThemedText type="code" style={{ color: p.dim }}>‹ Back</ThemedText>
        </Pressable>
        <ThemedText type="smallBold" style={{ color: p.ink }}>{aiName}</ThemedText>
        {canBuild ? (
          <Pressable onPress={onFinalize} disabled={finalizing} hitSlop={10} style={[s.buildBtn, { backgroundColor: p.accent, opacity: finalizing ? 0.5 : 1 }]}>
            {finalizing ? <ActivityIndicator size="small" color={bg} /> : <ThemedText type="code" style={{ color: bg }}>✓ Build</ThemedText>}
          </Pressable>
        ) : (
          <Pressable onPress={onVoice} hitSlop={10} style={s.rightBtn}>
            <ThemedText type="code" style={{ color: p.dim }}>🎙 Voice</ThemedText>
          </Pressable>
        )}
      </View>

      {/* Messages */}
      <ScrollView
        ref={scroller}
        style={s.fill}
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive">
        {messages.length === 0 && !showStreaming && !thinking ? (
          <ThemedText type="code" style={s.empty}>{aiName} is connecting…</ThemedText>
        ) : null}
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} text={m.text} s={s} />
        ))}
        {showStreaming ? <Bubble role="assistant" text={streaming} s={s} /> : null}
        {thinking && !showStreaming ? (
          <View style={[s.bubble, s.venusBubble]}>
            <ThemedText type="code" style={{ color: p.dim }}>· · ·</ThemedText>
          </View>
        ) : null}
      </ScrollView>

      {/* Composer */}
      <View style={s.composer}>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          placeholder={`Message ${aiName}…`}
          placeholderTextColor={p.faint}
          multiline
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          style={[
            s.input,
            { color: p.ink },
            inputFocused && { borderColor: p.accentCool },
            inputFocused && glow(p.accentCool, 12, 0.5),
          ]}
          onSubmitEditing={send}
          blurOnSubmit={false}
        />
        <Pressable onPress={send} disabled={!text.trim() || thinking} hitSlop={8}>
          {(() => {
            const active = !!text.trim() && !thinking;
            return (
              <View style={[s.send, { backgroundColor: p.accent, opacity: active ? 1 : 0.4 }, active && glow(p.accent, 14, 0.55)]}>
                <ThemedText type="code" style={{ color: bg }}>send</ThemedText>
              </View>
            );
          })()}
        </Pressable>
      </View>
    </View>
  );
}

function Bubble({ role, text, s }: { role: 'user' | 'assistant'; text: string; s: ReturnType<typeof makeStyles> }) {
  return (
    <View style={[s.bubble, role === 'user' ? s.userBubble : s.venusBubble]}>
      <ThemedText type="small" style={role === 'user' ? s.userText : s.venusText}>{text}</ThemedText>
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, paddingHorizontal: Spacing.four },
    fill: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: Spacing.two,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.line,
    },
    leftBtn: { paddingVertical: 4, paddingHorizontal: 4, minWidth: 72 },
    rightBtn: { paddingVertical: 4, paddingHorizontal: 4, minWidth: 72, alignItems: 'flex-end' },
    buildBtn: { borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 6, minWidth: 72, alignItems: 'center' },
    scroll: { paddingVertical: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.four },
    empty: { color: p.faint, textAlign: 'center', marginTop: Spacing.six },
    bubble: { maxWidth: '82%', borderRadius: 16, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
    userBubble: { alignSelf: 'flex-end', backgroundColor: p.accent, borderBottomRightRadius: 4 },
    venusBubble: { alignSelf: 'flex-start', backgroundColor: p.bgTop, borderWidth: StyleSheet.hairlineWidth, borderColor: p.line, borderBottomLeftRadius: 4 },
    userText: { color: p.bg, lineHeight: 20 },
    venusText: { color: p.ink, lineHeight: 20 },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: Spacing.two,
      paddingTop: Spacing.two,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: p.line,
    },
    input: {
      flex: 1,
      maxHeight: 120,
      minHeight: 44,
      borderWidth: 1,
      borderColor: p.line,
      borderRadius: 22,
      paddingHorizontal: Spacing.three,
      paddingTop: Platform.OS === 'ios' ? 12 : 8,
      paddingBottom: Platform.OS === 'ios' ? 12 : 8,
      fontSize: 15,
    },
    send: { borderRadius: 22, paddingHorizontal: Spacing.four, height: 44, alignItems: 'center', justifyContent: 'center' },
  });
}
