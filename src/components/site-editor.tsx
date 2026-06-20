import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { GradientSlider } from '@/components/gradient-slider';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { apiUrl, readJson } from '@/lib/api';
import { HEX, HUE_STOPS, hexToHsl, hslToHex } from '@/lib/color';
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
  { key: 'nav', label: 'Nav bar' }, // falls back to Background on the site if left blank
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

// Color helpers + the draggable gradient bar are shared with the brand-review picker.

export function SiteEditor({
  visible,
  onClose,
  token,
  slug,
  brandName,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  token: string;
  slug: string;
  brandName?: string;
  onSaved?: (renamedTo?: string) => void;
}) {
  const pal = useStudioPalette();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(pal), [pal]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [name, setName] = useState(''); // the brand name (stores.name) — saved via the store PATCH
  const [copy, setCopy] = useState<Record<string, string>>({});
  const [colors, setColors] = useState<Record<string, string>>({});
  const [fonts, setFonts] = useState<{ display?: string; body?: string }>({});
  const [enhancing, setEnhancing] = useState<string | null>(null); // which text field is being enhanced
  const [pickerField, setPickerField] = useState<string | null>(null); // which color field's swatch grid is open

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    setLoading(true);
    setNote(null);
    try {
      const r = await fetch(apiUrl(`/api/creator/site-config?store=${encodeURIComponent(slug)}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await readJson<{
        config?: SiteConfig;
        defaults?: { colors?: Record<string, string>; copy?: Record<string, string> };
      }>(r);
      // Open pre-filled with the brand's CURRENT values: baked defaults first, any saved override
      // on top. So the creator edits from what's live, not a blank form. (Fonts are override-only —
      // the baked font lives in the template, so a blank picker = "the site default".)
      setCopy({ ...(d.defaults?.copy ?? {}), ...(d.config?.copy ?? {}) });
      setColors({ ...(d.defaults?.colors ?? {}), ...(d.config?.colors ?? {}) });
      setFonts(d.config?.fonts ?? {});
    } catch {
      setNote('Could not load your current settings.');
    } finally {
      setLoading(false);
    }
  }, [slug, token]);

  useEffect(() => {
    if (visible) {
      setName(brandName ?? '');
      void load();
    }
  }, [visible, brandName, load]);

  // ✦ Enhance one text field — AI rewrites/writes it in the brand voice, then drops it back in.
  const enhance = async (field: string) => {
    if (enhancing) return;
    setEnhancing(field);
    setNote(null);
    try {
      const res = await fetch(apiUrl('/api/creator/enhance-copy'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ storeSlug: slug, field, value: copy[field] ?? '' }),
      });
      const d = (await res.json()) as { enhanced?: string; error?: string };
      if (res.status === 429) { setNote('Slow down a moment — enhance is rate-limited.'); return; }
      if (!res.ok || !d.enhanced) throw new Error(d.error ?? 'failed');
      setCopy((c) => ({ ...c, [field]: d.enhanced! }));
    } catch {
      setNote('Could not enhance that — try again.');
    } finally {
      setEnhancing(null);
    }
  };

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
      // Brand name lives on the store record (not site-config) — PATCH it if it changed. A name
      // change cascades on the backend: it clears the old logo (it baked the old name) and rewrites
      // the site's brand.json so it rebuilds with the new name.
      const trimmed = name.trim();
      let renamed = false;
      if (trimmed && trimmed !== (brandName ?? '')) {
        const nr = await fetch(apiUrl(`/api/creator/stores/${slug}`), { method: 'PATCH', headers, body: JSON.stringify({ name: trimmed }) });
        if (!nr.ok) throw new Error();
        renamed = true;
      }
      const res = await fetch(apiUrl('/api/creator/site-config'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ storeSlug: slug, copy, colors, fonts }),
      });
      if (!res.ok) throw new Error();
      setNote(
        renamed
          ? 'Saved. Renamed to ' + trimmed + ' everywhere. Your old logo was removed (it showed the old name) — remake it in the Design tab or ask Venus. Your site is rebuilding now.'
          : 'Saved — live on your site now. Reload the site to see it.',
      );
      onSaved?.(renamed ? trimmed : undefined);
    } catch {
      setNote('Could not save — try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView style={styles.fill} edges={['top']}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <ThemedText type="subtitle" style={styles.title} numberOfLines={1}>Site Options</ThemedText>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose} hitSlop={12}>
              <ThemedText type="code" style={styles.dim}>close ✕</ThemedText>
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator style={styles.center} color={pal.accent} />
          ) : (
            <ScrollView
              style={styles.fillFlex}
              contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.six }]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              automaticallyAdjustKeyboardInsets>
              <ThemedText type="small" style={styles.dim}>
                Your site&apos;s current text, colors &amp; fonts — edit any of them. Changes apply
                instantly, no rebuild. For a bigger redesign, chat with Venus in the console.
              </ThemedText>

              {/* TEXT */}
              <ThemedText type="code" style={styles.sectionLabel}>TEXT</ThemedText>
              <View style={styles.field}>
                <View style={styles.fieldHead}>
                  <ThemedText type="code" style={styles.fieldLabel}>Brand name</ThemedText>
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="Your brand name"
                  placeholderTextColor={pal.dim}
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                />
              </View>
              {TEXT_FIELDS.map((f) => (
                <View key={f.key} style={styles.field}>
                  <View style={styles.fieldHead}>
                    <ThemedText type="code" style={styles.fieldLabel}>{f.label}</ThemedText>
                    <Pressable onPress={() => enhance(f.key)} disabled={!!enhancing} hitSlop={6}>
                      {enhancing === f.key ? (
                        <ActivityIndicator size="small" color={pal.accent} />
                      ) : (
                        <ThemedText type="code" style={[styles.enhance, !!enhancing && { opacity: 0.4 }]}>✦ Enhance</ThemedText>
                      )}
                    </Pressable>
                  </View>
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
                const open = pickerField === f.key;
                return (
                  <View key={f.key}>
                    <View style={styles.colorRow}>
                      <Pressable onPress={() => setPickerField(open ? null : f.key)} hitSlop={6}>
                        <View style={[styles.swatch, valid ? { backgroundColor: v } : styles.swatchEmpty]} />
                      </Pressable>
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
                      <Pressable onPress={() => setPickerField(open ? null : f.key)} hitSlop={6}>
                        <ThemedText type="code" style={styles.enhance}>{open ? 'close' : 'pick'}</ThemedText>
                      </Pressable>
                    </View>
                    {open ? (() => {
                      const hsl = hexToHsl(v) ?? { h: 210, s: 60, l: 50 };
                      const set = (patch: Partial<typeof hsl>) =>
                        setColors((p) => ({ ...p, [f.key]: hslToHex(patch.h ?? hsl.h, patch.s ?? hsl.s, patch.l ?? hsl.l) }));
                      return (
                        <View style={styles.pickerBox}>
                          <ThemedText type="code" style={styles.pickerCue}>Hue</ThemedText>
                          <GradientSlider id={`${f.key}-h`} stops={HUE_STOPS} value={hsl.h / 360} onChange={(t) => set({ h: Math.round(t * 360) })} />
                          <ThemedText type="code" style={styles.pickerCue}>Saturation</ThemedText>
                          <GradientSlider id={`${f.key}-s`} stops={[hslToHex(hsl.h, 0, hsl.l), hslToHex(hsl.h, 100, hsl.l)]} value={hsl.s / 100} onChange={(t) => set({ s: Math.round(t * 100) })} />
                          <ThemedText type="code" style={styles.pickerCue}>Brightness</ThemedText>
                          <GradientSlider id={`${f.key}-l`} stops={['#000000', hslToHex(hsl.h, hsl.s, 50), '#ffffff']} value={hsl.l / 100} onChange={(t) => set({ l: Math.round(t * 100) })} />
                        </View>
                      );
                    })() : null}
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
    fillFlex: { flex: 1 },
    sheet: { flex: 1, marginTop: Spacing.six, backgroundColor: pal.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: pal.line, overflow: 'hidden' },
    headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.four, paddingVertical: Spacing.four },
    title: { color: pal.ink },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.six },
    scroll: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
    sectionLabel: { color: pal.accent, letterSpacing: 1.5, fontSize: 11 },
    field: { gap: Spacing.one },
    fieldHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 20 },
    fieldLabel: { color: pal.dim, fontSize: 11, letterSpacing: 0.5 },
    enhance: { color: pal.accent, fontSize: 11, letterSpacing: 0.5 },
    input: { borderWidth: 1, borderColor: pal.line, backgroundColor: pal.field, borderRadius: 10, padding: Spacing.three, color: pal.ink, fontSize: 15 },
    multiline: { minHeight: 96, textAlignVertical: 'top' },
    colorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
    swatch: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: pal.line },
    swatchEmpty: { backgroundColor: pal.card },
    hexInput: { width: 96, textAlign: 'center' },
    pickerBox: { gap: 4, paddingVertical: Spacing.two, paddingLeft: 40 },
    pickerCue: { color: pal.dim, fontSize: 10, letterSpacing: 0.5 },
    fontRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
    fontPill: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: 999, borderWidth: 1, borderColor: pal.line },
    fontPillOn: { backgroundColor: pal.accent, borderColor: pal.accent },
    saveBtn: { backgroundColor: pal.accent, borderRadius: 10, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.four },
    white: { color: pal.ink },
    dim: { color: pal.dim },
    note: { color: pal.accent, marginTop: Spacing.two },
  });
}
