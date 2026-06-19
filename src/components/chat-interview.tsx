import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { type Palette } from '@/components/nc-screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { ChatMessage } from '@/lib/interview';

// Keyboard mode = a full chat window (its own screen), not the orb layout with a cramped input.
// Venus's turns + the creator's typed turns render as message bubbles; she still replies in voice,
// the text just streams into the chat. Switching to voice (the mark) returns to the orb.
export function ChatInterview({
  messages,
  streaming,
  thinking,
  aiName,
  onSend,
  onVoice,
  onFinalize,
  finalizing,
  p,
  bg,
}: {
  messages: ChatMessage[];
  /** The in-progress Venus reply (streams in as she speaks); empty between turns. */
  streaming: string;
  thinking: boolean;
  aiName: string;
  onSend: (text: string) => void;
  onVoice: () => void;
  onFinalize: () => void;
  finalizing: boolean;
  p: Palette;
  bg: string;
}) {
  const s = makeStyles(p);
  const [text, setText] = useState('');
  const scroller = useRef<ScrollView>(null);

  // Show the streaming bubble unless it's already been committed as the last message.
  const last = messages[messages.length - 1];
  const showStreaming = !!streaming && !(last && last.role === 'assistant' && last.text === streaming);

  useEffect(() => {
    const t = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [messages.length, streaming, thinking]);

  const send = () => {
    const t = text.trim();
    if (!t || thinking) return;
    setText('');
    onSend(t);
  };

  return (
    // The studio screen already wraps content in a KeyboardAvoidingView — don't nest another (it
    // double-offsets). This is just a flex column: header · messages · composer.
    <View style={s.fill}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={onVoice} hitSlop={10} style={s.voiceBtn}>
          <ThemedText type="code" style={{ color: p.dim }}>🎙 Voice</ThemedText>
        </Pressable>
        <ThemedText type="smallBold" style={{ color: p.ink }}>{aiName}</ThemedText>
        <Pressable onPress={onFinalize} disabled={finalizing} hitSlop={10} style={[s.buildBtn, { backgroundColor: p.accent, opacity: finalizing ? 0.5 : 1 }]}>
          {finalizing ? <ActivityIndicator size="small" color={bg} /> : <ThemedText type="code" style={{ color: bg }}>✓ Build</ThemedText>}
        </Pressable>
      </View>

      {/* Messages */}
      <ScrollView
        ref={scroller}
        style={s.fill}
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
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
          value={text}
          onChangeText={setText}
          placeholder={`Message ${aiName}…`}
          placeholderTextColor={p.faint}
          multiline
          style={[s.input, { color: p.ink }]}
          onSubmitEditing={send}
          blurOnSubmit={false}
        />
        <Pressable onPress={send} disabled={!text.trim() || thinking} hitSlop={8}>
          <View style={[s.send, { backgroundColor: p.accent, opacity: !text.trim() || thinking ? 0.4 : 1 }]}>
            <ThemedText type="code" style={{ color: bg }}>send</ThemedText>
          </View>
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
    fill: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: Spacing.two,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.line,
    },
    voiceBtn: { paddingVertical: 4, paddingHorizontal: 4, minWidth: 64 },
    buildBtn: { borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 6, minWidth: 64, alignItems: 'center' },
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
      paddingBottom: Spacing.two,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: p.line,
    },
    input: {
      flex: 1,
      maxHeight: 120,
      minHeight: 40,
      borderWidth: 1,
      borderColor: p.line,
      borderRadius: 20,
      paddingHorizontal: Spacing.three,
      paddingTop: Platform.OS === 'ios' ? 10 : 6,
      paddingBottom: Platform.OS === 'ios' ? 10 : 6,
      fontSize: 15,
    },
    send: { borderRadius: 20, paddingHorizontal: Spacing.four, height: 40, alignItems: 'center', justifyContent: 'center' },
  });
}
