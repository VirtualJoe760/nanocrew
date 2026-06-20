// Branded transactional-email layout for the Nano Crew email pipeline.
//
// One shared, inline-styled, table-based HTML shell (≤600px — the email-client reality) that every
// lifecycle email renders into. Each brand's mail matches its storefront: name + logo + colors are
// LIVE-READ from the brand-identity cascade (stores.name / stores.logo_url / stores.site_config),
// passed in by the caller — this module never queries the DB. A consistent Nano Crew footer
// ("Sent by Nano Crew on behalf of {brand}") anchors every send. See docs/accounts/EMAIL_PIPELINE.md.

/**
 * The brand surface an email renders against — a thin live-read slice of the cascade. Callers pass
 * `stores.name` + `stores.logoUrl` + the `stores.siteConfig` colors map (or a subset); this module
 * resolves sensible defaults so an under-configured brand still produces a clean, on-brand email.
 */
export type EmailStore = {
  slug: string;
  name: string;
  logoUrl?: string | null;
  /** Live mini-CMS colors (stores.site_config.colors) — free-form key→hex; common keys resolved below. */
  colors?: Record<string, string | undefined> | null;
};

type Palette = {
  /** Page/canvas behind the card. */
  page: string;
  /** Card background. */
  card: string;
  /** Primary text. */
  ink: string;
  /** Muted/secondary text. */
  muted: string;
  /** Accent — header bar, links, CTA button. */
  accent: string;
  /** Text color that reads on top of `accent`. */
  onAccent: string;
  /** Hairline rules. */
  line: string;
};

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
function pick(colors: EmailStore['colors'], keys: string[], fallback: string): string {
  if (!colors) return fallback;
  for (const k of keys) {
    const v = colors[k]?.trim();
    if (v && HEX.test(v)) return v;
  }
  return fallback;
}

/**
 * Resolve a brand palette from the free-form mini-CMS colors map. Color keys are not standardized
 * across templates (the editor stores whatever the template exposes), so we probe the common aliases
 * and fall back to a clean Nano Crew monochrome so an unconfigured brand still looks intentional.
 */
function paletteFor(store: EmailStore): Palette {
  const accent = pick(store.colors, ['accent', 'primary', 'brand', 'cta', 'link'], '#111111');
  return {
    page: pick(store.colors, ['pageBg', 'page', 'canvas'], '#f4f4f5'),
    card: pick(store.colors, ['cardBg', 'card', 'surface', 'bg', 'background'], '#ffffff'),
    ink: pick(store.colors, ['ink', 'text', 'foreground', 'fg'], '#18181b'),
    muted: pick(store.colors, ['muted', 'subtle', 'secondary'], '#71717a'),
    accent,
    onAccent: pick(store.colors, ['onAccent', 'accentText'], '#ffffff'),
    line: pick(store.colors, ['line', 'border', 'hairline'], '#e4e4e7'),
  };
}

/** Minimal HTML escaping for interpolated brand/user text (subjects + body strings). */
export function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type EmailCta = { label: string; url: string };

/**
 * The shared branded shell. `body` is trusted HTML the caller assembles from the helpers below
 * (paragraph/list builders that escape their inputs); `heading`, brand name, and the optional CTA
 * label are escaped here. Returns a full, standalone HTML document safe for any email client.
 */
export function renderEmail(opts: {
  store: EmailStore;
  heading: string;
  /** Pre-built, already-escaped inner HTML (use the `p`/`ul`/`muted` helpers below). */
  body: string;
  cta?: EmailCta;
  /** Short preview/preheader line shown in the inbox list (hidden in the body). */
  preheader?: string;
}): string {
  const { store, heading, body, cta, preheader } = opts;
  const p = paletteFor(store);
  const brand = esc(store.name || 'Nano Crew');
  const logo = store.logoUrl && /^https?:\/\//.test(store.logoUrl) ? store.logoUrl : null;

  const header = logo
    ? `<img src="${esc(logo)}" alt="${brand}" height="40" style="display:block;max-height:40px;border:0;outline:none;text-decoration:none;" />`
    : `<span style="font-size:20px;font-weight:700;letter-spacing:0.3px;color:${p.onAccent};">${brand}</span>`;

  const ctaHtml = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px;">
         <tr><td style="border-radius:8px;background:${p.accent};">
           <a href="${esc(cta.url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:${p.onAccent};text-decoration:none;border-radius:8px;">${esc(cta.label)}</a>
         </td></tr>
       </table>`
    : '';

  const pre = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">${esc(preheader)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
</head>
<body style="margin:0;padding:0;background:${p.page};">
${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${p.page};">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${p.card};border:1px solid ${p.line};border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
      <tr><td style="background:${p.accent};padding:20px 28px;">${header}</td></tr>
      <tr><td style="padding:28px;color:${p.ink};">
        <h1 style="margin:0 0 14px;font-size:22px;line-height:1.25;font-weight:700;color:${p.ink};">${esc(heading)}</h1>
        ${body}
        ${ctaHtml}
      </td></tr>
      <tr><td style="padding:18px 28px;border-top:1px solid ${p.line};">
        <p style="margin:0;font-size:12px;line-height:1.5;color:${p.muted};">Sent by Nano Crew on behalf of ${brand}.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

// ── Body builders (escape their inputs; emit palette-agnostic markup so renderEmail owns color) ──

/** A paragraph. `html` lets a caller embed an already-built inline element (e.g. a tracking link). */
export function p(text: string, opts?: { muted?: boolean; html?: boolean }): string {
  const color = opts?.muted ? '#71717a' : 'inherit';
  const content = opts?.html ? text : esc(text);
  return `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:${color};">${content}</p>`;
}

/** A bulleted list of order items (or any strings). */
export function ul(items: string[]): string {
  if (!items.length) return '';
  const lis = items.map((i) => `<li style="margin:0 0 4px;">${esc(i)}</li>`).join('');
  return `<ul style="margin:0 0 14px;padding-left:20px;font-size:15px;line-height:1.5;">${lis}</ul>`;
}

/** Format integer cents as a USD string (e.g. 4299 → "$42.99"). */
export function money(cents: number, currency = 'USD'): string {
  const n = (Math.round(cents) / 100).toFixed(2);
  const sym = currency.toUpperCase() === 'USD' ? '$' : '';
  return sym ? `${sym}${n}` : `${n} ${currency.toUpperCase()}`;
}

/** An inline link, escaped. */
export function link(label: string, url: string): string {
  return `<a href="${esc(url)}" style="color:inherit;font-weight:600;">${esc(label)}</a>`;
}
