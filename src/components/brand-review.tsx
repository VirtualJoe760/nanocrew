import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';

import { GradientSlider } from '@/components/gradient-slider';
import { type Palette } from '@/components/nc-screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { HUE_STOPS, hexToHsl, hslToHex } from '@/lib/color';
import type { BrandResult } from '@/lib/interview';

// The editable "BRAND COMPILED" review shown before Create my store. The creator can tweak the
// name, tagline, story and palette, and pick a different website template — all in place. Edits
// mutate the BrandResult via onChange, so they flow straight into createStore (no API changes).

type DesignStyle = BrandResult['designStyle'];

const TEMPLATES: { key: DesignStyle; label: string; tag: string }[] = [
  { key: 'minimalist', label: 'Minimal', tag: 'clean · airy' },
  { key: 'bold', label: 'Bold', tag: 'loud · graphic' },
  { key: 'elegant', label: 'Elegant', tag: 'refined' },
  { key: 'extravagant', label: 'Extravagant', tag: 'maximal' },
  { key: 'street', label: 'Street', tag: 'full-bleed' },
];

type Resolved = { background: string; text: string; primary: string; accent: string; secondary: string };

function resolveColors(palette: { role: string; hex: string }[]): Resolved {
  const byRole = (r: string, fb: string) =>
    palette.find((e) => e.role?.toLowerCase().includes(r))?.hex ?? fb;
  const primary = byRole('primary', palette[0]?.hex ?? '#8a8d94');
  const accent = byRole('accent', primary);
  return {
    background: byRole('background', '#0c0c0e'),
    text: byRole('text', '#f4f4f6'),
    primary,
    accent,
    secondary: byRole('secondary', accent),
  };
}

