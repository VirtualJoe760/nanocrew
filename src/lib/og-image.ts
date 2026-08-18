import { v2 as cloudinary } from 'cloudinary';

// The brand's OG / share image AND its avatar in the app (dashboard, Market): the logo
// over the brand's background colour with a one-line tagline. Built as a Cloudinary
// transformation of the existing logo — deterministic text (no garbled AI), rendered
// on-demand and CDN-cached, so a brand needs no website to have a clean visual.

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/** Pull the Cloudinary public_id out of a delivery URL (strip host, /upload/, version, ext). */
function publicIdFromUrl(url: string): string | null {
  const m = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/);
  return m ? m[1] : null;
}

function hex(input: string | null | undefined, fallback: string): string {
  const h = (input ?? '').replace('#', '').trim();
  return /^[0-9a-fA-F]{6}$/.test(h) ? h.toLowerCase() : fallback;
}

/**
 * A 1200×630 OG card: logo centred on the brand background, tagline beneath.
 * Returns null when there's no logo to build from (caller renders a text fallback).
 */
export function buildOgImageUrl(opts: {
  logoUrl: string | null;
  tagline: string | null;
  bgHex?: string | null;
  textHex?: string | null;
}): string | null {
  if (!opts.logoUrl) return null;
  const publicId = publicIdFromUrl(opts.logoUrl);
  if (!publicId) return null;

  const bg = hex(opts.bgHex, '0b0b0f');
  const text = hex(opts.textHex, 'ffffff');
  const tagline = (opts.tagline ?? '').trim().slice(0, 80);

  const transformation: Record<string, unknown>[] = [
    { effect: 'trim' }, // crop away the logo's surrounding whitespace
    // Constrain WIDTH too — a wide wordmark used to span the full 1200 and touch the card's edges
    // (Joe's rule, 2026-08-17: nothing runs full width; content always gets breathing room).
    { width: 1000, height: 190, crop: 'fit' },
    // c_lpad pads WITHOUT enlarging (c_pad would scale the small logo up to fill).
    { width: 1200, height: 630, crop: 'lpad', background: `rgb:${bg}`, gravity: 'north', y: 150 },
  ];
  if (tagline) {
    transformation.push({
      overlay: { font_family: 'Arial', font_size: 46, font_weight: 'bold', text: tagline },
      color: `#${text}`,
      gravity: 'south',
      y: 120,
      width: 940,
      crop: 'fit',
    });
  }
  return cloudinary.url(publicId, { secure: true, transformation, format: 'png' });
}
