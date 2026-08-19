import fs from 'node:fs/promises';
import path from 'node:path';

import { ImageResponse } from 'next/og';

// Social share card for nanocrew.app (1200×630). Rendered to PNG by next/og — edit the JSX to
// change it; no binary asset to manage. Next auto-wires this as og:image site-wide, and
// twitter-image.tsx re-exports it, so this one file is every share preview we have.
//
// It was still the retired identity until 2026-08-19: warm gold on near-black, Georgia, and the
// serif "NC" box that eve-mark.tsx replaced — against this unit's own rule (CLAUDE.md: "No gold,
// no warm neutrals"). It now uses the app's palette, Jost, and Eve's constellation.
export const alt = 'Nano Crew — speak your brand into existence';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Straight from app/globals.css, which takes them from src/constants/theme.ts.
const BG = '#08080a';
const TEXT = '#f4f4f6';
const DIM = '#8b909b';
const EVE = '#7fd7e6';
const EDGE = '#212127';

// The SAME geometry as app/eve-mark.tsx, src/components/eve/eve-glyph.tsx and
// scripts/gen-app-icon.mjs. Change the glyph in one, change it in all.
const NODES: [number, number][] = [
  [30, 32], [92, 26], [102, 64], [82, 98], [50, 104], [22, 82], [16, 48], [70, 18],
];
const MIDS: [number, number][] = [[45, 46], [80, 52], [66, 82]];

/** Satori needs real font bytes — it has no access to the CSS the browser would use. */
async function jost(weight: 400 | 500) {
  const file = weight === 500 ? 'Jost-Medium.ttf' : 'Jost-Regular.ttf';
  return fs.readFile(path.join(process.cwd(), 'app/fonts', file));
}

export default async function OpengraphImage() {
  const [regular, medium] = await Promise.all([jost(400), jost(500)]);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: BG,
          color: TEXT,
          fontFamily: 'Jost',
        }}
      >
        {/* Lockup — the constellation, at the size it reads at */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <svg width={92} height={92} viewBox="0 0 120 120">
            {NODES.map(([x, y], i) => (
              <line key={`l${i}`} x1={60} y1={60} x2={x} y2={y} stroke={EVE} strokeOpacity={0.62} strokeWidth={2.6} />
            ))}
            {NODES.map(([x, y], i) => (
              <circle key={`n${i}`} cx={x} cy={y} r={4.6} fill={EVE} fillOpacity={0.85} />
            ))}
            {MIDS.map(([x, y], i) => (
              <circle key={`m${i}`} cx={x} cy={y} r={3.1} fill={EVE} fillOpacity={0.6} />
            ))}
            <circle cx={60} cy={60} r={13} fill="#eaf4f9" fillOpacity={0.14} />
            <circle cx={60} cy={60} r={8} fill="#eaf4f9" />
            <circle cx={60} cy={60} r={13} fill="none" stroke={EVE} strokeWidth={2.4} strokeOpacity={0.7} />
          </svg>
          <div style={{ fontSize: 27, letterSpacing: 11, color: TEXT }}>NANO CREW</div>
        </div>

        {/* Headline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ fontSize: 21, letterSpacing: 7, color: EVE }}>AI-NATIVE CREATOR COMMERCE</div>
          <div style={{ fontSize: 86, fontWeight: 500, lineHeight: 1.04, letterSpacing: -1.5, maxWidth: 940 }}>
            Speak your brand into existence.
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            borderTop: `1px solid ${EDGE}`,
            paddingTop: 26,
          }}
        >
          <div style={{ fontSize: 25, color: DIM, maxWidth: 780, lineHeight: 1.45 }}>
            A conversation becomes a real clothing brand — shop, site, and content, generated for you.
          </div>
          <div style={{ fontSize: 25, color: TEXT }}>nanocrew.app</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Jost', data: regular, weight: 400, style: 'normal' },
        { name: 'Jost', data: medium, weight: 500, style: 'normal' },
      ],
    },
  );
}