export function BrandReview({
  brand,
  onChange,
  onCreate,
  creating,
  created,
  onFinished,
  logoUrl,
  p,
  bg,
}: {
  brand: BrandResult;
  onChange: (b: BrandResult) => void;
  onCreate: () => void;
  creating: boolean;
  created: string | null;
  onFinished: () => void;
  logoUrl: string | null;
  p: Palette;
  bg: string;
}) {
  const [pickRole, setPickRole] = useState<number | null>(null);
  const s = makeStyles(p);
  const colors = resolveColors(brand.designSystem.palette);

  const patch = (u: Partial<BrandResult>) => onChange({ ...brand, ...u });
  const setColor = (i: number, hex: string) =>
    onChange({
      ...brand,
      designSystem: {
        ...brand.designSystem,
        palette: brand.designSystem.palette.map((e, idx) => (idx === i ? { ...e, hex } : e)),
      },
    });

  return (
    <ScrollView style={s.fill} contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <ThemedText type="code" style={s.eyebrow}>{'// BRAND COMPILED · tap any field to edit'}</ThemedText>
      {logoUrl ? <Image source={{ uri: logoUrl }} style={s.logo} contentFit="cover" /> : null}

      {/* NAME */}
      <ThemedText type="code" style={s.label}>NAME</ThemedText>
      <TextInput
        value={brand.name}
        onChangeText={(t) => patch({ name: t })}
        editable={!created}
        style={[s.input, s.nameInput, { color: p.ink }]}
        placeholder="Brand name"
        placeholderTextColor={p.faint}
      />

      {/* TAGLINE */}
      <ThemedText type="code" style={s.label}>TAGLINE</ThemedText>
      <TextInput
        value={brand.tagline}
        onChangeText={(t) => patch({ tagline: t })}
        editable={!created}
        style={[s.input, { color: p.dim }]}
        placeholder="Short tagline"
        placeholderTextColor={p.faint}
      />

      {/* PALETTE */}
      <ThemedText type="code" style={s.label}>PALETTE</ThemedText>
      <View style={s.paletteRow}>
        {brand.designSystem.palette.map((c, i) => (
          <Pressable key={`${c.role}-${i}`} style={s.swatchCol} onPress={() => !created && setPickRole(pickRole === i ? null : i)}>
            <View style={[s.swatch, { backgroundColor: c.hex, borderColor: pickRole === i ? p.accent : p.line }]} />
            <ThemedText type="code" style={s.swatchLabel}>{c.role}</ThemedText>
          </Pressable>
        ))}
      </View>
      {pickRole !== null ? (() => {
        const cur = brand.designSystem.palette[pickRole];
        const hsl = hexToHsl(cur.hex) ?? { h: 210, s: 60, l: 50 };
        const set = (q: Partial<typeof hsl>) =>
          setColor(pickRole, hslToHex(q.h ?? hsl.h, q.s ?? hsl.s, q.l ?? hsl.l));
        return (
          <View style={s.pickerBox}>
            <View style={s.pickerHead}>
              <ThemedText type="code" style={s.pickerTitle}>{cur.role.toUpperCase()}</ThemedText>
              <TextInput
                value={cur.hex}
                onChangeText={(t) => setColor(pickRole, t)}
                autoCapitalize="none"
                autoCorrect={false}
                style={[s.input, s.hexInput, { color: p.ink }]}
              />
            </View>
            <ThemedText type="code" style={s.pickerCue}>Hue</ThemedText>
            <GradientSlider id={`r-h`} stops={HUE_STOPS} value={hsl.h / 360} onChange={(t) => set({ h: Math.round(t * 360) })} />
            <ThemedText type="code" style={s.pickerCue}>Saturation</ThemedText>
            <GradientSlider id={`r-s`} stops={[hslToHex(hsl.h, 0, hsl.l), hslToHex(hsl.h, 100, hsl.l)]} value={hsl.s / 100} onChange={(t) => set({ s: Math.round(t * 100) })} />
            <ThemedText type="code" style={s.pickerCue}>Brightness</ThemedText>
            <GradientSlider id={`r-l`} stops={['#000000', hslToHex(hsl.h, hsl.s, 50), '#ffffff']} value={hsl.l / 100} onChange={(t) => set({ l: Math.round(t * 100) })} />
          </View>
        );
      })() : null}

      {/* VIBE (read-only) */}
      {brand.vibeKeywords?.length ? (
        <View style={s.chipsRow}>
          {brand.vibeKeywords.map((k) => (
            <View key={k} style={[s.chip, { borderColor: p.line }]}>
              <ThemedText type="code" style={s.chipText}>{k}</ThemedText>
            </View>
          ))}
        </View>
      ) : null}

      {/* STORY */}
      <ThemedText type="code" style={s.label}>STORY</ThemedText>
      <TextInput
        value={brand.story}
        onChangeText={(t) => patch({ story: t })}
        editable={!created}
        multiline
        style={[s.input, s.storyInput, { color: p.dim }]}
        placeholder="Your brand story"
        placeholderTextColor={p.faint}
      />

      {/* TEMPLATE PICKER */}
      <ThemedText type="code" style={s.label}>WEBSITE TEMPLATE</ThemedText>
      <ThemedText type="code" style={s.templateHint}>Tap a style — your site is built from this template.</ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.templateRow}>
        {TEMPLATES.map((t) => {
          const selected = brand.designStyle === t.key;
          return (
            <Pressable key={t.key} disabled={!!created} onPress={() => patch({ designStyle: t.key })} style={[s.templateCard, { borderColor: selected ? p.accent : p.line }]}>
              <View style={s.mockFrame}>{renderMock(t.key, colors)}</View>
              <View style={s.templateMeta}>
                <ThemedText type="smallBold" style={{ color: selected ? p.ink : p.dim }}>{t.label}</ThemedText>
                {selected ? <ThemedText type="code" style={[s.tick, { color: p.accent }]}>✓</ThemedText> : null}
              </View>
              <ThemedText type="code" style={s.templateTag}>{t.tag}</ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* CREATE / CREATED */}
      {created ? (
        <>
          <View style={[s.createBtn, s.createdBox]}>
            <ThemedText type="code" style={s.green}>{'> store online · @' + created}</ThemedText>
            <ThemedText type="small" style={{ color: p.dim }}>Head to Design to start your first drop.</ThemedText>
          </View>
          <Pressable onPress={onFinished}>
            <View style={s.createBtn}><ThemedText type="smallBold" style={{ color: bg }}>Finished — view my brands</ThemedText></View>
          </Pressable>
        </>
      ) : (
        <Pressable onPress={onCreate} disabled={creating}>
          <View style={[s.createBtn, { opacity: creating ? 0.5 : 1 }]}>
            {creating ? <ActivityIndicator color={bg} /> : <ThemedText type="smallBold" style={{ color: bg }}>Create my store</ThemedText>}
          </View>
        </Pressable>
      )}
    </ScrollView>
  );
}

// A small brand-colored wireframe per template style — recognizable silhouettes, painted live with
// the creator's own palette so switching templates is a real preview, not a label.
function renderMock(style: DesignStyle, c: Resolved) {
  const bar = (color: string, w: number, h = 6, mt = 4, op = 1, radius = 3) => (
    <View style={{ width: `${w}%`, height: h, marginTop: mt, borderRadius: radius, backgroundColor: color, opacity: op }} />
  );
  switch (style) {
    case 'minimalist':
      return (
        <View style={[mock.fill, { backgroundColor: c.background, alignItems: 'center', justifyContent: 'center', padding: 12 }]}>
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: c.text, opacity: 0.85 }} />
          {bar(c.text, 46, 5, 12)}
          {bar(c.text, 30, 4, 4, 0.5)}
          <View style={{ width: 30, height: 30, marginTop: 16, borderWidth: 1, borderColor: c.text, opacity: 0.4 }} />
        </View>
      );
    case 'bold':
      return (
        <View style={[mock.fill, { backgroundColor: c.background }]}>
          <View style={{ height: '46%', backgroundColor: c.primary, justifyContent: 'flex-end', padding: 8 }}>
            {bar(c.background, 78, 11, 0)}
            {bar(c.background, 54, 11, 4)}
          </View>
          <View style={{ flexDirection: 'row', padding: 8, gap: 6 }}>
            <View style={{ flex: 1, height: 34, backgroundColor: c.secondary }} />
            <View style={{ flex: 1, height: 34, backgroundColor: c.accent }} />
          </View>
          <View style={{ marginHorizontal: 8, height: 12, backgroundColor: c.accent }} />
        </View>
      );
    case 'elegant':
      return (
        <View style={[mock.fill, { backgroundColor: c.background, alignItems: 'center', paddingTop: 18, paddingHorizontal: 14 }]}>
          <View style={{ width: 28, height: 1, backgroundColor: c.accent }} />
          {bar(c.text, 52, 4, 12, 0.9)}
          {bar(c.text, 36, 3, 5, 0.5)}
          <View style={{ width: 34, height: 40, marginTop: 14, borderWidth: 1, borderColor: c.accent, opacity: 0.6 }} />
          <View style={{ width: 40, height: 1, backgroundColor: c.accent, marginTop: 14, opacity: 0.7 }} />
        </View>
      );
    case 'extravagant':
      return (
        <View style={[mock.fill, { backgroundColor: c.background, overflow: 'hidden' }]}>
          <View style={{ position: 'absolute', top: 10, left: -10, width: 70, height: 70, borderRadius: 16, backgroundColor: c.primary, opacity: 0.95 }} />
          <View style={{ position: 'absolute', top: 36, right: -12, width: 64, height: 64, borderRadius: 32, backgroundColor: c.accent, opacity: 0.9 }} />
          <View style={{ position: 'absolute', bottom: 14, left: 14, width: 26, height: 26, borderRadius: 13, backgroundColor: c.secondary }} />
          <View style={{ position: 'absolute', bottom: 36, left: 12, right: 12 }}>
            {bar(c.text, 60, 6, 0)}
            {bar(c.text, 40, 5, 5, 0.6)}
          </View>
        </View>
      );
    case 'street':
      return (
        <View style={[mock.fill, { backgroundColor: c.primary, overflow: 'hidden' }]}>
          <View style={{ flexDirection: 'row', backgroundColor: c.accent, paddingVertical: 4, marginTop: 14, gap: 6, paddingHorizontal: 4 }}>
            {[0, 1, 2, 3, 4, 5].map((i) => <View key={i} style={{ width: 10, height: 4, backgroundColor: c.background }} />)}
          </View>
          <View style={{ position: 'absolute', bottom: 30, left: 8 }}>
            {bar(c.background, 70, 13, 0)}
            {bar(c.background, 46, 13, 4)}
          </View>
          <View style={{ position: 'absolute', bottom: 8, right: 8, width: 30, height: 22, backgroundColor: c.secondary }} />
        </View>
      );
  }
}

