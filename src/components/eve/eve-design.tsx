import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VenusBubble } from '@/components/venus-bubble';
import { ThemedText } from '@/components/themed-text';
import { usePalette } from '@/components/nc-screen';
import { glow } from '@/constants/glow';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { apiUrl } from '@/lib/api';
import { sendDesignCommand } from '@/lib/design-bus';
import { showEve } from '@/lib/eve-vision-bus';

// EVE'S DESIGN STATE — her hands-free create surface (docs/studio/EVE_CONTROL.md, Phase C3).
// The first deep, non-nav flow the tree drives end-to-end: resolve a collection, generate from an
// idea (POST /api/generate), show it large with Eve beside it, iterate by instruction (POST /api/edit,
// non-destructive), then hand off — open it in the Design tab to hand-edit, or keep it on the canvas.
//
// The SAME endpoints the Design tab uses, so behaviour is identical; this is just Eve's immersive,
// conversational entry into them. Voice-driven iteration (spoken turns → a design-turn distiller)
// lands next (C3b) — this slice drives it by typed instruction, which is fully verifiable and carries
// no risk of a misheard word spending credits.

const BG = '#08080a';
const EDIT_COST = 8; // display mirror of CREDIT_COSTS.design_edit (server is source of truth)

type Design = { id: string; url: string; prompt: string };
type Phase = 'resolving' | 'idle' | 'busy' | 'ready' | 'error';

