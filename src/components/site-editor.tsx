import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { apiUrl } from '@/lib/api';
import { type StudioPalette, useStudioPalette } from '@/lib/studio-palette';

// The mini-CMS: change a brand site's words, colors, and fonts directly — instant, no forge run and
// no rebuild. Writes to /api/creator/site-config; the storefront reads it live. This is the DIRECT
// path (precise, deterministic). Open-ended redesigns still go through the Venus chat in the console.

type SiteConfig = {
  copy?: Record<string, string>;
  colors?: Record<string, string>;
  fonts?: { display?: string; body?: string };
};

const TEXT_FIELDS: { key: string; label: string; hint: string; multiline?: boolean }[] = [
  { key: 'heroHeadline', label: 'Hero headline', hint: 'The big line at the top' },
  { key: 'heroSubline', label: 'Hero subline', hint: 'One supporting sentence' },
  { key: 'heroCta', label: 'Hero button', hint: 'e.g. Shop the collection' },
  { key: 'storyKicker', label: 'Story label', hint: 'e.g. Our story' },
  { key: 'story', label: 'Story', hint: 'A short paragraph in your voice', multiline: true },
  { key: 'tagline', label: 'Tagline', hint: 'Shows in the browser tab + meta' },
];

const COLOR_FIELDS: { key: string; label: string }[] = [
  { key: 'background', label: 'Background' },
  { key: 'text', label: 'Text' },
  { key: 'primary', label: 'Primary / buttons' },
  { key: 'accent', label: 'Accent' },
];