const mock = StyleSheet.create({ fill: { flex: 1 } });

function makeStyles(p: Palette) {
  return StyleSheet.create({
    fill: { flex: 1 },
    scroll: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, paddingTop: Spacing.three },
    eyebrow: { color: p.faint, letterSpacing: 1, marginBottom: Spacing.three },
    logo: { width: 72, height: 72, borderRadius: 16, marginBottom: Spacing.three },
    label: { color: p.faint, letterSpacing: 1, marginTop: Spacing.four, marginBottom: Spacing.one, fontSize: 11 },
    input: { borderWidth: 1, borderColor: p.line, borderRadius: 10, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 15 },
    nameInput: { fontSize: 22, fontWeight: '700' },
    storyInput: { minHeight: 96, textAlignVertical: 'top', lineHeight: 20 },
    paletteRow: { flexDirection: 'row', gap: 10 },
    swatchCol: { alignItems: 'center', flex: 1 },
    swatch: { width: '100%', height: 44, borderRadius: 8, borderWidth: 2 },
    swatchLabel: { color: p.faint, fontSize: 9, marginTop: 4, letterSpacing: 0.5 },
    pickerBox: { marginTop: Spacing.three, borderWidth: 1, borderColor: p.line, borderRadius: 12, padding: Spacing.three, gap: 4 },
    pickerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.two },
    pickerTitle: { color: p.dim, letterSpacing: 1 },
    hexInput: { width: 104, textAlign: 'center', paddingVertical: 4 },
    pickerCue: { color: p.faint, fontSize: 10, marginTop: 6 },
    chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: Spacing.three },
    chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    chipText: { color: p.dim, fontSize: 11 },
    templateHint: { color: p.faint, fontSize: 11, marginBottom: Spacing.two },
    templateRow: { gap: 12, paddingVertical: 4, paddingRight: Spacing.four },
    templateCard: { width: 132, borderWidth: 2, borderRadius: 14, padding: 8, backgroundColor: p.bgTop },
    mockFrame: { width: '100%', height: 150, borderRadius: 8, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: p.line },
    templateMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
    tick: { fontSize: 13, fontWeight: '700' },
    templateTag: { color: p.faint, fontSize: 10, marginTop: 1 },
    createBtn: { backgroundColor: p.accent, borderRadius: 12, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.five },
    createdBox: { backgroundColor: 'transparent', borderWidth: 1, borderColor: p.line, alignItems: 'flex-start', paddingHorizontal: Spacing.three, gap: 4 },
    green: { color: '#7bd88f', fontSize: 12 },
  });
}
