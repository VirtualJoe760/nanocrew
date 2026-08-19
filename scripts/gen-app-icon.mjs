// Generate the Nano Crew app icon set — EVE'S CONSTELLATION GLYPH, rendered from vectors.
//
// This replaced the raster neon-Venus pipeline on 2026-08-16 (Joe's signoff: variant B,
// "atmospheric" — brighter glow + her starfield). The geometry below MIRRORS
// src/components/eve/eve-glyph.tsx (same NODES/MIDS/nucleus in the same 120-space) so the icon is
// literally her in-app mark; if the glyph component changes, change it here too. Being SVG-sourced,
// every slot regenerates pixel-perfect at any size:
//   node scripts/gen-app-icon.mjs
// Writes: images/icon.png (iOS, 1024) · brand/app-icon-1024.png (App Store) · images/favicon.png ·
// android adaptive foreground/background/monochrome · images/splash-icon.png · brand/eve-boot.png
// (the launch loader portrait, 1024x1536 — animated-icon.tsx + the expo-splash-screen plugin).
import fs from 'node:fs/promises';
import sharp from 'sharp';

const IMG = new URL('../assets/images/', import.meta.url);
const BRAND = new URL('../assets/brand/', import.meta.url);
// Public copies. Email clients can't read a repo and won't render SVG, so the two raster assets the
// OUTSIDE world needs — the masthead mark in every Nano Crew email, and the profile photo shown
// beside the sender — are written straight into the site's public dir and served from nanocrew.app.
const SITE = new URL('../nanocrew-site/public/brand/', import.meta.url);
const p = (dir, file) => new URL(file, dir).pathname;

const NET = '#7fd7e6', CORE = '#eaf4f9', BG = '#08080a';
// eve-glyph.tsx geometry, verbatim.
const NODES = [[30,32],[92,26],[102,64],[82,98],[50,104],[22,82],[16,48],[70,18]];
const MIDS = [[45,46],[80,52],[66,82]];

function glyph({ lineW, lineOp, nodeR }) {
  let s = `<circle cx="60" cy="60" r="58" fill="url(#glow)"/>`;
  for (const [x, y] of NODES) s += `<line x1="60" y1="60" x2="${x}" y2="${y}" stroke="${NET}" stroke-opacity="${lineOp}" stroke-width="${lineW}"/>`;
  for (const [x, y] of NODES) s += `<circle cx="${x}" cy="${y}" r="${nodeR}" fill="${NET}" fill-opacity="0.85"/>`;
  for (const [x, y] of MIDS) s += `<circle cx="${x}" cy="${y}" r="${nodeR * 0.7}" fill="${NET}" fill-opacity="0.6"/>`;
  s += `<circle cx="60" cy="60" r="11" fill="${CORE}" fill-opacity="0.12"/>`;
  s += `<circle cx="60" cy="60" r="7" fill="${CORE}"/>`;
  s += `<circle cx="60" cy="60" r="11" fill="none" stroke="${NET}" stroke-width="${lineW}" stroke-opacity="0.7"/>`;
  return s;
}
const defs = (glowOp) => `<defs><radialGradient id="glow" cx="50%" cy="50%" r="50%">
  <stop offset="0%" stop-color="${NET}" stop-opacity="${glowOp}"/>
  <stop offset="55%" stop-color="${NET}" stop-opacity="${glowOp * 0.3}"/>
  <stop offset="100%" stop-color="${NET}" stop-opacity="0"/>
</radialGradient></defs>`;

// Her starfield — seeded so every regeneration is identical.
function stars(seed, n, size, w, h) {
  let s = '', x = seed;
  const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < n; i++) {
    const px = rnd() * w, py = rnd() * h, r = size * (0.4 + rnd()), o = 0.10 + rnd() * 0.28;
    s += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r.toFixed(2)}" fill="${NET}" fill-opacity="${o.toFixed(2)}"/>`;
  }
  return s;
}

