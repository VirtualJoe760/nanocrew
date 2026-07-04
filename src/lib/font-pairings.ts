import type { BrandResult } from '@/lib/interview';

// Per-brand FONT PAIRING selection — the missing link between the interview's typography intent
// and the storefront's live font system (docs/studio/FORGE_DIVERSITY.md, track 1).
//
// The templates already have a complete font pipeline: FONT_PRESETS in the templates repo
// (templates/_shared/lib/site-config.ts — ⚠ KEY SYNC POINT: every preset key used here MUST exist
// there, and street's lib/site-config.ts copy) → stores.site_config.fonts → live CSS vars, no
// rebuild. What never existed is a CHOOSER: provision never wrote fonts, so every brand shipped on
// the template default. This module picks a curated display/body pairing per brand:
//   • pairings are per designStyle (taste rails — no ransom-note combos),
//   • scored against the brand's vibeKeywords + typography descriptors,
//   • ties broken by a stable hash of the slug — two brands with the same vibe on the same
//     template still land on DIFFERENT pairings. Deterministic: same brand → same fonts.
// The creator can always override in Studio ✦ Customize (provision only writes when unset).

export type FontPairing = { display: string; body: string; tags: string[] };

// 6 sanctioned pairings per style. Keys reference FONT_PRESETS in the templates repo.
export const FONT_PAIRINGS: Record<string, FontPairing[]> = {
  minimalist: [
    { display: 'grotesk', body: 'inter', tags: ['modern', 'clean', 'tech', 'contemporary', 'grotesk'] },
    { display: 'manrope', body: 'work-sans', tags: ['soft', 'friendly', 'calm', 'approachable', 'round'] },
    { display: 'sora', body: 'inter', tags: ['geometric', 'precise', 'digital', 'future', 'sharp'] },
    { display: 'jost', body: 'work-sans', tags: ['bauhaus', 'timeless', 'neutral', 'architectural'] },
    { display: 'epilogue', body: 'manrope', tags: ['editorial', 'quiet', 'refined', 'studio'] },
    { display: 'plex-mono', body: 'inter', tags: ['technical', 'engineering', 'utilitarian', 'code', 'mono'] },
  ],
  bold: [
    { display: 'anton', body: 'inter', tags: ['loud', 'impact', 'athletic', 'strong', 'heavy'] },
    { display: 'archivo-black', body: 'work-sans', tags: ['poster', 'brutalist', 'punchy', 'black', 'grit'] },
    { display: 'bebas', body: 'barlow', tags: ['condensed', 'sport', 'energetic', 'tall', 'gym'] },
    { display: 'oswald', body: 'inter', tags: ['headline', 'classic', 'confident', 'press'] },
    { display: 'unbounded', body: 'manrope', tags: ['wide', 'futuristic', 'statement', 'techno', 'space'] },
    { display: 'montserrat', body: 'work-sans', tags: ['versatile', 'geometric', 'urban', 'friendly'] },
  ],
  elegant: [
    { display: 'playfair', body: 'lora', tags: ['classic', 'luxury', 'editorial', 'timeless', 'serif'] },
    { display: 'cormorant', body: 'crimson', tags: ['refined', 'romantic', 'fashion', 'delicate', 'soft'] },
    { display: 'fraunces', body: 'spectral', tags: ['warm', 'artisanal', 'boutique', 'character', 'craft'] },
    { display: 'dm-serif', body: 'work-sans', tags: ['chic', 'modern', 'sharp', 'city'] },
    { display: 'italiana', body: 'lora', tags: ['couture', 'graceful', 'italian', 'thin', 'atelier'] },
    { display: 'marcellus', body: 'crimson', tags: ['heritage', 'roman', 'calm', 'museum', 'antique'] },
  ],
  extravagant: [
    { display: 'unbounded', body: 'sora', tags: ['maximal', 'cosmic', 'futuristic', 'loud', 'rave'] },
    { display: 'syne', body: 'manrope', tags: ['artsy', 'avant', 'experimental', 'gallery', 'weird'] },
    { display: 'fraunces', body: 'epilogue', tags: ['expressive', 'funky', 'retro', 'warm', 'groovy'] },
    { display: 'bebas', body: 'inter', tags: ['dramatic', 'cinematic', 'marquee', 'night'] },
    { display: 'dm-serif', body: 'spectral', tags: ['opulent', 'glam', 'deco', 'gold', 'velvet'] },
    { display: 'archivo-black', body: 'sora', tags: ['massive', 'statement', 'brutal', 'luxe'] },
  ],
  street: [
    { display: 'anton', body: 'inter', tags: ['skate', 'loud', 'urban', 'classic', 'core'] },
    { display: 'oswald', body: 'barlow', tags: ['athletic', 'jersey', 'varsity', 'sport', 'team'] },
    { display: 'bebas', body: 'work-sans', tags: ['poster', 'tall', 'hype', 'drop'] },
    { display: 'archivo-black', body: 'archivo', tags: ['heavy', 'brutalist', 'underground', 'raw'] },
    { display: 'syne', body: 'inter', tags: ['experimental', 'techwear', 'future', 'avant'] },
    { display: 'plex-mono', body: 'archivo', tags: ['tech', 'utilitarian', 'cyber', 'mono', 'industrial'] },
  ],
};

/** Stable non-crypto hash (djb2) — the tie-breaker that spreads same-vibe brands across pairings. */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return Math.abs(h);
}

/**
 * Pick the brand's font pairing: score each of its style's pairings against the brand's own
 * words (vibeKeywords + the interview's typography descriptors), take the best, and break ties
 * with the slug hash. With no signal at all this degrades to pure hash rotation — which is the
 * point: variety is guaranteed even when the interview said nothing about type.
 */
export function pickFontPairing(brand: BrandResult, slug: string): { display: string; body: string } {
  const pool = FONT_PAIRINGS[brand.designStyle] ?? FONT_PAIRINGS.minimalist;
  const corpus = [
    ...(brand.vibeKeywords ?? []),
    brand.designSystem?.typography?.display ?? '',
    brand.designSystem?.typography?.body ?? '',
    brand.voice ?? '',
  ]
    .join(' ')
    .toLowerCase();
  let best: FontPairing[] = [];
  let bestScore = -1;
  for (const p of pool) {
    const score = p.tags.reduce((n, t) => (corpus.includes(t) ? n + 1 : n), 0);
    if (score > bestScore) {
      bestScore = score;
      best = [p];
    } else if (score === bestScore) {
      best.push(p);
    }
  }
  const pick = best[hash(slug) % best.length];
  return { display: pick.display, body: pick.body };
}
