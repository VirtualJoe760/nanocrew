import { generateLogo, type LogoBrief } from '@/lib/logo';

// THE BRAND'S LOGO KIT — the full asset set a real identity ships with, built from exactly TWO
// AI generations (the only stochastic surface):
//   wordmark master  — 16:9 canvas → auto-crop, transparent (navbar/hero lockup)
//   icon-mark master — 1:1, transparent (favicon/avatar/app-tile source)
// Everything else is a DETERMINISTIC Cloudinary URL transform on those masters — derived, cached
// by Cloudinary, zero extra storage and zero model roulette:
//   mono variants — e_colorize flattens the art to one color, alpha preserved (merch/embroidery,
//                   dark-photo overlays)
//   app tile      — icon mark centered at ~65% on a brand-background 1024² (Apple wants opaque)
//   touch icon    — same fill treatment at 180² (iOS blackens transparent touch icons)
//   favicon       — transparent 64² pad of the icon mark (never the wordmark — a name at 16px is mush)
// Lockups are NOT prebuilt: templates compose icon+name in HTML, and the OG card (og-image.ts)
// remains the composed share asset.

export type LogoKit = {
  /** Transparent wide wordmark master (may be absent if that generation failed). */
  wordmark: string | null;
  /** Transparent square icon-mark master. */
  mark: string | null;
  /** One-color variants of the masters — alpha preserved. */
  mono: {
    wordmarkLight: string | null;
    wordmarkDark: string | null;
    markLight: string | null;
    markDark: string | null;
  };
  /** Filled 1024² brand-background tile (app icon / avatar). */
  appTile: string | null;
  /** Filled 180² apple-touch-icon. */
  touchIcon: string | null;
  /** Transparent 64² favicon source. */
  favicon: string | null;
};

/** Insert a Cloudinary transform into a delivery URL (the printful.ts / eve-vision-bus idiom). */
function tx(url: string | null, transform: string): string | null {
  if (!url || !url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;
  return url.replace('/upload/', `/upload/${transform}/`);
}

const hex = (h: string) => h.replace('#', '').toLowerCase();

/** Derive the full kit from whatever masters exist. Pure — safe to re-run on any stored masters. */
export function deriveKit(
  wordmark: string | null,
  mark: string | null,
  backgroundHex: string,
): LogoKit {
  const bg = hex(backgroundHex || '#ffffff');
  // favicon/tile source: the icon mark; a wordmark is used only if the mark generation failed.
  const square = mark ?? wordmark;
  return {
    wordmark,
    mark,
    mono: {
      wordmarkLight: tx(wordmark, 'e_colorize,co_rgb:ffffff'),
      wordmarkDark: tx(wordmark, 'e_colorize,co_rgb:0b0b0c'),
      markLight: tx(mark, 'e_colorize,co_rgb:ffffff'),
      markDark: tx(mark, 'e_colorize,co_rgb:0b0b0c'),
    },
    appTile: tx(square, `c_fit,w_660,h_660/c_lpad,w_1024,h_1024,b_rgb:${bg}`),
    touchIcon: tx(square, `c_fit,w_116,h_116/c_lpad,w_180,h_180,b_rgb:${bg}`),
    favicon: tx(square, 'c_fit,w_64,h_64/c_lpad,w_64,h_64'),
  };
}

/** Generate both masters in parallel (each with its own backdrop-validation retry), then derive.
 *  Null only when BOTH generations fail — a partial kit beats none, and curation shows the holes. */
export async function generateLogoKit(brief: LogoBrief, folder = 'nanocrew/logos'): Promise<LogoKit | null> {
  const [wordmark, mark] = await Promise.all([
    generateLogo(brief, folder, 'wordmark'),
    generateLogo(brief, folder, 'mark'),
  ]);
  if (!wordmark && !mark) return null;
  const background =
    brief.designSystem.palette.find((p) => p.role.toLowerCase().includes('background'))?.hex ?? '#ffffff';
  return deriveKit(wordmark?.url ?? null, mark?.url ?? null, background);
}