// Variant B, as signed off: scale 0.78, weights 1.15/0.62/2.2, glow 0.5, starfield on.
const B = { scale: 0.78, weights: { lineW: 1.15, lineOp: 0.62, nodeR: 2.2 }, glowOp: 0.5 };

function iconSVG({ transparentBg = false, monochrome = false, scale = B.scale } = {}) {
  const size = 1024 * scale, off = (1024 - size) / 2;
  const g = monochrome
    ? glyph(B.weights).replaceAll(NET, '#ffffff').replaceAll(CORE, '#ffffff').replace(/url\(#glow\)/, 'none')
    : glyph(B.weights);
  return `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${monochrome ? '' : defs(B.glowOp)}
  ${transparentBg ? '' : `<rect width="1024" height="1024" fill="${BG}"/>`}
  ${transparentBg || monochrome ? '' : stars(7, 90, 2.2, 1024, 1024)}
  <g transform="translate(${off},${off}) scale(${size / 120})">${g}</g>
</svg>`;
}

const render = (svg) => sharp(Buffer.from(svg)).png();

// iOS app icon + App Store marketing icon (opaque, full-bleed) + web favicon.
await render(iconSVG()).toFile(p(IMG, 'icon.png'));
await render(iconSVG()).toFile(p(BRAND, 'app-icon-1024.png'));
await render(iconSVG()).resize(196, 196).toFile(p(IMG, 'favicon.png'));

// Android adaptive: the glyph alone (transparent, scaled into the safe zone), a flat dark
// background layer, and a white monochrome layer for themed icons.
await render(iconSVG({ transparentBg: true, scale: 0.6 })).toFile(p(IMG, 'android-icon-foreground.png'));
await render(`<svg width="1024" height="1024"><rect width="1024" height="1024" fill="${BG}"/></svg>`).toFile(p(IMG, 'android-icon-background.png'));
await render(iconSVG({ transparentBg: true, monochrome: true, scale: 0.6 })).toFile(p(IMG, 'android-icon-monochrome.png'));

// Splash icon (kept for any splash config that wants the small centered mark).
await render(iconSVG({ transparentBg: true })).resize(420, 420).toFile(p(IMG, 'splash-icon.png'));

// The launch loader portrait (1024x1536): glyph riding upper-center over her starfield. Replaces
// the Venus portrait in animated-icon.tsx and the expo-splash-screen plugin.
const boot = `<svg width="1024" height="1536" viewBox="0 0 1024 1536" xmlns="http://www.w3.org/2000/svg">
  ${defs(0.45)}
  <rect width="1024" height="1536" fill="${BG}"/>
  ${stars(11, 150, 2, 1024, 1536)}
  <g transform="translate(212,468) scale(${600 / 120})">${glyph({ lineW: 1.1, lineOp: 0.55, nodeR: 2.1 })}</g>
</svg>`;
await render(boot).toFile(p(BRAND, 'eve-boot.png'));

// Play Store listing icon.
await render(iconSVG()).resize(512, 512).toFile(p(BRAND, 'play-store-icon-512.png'));


// ── Outward-facing raster ──────────────────────────────────────────────────────────────────────
// Email masthead mark (240 = 2× its 120px display box, so it stays crisp on retina) and the profile
// photo (512) used as the sender avatar. Both are the SAME glyph, so they can never drift from the
// app icon the way the retired nc-icon.png did (Joe, 2026-08-19: "it has our old app icon").
await fs.mkdir(new URL('.', SITE), { recursive: true });
await render(iconSVG()).resize(240, 240).toFile(p(SITE, 'nanocrew-mark.png'));
await render(iconSVG()).resize(512, 512).toFile(p(SITE, 'nanocrew-avatar.png'));

console.log('✓ Eve icon set generated (variant B) — icon, favicon, android adaptive, splash, boot, play-store, email mark + avatar');
