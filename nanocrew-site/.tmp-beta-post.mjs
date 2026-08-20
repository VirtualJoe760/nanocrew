// Throwaway: renders the open-beta social post (1080×1920, 9:16) with the brand pipeline the share
// card uses — satori via next/og, Jost from app/fonts, Eve's constellation geometry verbatim.
// Not part of the site. Delete after use.
import fs from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og.js';

const OUT = process.argv[2] ?? '/tmp/nanocrew-beta-post.png';
const W = 1080, H = 1920;

// Palette — src/constants/theme.ts, as on every outward surface.
const BG = '#08080a';
const TEXT = '#f4f4f6';
const DIM = '#8b909b';
const EVE = '#7fd7e6';
const EDGE = '#212127';
const CORE = '#eaf4f9';

// eve-glyph.tsx geometry, verbatim (the four-surface contract in assets/brand/README.md).
const NODES = [[30,32],[92,26],[102,64],[82,98],[50,104],[22,82],[16,48],[70,18]];
const MIDS = [[45,46],[80,52],[66,82]];

// Her starfield — same seeded generator as scripts/gen-app-icon.mjs, so it's *her* sky.
function stars(seed, n, size, w, h) {
  const out = [];
  let x = seed;
  const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < n; i++) {
    const px = rnd() * w, py = rnd() * h, r = size * (0.4 + rnd()), o = 0.10 + rnd() * 0.28;
    out.push(el('circle', { cx: px.toFixed(1), cy: py.toFixed(1), r: r.toFixed(2), fill: EVE, fillOpacity: o.toFixed(2) }));
  }
  return out;
}

// satori accepts plain {type, props} elements — no React needed.
function el(type, props = {}, ...children) {
  const kids = children.flat().filter((c) => c !== null && c !== undefined);
  return { type, props: { ...props, children: kids.length === 1 ? kids[0] : kids } };
}

function glyphSvg(px, { lineW = 1.3, nodeR = 2.6, glow = true } = {}) {
  return el(
    'svg',
    { width: px, height: px, viewBox: '0 0 120 120' },
    glow
      ? el('defs', {},
          el('radialGradient', { id: 'glow', cx: '50%', cy: '50%', r: '50%' },
            el('stop', { offset: '0%', stopColor: EVE, stopOpacity: 0.34 }),
            el('stop', { offset: '55%', stopColor: EVE, stopOpacity: 0.10 }),
            el('stop', { offset: '100%', stopColor: EVE, stopOpacity: 0 })))
      : null,
    glow ? el('circle', { cx: 60, cy: 60, r: 58, fill: 'url(#glow)' }) : null,
    NODES.map(([x, y]) => el('line', { x1: 60, y1: 60, x2: x, y2: y, stroke: EVE, strokeOpacity: 0.62, strokeWidth: lineW })),
    NODES.map(([x, y]) => el('circle', { cx: x, cy: y, r: nodeR, fill: EVE, fillOpacity: 0.85 })),
    MIDS.map(([x, y]) => el('circle', { cx: x, cy: y, r: nodeR * 0.7, fill: EVE, fillOpacity: 0.6 })),
    el('circle', { cx: 60, cy: 60, r: 12, fill: CORE, fillOpacity: 0.13 }),
    el('circle', { cx: 60, cy: 60, r: 7.5, fill: CORE }),
    el('circle', { cx: 60, cy: 60, r: 12, fill: 'none', stroke: EVE, strokeWidth: lineW, strokeOpacity: 0.7 }),
  );
}

async function jost(file) {
  return fs.readFile(path.join(process.cwd(), 'app/fonts', file));
}

const [light, regular, medium] = await Promise.all([
  jost('Jost-Light.ttf'), jost('Jost-Regular.ttf'), jost('Jost-Medium.ttf'),
]);

// Story-safe padding: IG overlays its own UI in roughly the top and bottom ~250px of a 9:16 frame,
// so the lockup and footer sit inside that margin and everything that must be read sits between.
const card = el(
  'div',
  { style: {
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      justifyContent: 'space-between', padding: '190px 92px 210px', background: BG,
      color: TEXT, fontFamily: 'Jost', position: 'relative',
    } },
  // Her sky, behind everything.
  el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, style: { position: 'absolute', top: 0, left: 0 } },
    stars(7, 150, 1.7, W, H)),

  // Lockup
  el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 } },
    glyphSvg(72, { glow: false, lineW: 2.6, nodeR: 4.6 }),
    el('div', { style: { fontSize: 26, letterSpacing: 12 } }, 'NANO CREW')),

  // Centerpiece — the constellation at size, then the ask.
  el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center' } },
    glyphSvg(470),
    el('div', { style: { fontSize: 28, letterSpacing: 13, color: EVE, marginTop: 18 } }, 'OPEN BETA'),
    el('div', { style: {
        fontSize: 88, fontWeight: 500, lineHeight: 1.1, letterSpacing: -1.5,
        textAlign: 'center', maxWidth: 880, marginTop: 30, display: 'flex',
      } },
      'Speak your brand into existence.'),
    el('div', { style: {
        fontSize: 33, fontWeight: 300, color: DIM, textAlign: 'center', maxWidth: 800,
        lineHeight: 1.5, marginTop: 32, display: 'flex',
      } },
      'Talk to Eve. She builds your clothing brand — the products, the shop, and its own website.')),

  // CTA
  el('div', { style: { display: 'flex', flexDirection: 'column' } },
    el('div', { style: { display: 'flex', justifyContent: 'center', marginBottom: 52 } },
      el('div', { style: {
          display: 'flex', background: EVE, color: BG, fontSize: 32, fontWeight: 500,
          letterSpacing: 1, padding: '25px 58px', borderRadius: 999,
        } },
        'Register free at nanocrew.app')),
    el('div', { style: {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderTop: `1px solid ${EDGE}`, paddingTop: 28,
      } },
      el('div', { style: { fontSize: 25, color: DIM, display: 'flex' } }, 'iPhone & Android · limited beta slots'),
      el('div', { style: { fontSize: 25, color: TEXT, display: 'flex' } }, 'nanocrew.app'))),
);

const res = new ImageResponse(card, {
  width: W, height: H,
  fonts: [
    { name: 'Jost', data: light, weight: 300, style: 'normal' },
    { name: 'Jost', data: regular, weight: 400, style: 'normal' },
    { name: 'Jost', data: medium, weight: 500, style: 'normal' },
  ],
});
await fs.writeFile(OUT, Buffer.from(await res.arrayBuffer()));
console.log('wrote', OUT);