// Same preset keys the templates map to font stacks (lib/site-config.ts FONT_PRESETS).
const FONTS: { key: string; label: string }[] = [
  { key: 'sans', label: 'Sans' },
  { key: 'serif', label: 'Serif' },
  { key: 'inter', label: 'Inter' },
  { key: 'grotesk', label: 'Grotesk' },
  { key: 'playfair', label: 'Playfair' },
  { key: 'fraunces', label: 'Fraunces' },
  { key: 'mono', label: 'Mono' },
];

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function SiteEditor({
  visible,
  onClose,
  token,
  slug,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  token: string;
  slug: string;
  onSaved?: () => void;
}) {
  const pal = useStudioPalette();
  const styles = useMemo(() => makeStyles(pal), [pal]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copy, setCopy] = useState<Record<string, string>>({});
  const [colors, setColors] = useState<Record<string, string>>({});
  const [fonts, setFonts] = useState<{ display?: string; body?: string }>({});

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    setLoading(true);
    setNote(null);
    try {
      const r = await fetch(apiUrl(`/api/creator/site-config?store=${encodeURIComponent(slug)}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = (await r.json()) as { config?: SiteConfig };
      setCopy(d.config?.copy ?? {});
      setColors(d.config?.colors ?? {});
      setFonts(d.config?.fonts ?? {});
    } catch {
      setNote('Could not load your current settings.');
    } finally {
      setLoading(false);
    }
  }, [slug, token]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const save = async () => {
    // Validate any colors that were typed (empty = keep current).
    for (const f of COLOR_FIELDS) {
      const v = colors[f.key]?.trim();
      if (v && !HEX.test(v)) {
        setNote(`${f.label} needs a hex color like #1a1a1a.`);
        return;
      }
    }
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch(apiUrl('/api/creator/site-config'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ storeSlug: slug, copy, colors, fonts }),
      });
      if (!res.ok) throw new Error();
      setNote('Saved — live on your site now. Reload the site to see it.');
      onSaved?.();
    } catch {
      setNote('Could not save — try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <ThemedText type="subtitle" style={styles.title} numberOfLines={1}>Customize site</ThemedText>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose} hitSlop={12}>
              <ThemedText type="code" style={styles.dim}>close ✕</ThemedText>
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator style={styles.center} color={pal.accent} />
          ) : (
            <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
              <ThemedText type="small" style={styles.dim}>
                Exact edits, applied instantly — no rebuild. Leave a field blank to keep what&apos;s there.
                For a bigger redesign, chat with Venus in the console.
              </ThemedText>

              {/* TEXT */}
              <ThemedText type="code" style={styles.sectionLabel}>TEXT</ThemedText>
              {TEXT_FIELDS.map((f) => (
                <View key={f.key} style={styles.field}>
                  <ThemedText type="code" style={styles.fieldLabel}>{f.label}</ThemedText>
                  <TextInput
                    style={[styles.input, f.multiline && styles.multiline]}
                    placeholder={f.hint}
                    placeholderTextColor={pal.dim}
                    value={copy[f.key] ?? ''}
                    onChangeText={(t) => setCopy((c) => ({ ...c, [f.key]: t }))}
                    multiline={f.multiline}
                  />
                </View>
              ))}

              {/* COLORS */}
              <ThemedText type="code" style={[styles.sectionLabel, { marginTop: Spacing.four }]}>COLORS</ThemedText>
              {COLOR_FIELDS.map((f) => {
                const v = colors[f.key]?.trim() ?? '';
                const valid = HEX.test(v);
                return (
                  <View key={f.key} style={styles.colorRow}>
                    <View style={[styles.swatch, valid ? { backgroundColor: v } : styles.swatchEmpty]} />
                    <ThemedText type="small" style={[styles.white, { flex: 1 }]}>{f.label}</ThemedText>
                    <TextInput
                      style={[styles.input, styles.hexInput]}
                      placeholder="#hex"
                      placeholderTextColor={pal.dim}
                      autoCapitalize="none"
                      autoCorrect={false}
                      value={colors[f.key] ?? ''}
                      onChangeText={(t) => setColors((c) => ({ ...c, [f.key]: t }))}
                    />
                  </View>
                );
              })}

              {/* FONTS */}
              <ThemedText type="code" style={[styles.sectionLabel, { marginTop: Spacing.four }]}>FONTS</ThemedText>
              {(['display', 'body'] as const).map((slot) => (
                <View key={slot} style={styles.field}>
                  <ThemedText type="code" style={styles.fieldLabel}>{slot === 'display' ? 'Headings' : 'Body'}</ThemedText>
                  <View style={styles.fontRow}>
                    {FONTS.map((ft) => {
                      const on = fonts[slot] === ft.key;
                      return (
                        <Pressable
                          key={ft.key}
                          onPress={() => setFonts((f) => ({ ...f, [slot]: on ? undefined : ft.key }))}
                          style={[styles.fontPill, on && styles.fontPillOn]}>
                          <ThemedText type="code" style={on ? { color: pal.onAccent } : styles.dim}>{ft.label}</ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}

              {note ? <ThemedText type="small" style={styles.note}>{note}</ThemedText> : null}

              <Pressable onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.5 }]}>
                <ThemedText type="smallBold" style={{ color: pal.onAccent }}>{saving ? 'Saving…' : 'Save changes'}</ThemedText>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function makeStyles(pal: StudioPalette) {
  return StyleSheet.create({
    fill: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
    sheet: { flex: 1, marginTop: Spacing.six, backgroundColor: pal.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: pal.line, overflow: 'hidden' },
    headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.four, paddingVertical: Spacing.four },
    title: { color: pal.ink },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.six },
    scroll: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
    sectionLabel: { color: pal.accent, letterSpacing: 1.5, fontSize: 11 },
    field: { gap: Spacing.one },
    fieldLabel: { color: pal.dim, fontSize: 11, letterSpacing: 0.5 },
    input: { borderWidth: 1, borderColor: pal.line, backgroundColor: pal.field, borderRadius: 10, padding: Spacing.three, color: pal.ink, fontSize: 15 },
    multiline: { minHeight: 96, textAlignVertical: 'top' },
    colorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
    swatch: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: pal.line },
    swatchEmpty: { backgroundColor: pal.card },
    hexInput: { width: 120, textAlign: 'center' },
    fontRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
    fontPill: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: 999, borderWidth: 1, borderColor: pal.line },
    fontPillOn: { backgroundColor: pal.accent, borderColor: pal.accent },
    saveBtn: { backgroundColor: pal.accent, borderRadius: 10, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.four },
    white: { color: pal.ink },
    dim: { color: pal.dim },
    note: { color: pal.accent, marginTop: Spacing.two },
  });
}
