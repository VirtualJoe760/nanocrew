import { ImageResponse } from 'next/og';

// Social share card for nanocrew.app (1200×630). Rendered to PNG by next/og — edit the JSX
// to change it; no binary asset to manage. Next auto-wires this as og:image site-wide.
export const alt = 'Nano Crew — speak your brand into existence';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Brand palette (matches globals.css)
const INK = '#15130f';
const PAPER = '#faf8f3';
const GOLD = '#c9a86a';
const DIM = '#9a9384';

export default function OpengraphImage() {
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
          background: INK,
          color: PAPER,
          fontFamily: 'Georgia, serif',
        }}
      >
        {/* Logo lockup */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              width: 84,
              height: 84,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: `2px solid ${GOLD}`,
              borderRadius: 18,
              color: GOLD,
              fontSize: 42,
              fontWeight: 600,
            }}
          >
            NC
          </div>
          <div style={{ fontSize: 26, letterSpacing: 10, color: PAPER, fontFamily: 'sans-serif' }}>
            NANO CREW
          </div>
        </div>

        {/* Headline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ fontSize: 22, letterSpacing: 6, color: GOLD, fontFamily: 'sans-serif' }}>
            AI-NATIVE CREATOR COMMERCE
          </div>
          <div style={{ fontSize: 82, fontWeight: 600, lineHeight: 1.05, maxWidth: 920 }}>
            Speak your brand into existence.
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div style={{ fontSize: 26, color: DIM, fontFamily: 'sans-serif', maxWidth: 760, lineHeight: 1.4 }}>
            A conversation becomes a real clothing brand — shop, site, and content, generated for you.
          </div>
          <div style={{ fontSize: 26, color: PAPER, fontFamily: 'sans-serif' }}>nanocrew.app</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