export function EveDesign({
  idea,
  onExit,
  onHandoff,
}: {
  /** The concept to generate on entry (from a spoken/typed intent). Absent → Eve asks. */
  idea?: string;
  /** Back to Eve's home state. */
  onExit: () => void;
  /** Leave the overlay for the Design tab (a queued design-bus command lands there on mount). */
  onHandoff: () => void;
}) {
  const insets = useSafeAreaInsets();
  const p = usePalette();
  const { session } = useAuth();
  const token = session?.access_token;

  const [phase, setPhase] = useState<Phase>('resolving');
  const [current, setCurrent] = useState<Design | null>(null);
  const [line, setLine] = useState(idea ? 'Working on it…' : 'What shall I make?');
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const catalogueRef = useRef<string | null>(null);
  const stackRef = useRef<Design[]>([]); // history for "undo" back to the prior iteration

  const authHeaders = useCallback(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token],
  );

  // Resolve the collection to persist into: the primary store's first catalogue, or create "Designs".
  const resolveCatalogue = useCallback(async (): Promise<string | null> => {
    if (catalogueRef.current) return catalogueRef.current;
    try {
      const r = await fetch(apiUrl('/api/catalogues'), { headers: authHeaders() });
      const d = (await r.json().catch(() => ({}))) as { catalogues?: { id: string }[] };
      let id = d.catalogues?.[0]?.id;
      if (!id) {
        const c = await fetch(apiUrl('/api/catalogues'), { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name: 'Designs' }) });
        const cd = (await c.json().catch(() => ({}))) as { catalogue?: { id: string } };
        id = cd.catalogue?.id;
      }
      catalogueRef.current = id ?? null;
      return catalogueRef.current;
    } catch {
      return null;
    }
  }, [authHeaders]);

  const failFrom = (status: number, d: { error?: string; needed?: number }): string => {
    if (status === 402) return `Not enough credits${d.needed ? ` — need ${d.needed}` : ''}. Top up in Account.`;
    if (status === 401) return 'Sign in to create designs.';
    return d.error || 'That didn’t work — try rephrasing.';
  };

  const generate = useCallback(
    async (prompt: string) => {
      if (!token) { setError('Sign in to create designs.'); setPhase('error'); return; }
      setPhase('busy');
      setError(null);
      setLine('Working on it…');
      const catalogueId = await resolveCatalogue();
      try {
        const r = await fetch(apiUrl('/api/generate'), {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ prompt, catalogueId, background: 'filled', aspectRatio: '1:1' }),
        });
        const d = (await r.json().catch(() => ({}))) as { image?: string; id?: string; error?: string; needed?: number };
        if (!r.ok || !d.image || !d.id) throw new Error(failFrom(r.status, d));
        const design = { id: d.id, url: d.image, prompt };
        stackRef.current = [design];
        setCurrent(design);
        setPhase('ready');
        setLine('Here you go. Tell me a tweak, or open it up to edit yourself.');
        // Let her actually LOOK at it — she's live underneath this overlay. Only on a SETTLED
        // design (never mid-generation), so it costs one image (~$0.004), not a stream.
        showEve({
          url: design.url,
          note: `(This is the design you just made for them, from: "${prompt}". You can SEE it — react in one short sentence: what works, and one thing you'd change. Then ask if they want it on a product.)`,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Generation failed');
        setPhase(current ? 'ready' : 'error');
      }
    },
    [token, authHeaders, resolveCatalogue, current],
  );

  const edit = useCallback(
    async (instruction: string) => {
      if (!current || !token) return;
      const catalogueId = catalogueRef.current;
      if (!catalogueId) return;
      setPhase('busy');
      setError(null);
      setLine('On it…');
      try {
        const r = await fetch(apiUrl('/api/edit'), {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ designId: current.id, catalogueId, instruction, mode: 'custom', background: 'filled' }),
        });
        const d = (await r.json().catch(() => ({}))) as { image?: string; id?: string; prompt?: string; error?: string; needed?: number };
        if (!r.ok || !d.image || !d.id) throw new Error(failFrom(r.status, d));
        const design = { id: d.id, url: d.image, prompt: d.prompt ?? `Edit — ${instruction.slice(0, 60)}` };
        stackRef.current = [...stackRef.current, design];
        setCurrent(design);
        setPhase('ready');
        setLine('Done. Another tweak, or keep it?');
        showEve({
          url: design.url,
          note: `(They asked for: "${instruction}". This is the RESULT — you can see it. Say in one short sentence whether that landed, then invite the next tweak or offer to put it on a product.)`,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Edit failed');
        setPhase('ready');
      }
    },
    [current, token, authHeaders],
  );

  // Generate the opening idea once (if one arrived with the intent).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      await resolveCatalogue();
      if (idea?.trim()) void generate(idea.trim());
      else setPhase('idle');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = () => {
    const t = input.trim();
    if (!t || phase === 'busy') return;
    setInput('');
    if (current) void edit(t);
    else void generate(t);
  };

  // Undo the last iteration (revert to the prior design in the local stack).
  const undo = () => {
    if (stackRef.current.length < 2) return;
    stackRef.current = stackRef.current.slice(0, -1);
    setCurrent(stackRef.current[stackRef.current.length - 1]);
    setLine('Reverted. What next?');
  };

  const openInDesign = () => {
    if (!current) return;
    sendDesignCommand({ kind: 'open-editor', designId: current.id });
    onHandoff();
  };
  const keepOnCanvas = () => {
    if (!current) return;
    sendDesignCommand({ kind: 'show-design', designId: current.id });
    onHandoff();
  };

  const busy = phase === 'busy';
  const canAct = phase === 'ready' && !!current;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.fill, { paddingTop: insets.top + Spacing.four, paddingBottom: insets.bottom + Spacing.three }]}>
      <View style={styles.headerRow}>
        <ThemedText type="code" style={[styles.eyebrow, { color: p.dim }]}>EVE · DESIGN</ThemedText>
        <View style={{ flex: 1 }} />
        {canAct && stackRef.current.length > 1 ? (
          <Pressable onPress={undo} hitSlop={10} accessibilityLabel="Undo last edit">
            <ThemedText type="code" style={{ color: p.dim, fontSize: 14 }}>↶ undo</ThemedText>
          </Pressable>
        ) : null}
        <Pressable onPress={onExit} hitSlop={10} accessibilityLabel="Back to Eve">
          <ThemedText type="code" style={{ color: p.dim, fontSize: 14, marginLeft: Spacing.three }}>‹ back</ThemedText>
        </Pressable>
      </View>

      {/* The design, center stage. */}
      <View style={styles.stage}>
        {current ? (
          <Image source={{ uri: current.url }} style={styles.image} contentFit="contain" />
        ) : (
          <VenusBubble active speaking={busy} size={120} />
        )}
        {busy ? (
          <View style={styles.busyVeil}>
            <ActivityIndicator color="#dff4ff" />
          </View>
        ) : null}
      </View>

      {/* Eve's line + her presence. */}
      <View style={styles.captionRow}>
        {current ? <VenusBubble active speaking={busy} size={44} /> : null}
        <ThemedText style={[styles.line, { color: p.ink }]} numberOfLines={2}>{line}</ThemedText>
      </View>
      {error ? (
        <ThemedText type="code" style={styles.error} numberOfLines={2}>{error}</ThemedText>
      ) : null}

      {/* Keep / open-in-Design when there's a design to act on. */}
      {canAct ? (
        <View style={styles.actions}>
          <Pressable onPress={keepOnCanvas} style={[styles.action, { borderColor: `${p.dim}66` }]} hitSlop={6}>
            <ThemedText type="code" style={{ color: p.dim }}>✓ Keep</ThemedText>
          </Pressable>
          <Pressable onPress={openInDesign} style={[styles.action, styles.actionPrimary, glow(p.accent, 12, 0.4)]} hitSlop={6}>
            <ThemedText type="smallBold" style={{ color: BG }}>Open in Design ›</ThemedText>
          </Pressable>
        </View>
      ) : null}

      {/* The instruction line — the idea (idle) or the next tweak (ready). */}
      <View style={styles.inputRow}>
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={submit}
          editable={!busy}
          placeholder={current ? 'Describe a tweak — “bigger type, night sky”' : 'Describe the design — “a chrome skull tee”'}
          placeholderTextColor={`${p.dim}99`}
          returnKeyType="send"
          style={[styles.input, { color: p.ink, backgroundColor: 'rgba(12,18,26,0.7)', borderColor: `${p.dim}44` }]}
        />
        <Pressable onPress={submit} disabled={busy || !input.trim()} style={[styles.send, { backgroundColor: p.accent, opacity: busy || !input.trim() ? 0.5 : 1 }]}>
          <ThemedText type="smallBold" style={{ color: BG }}>{current ? `✦ ${EDIT_COST}` : '✦'}</ThemedText>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, paddingHorizontal: Spacing.four },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  eyebrow: { letterSpacing: 3 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', marginVertical: Spacing.three },
  image: { width: '100%', height: '100%' },
  busyVeil: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,7,11,0.4)' },
  captionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: 48 },
  line: { flex: 1, fontSize: 15, lineHeight: 21, fontFamily: 'Jost-Regular' },
  error: { color: '#ff8a8a', marginTop: 4 },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  action: { flex: 1, borderWidth: 1, borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center' },
  actionPrimary: { borderWidth: 0 },
  inputRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center', marginTop: Spacing.three },
  input: { flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, paddingHorizontal: Spacing.three, fontFamily: 'Jost-Regular' },
  send: { width: 56, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
