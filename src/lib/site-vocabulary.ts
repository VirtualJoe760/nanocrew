// THE site component vocabulary — Nano Crew's plain-English names for the parts of a brand
// storefront, what each part IS, and concrete ways a creator can adjust it. Venus uses this in the
// live-site critique view (lib/live-voice.ts `critiqueInstruction`) to TEACH: a creator circles
// something, asks "what's this / I don't know what it's called / help me with this section", and
// Venus names it in OUR vocabulary, explains it in a sentence, and offers a few adjustment ideas.
//
// This is the user-facing explanation layer (app-side). It complements — and will eventually align
// with — the declarative `components.json` block manifest in docs/storefront/COMPONENT_SYSTEM.md
// (still design-only). Keep the `key`s in sync with template `data-block` values + the image-slot
// vocabulary in docs/storefront/IMAGE_TARGETS.md as those expand.

export type VocabEntry = {
  /** Stable id — matches a template `data-block` / image slot where one exists. */
  key: string;
  /** What WE call it, spoken naturally ("the Hero", "the Header / nav bar"). */
  name: string;
  /** One plain sentence: what this part of the site is, in a creator's words. */
  what: string;
  /** Concrete, do-able adjustments — what Venus offers as ideas. */
  adjust: string[];
};

export const SITE_VOCABULARY: VocabEntry[] = [
  {
    key: 'hero',
    name: 'the Hero',
    what: 'the big full-width banner at the very top of your homepage — usually a background image with your headline, a short sub-line, and a call-to-action button.',
    adjust: [
      'rewrite the headline or the sub-line',
      'swap the background image (generate a new one or upload yours)',
      'change the button text or where it links',
      'make it taller / full-screen or shorter',
      'darken the image so the text reads more clearly',
    ],
  },
  {
    key: 'header',
    name: 'the Header (your nav bar)',
    what: 'the bar across the very top with your logo on the left and your menu links; it usually sticks to the top as you scroll.',
    adjust: [
      'change the nav-bar colour',
      'swap or resize the logo',
      'add, remove, or rename the menu links',
      'show or hide the cart icon',
    ],
  },
  {
    key: 'logo',
    name: 'your Logo',
    what: 'your brand mark — it shows in the header, the footer, and as your browser-tab icon.',
    adjust: ['generate a new logo', 'upload your own', 'make it bigger or smaller in the header'],
  },
  {
    key: 'announcement',
    name: 'the Announcement bar',
    what: 'the thin strip above the header for a single line — a promo, free-shipping note, or a launch message.',
    adjust: ['change the message', 'change its colours', 'turn it on or off', 'link it to a page'],
  },
  {
    key: 'story',
    name: 'the Story / About section',
    what: 'the block that tells your brand story — usually a kicker, a paragraph or two, and sometimes a photo.',
    adjust: ['rewrite the story (or let Venus draft it)', 'change the heading/kicker', 'add or swap the photo', 'move it higher or lower on the page'],
  },
  {
    key: 'products',
    name: 'the Product grid',
    what: 'the gallery of your products — each one a photo with its name and price that links to its own page.',
    adjust: [
      'change how many columns show',
      'reorder or feature specific products',
      'swap a product’s photo (in the Design center)',
      'show a different collection here',
    ],
  },
  {
    key: 'product-card',
    name: 'a Product card',
    what: 'one product in the grid — its photo, name, and price.',
    adjust: ['swap its photo', 'rename it or change its price (in your Console)', 'feature it first'],
  },
  {
    key: 'collection',
    name: 'a Collection / Lookbook',
    what: 'a curated set of products or images grouped together — a drop, a season, or an editorial lookbook.',
    adjust: ['change the cover image', 'rename it', 'add or remove products', 'reorder the images'],
  },
  {
    key: 'cta',
    name: 'a Button (call-to-action)',
    what: 'a clickable button or link that sends a visitor somewhere — like “Shop”, “Add to cart”, or “Learn more”.',
    adjust: ['change the wording', 'change where it links', 'restyle it (colour, rounded vs square)'],
  },
  {
    key: 'footer',
    name: 'the Footer',
    what: 'the bottom strip of every page — usually your logo, navigation/social links, and the legal/policy links.',
    adjust: ['edit the links', 'add social handles', 'change its colour', 'edit the small print'],
  },
  {
    key: 'social',
    name: 'the Social share image',
    what: 'the preview card that shows when your site is shared on social or in a text (the 1200×630 image).',
    adjust: ['generate a new share image', 'upload your own', 'change the title/description that rides with it'],
  },
];

const BY_KEY = new Map(SITE_VOCABULARY.map((v) => [v.key, v]));

/** The minimal hit shape we resolve from (mirrors site-preview.tsx's hit-test `Hit`). */
export type VocabHit = {
  block?: string;
  nanoImage?: string;
  heading?: string;
  btnText?: string;
  btnTag?: string;
  img?: boolean;
  text?: string;
};

/** Resolve a circled hit → the best vocabulary entry, or null if we genuinely can't tell.
 *  Order = most specific first: explicit block → image slot → a button → heading keywords. */
export function vocabForHit(h: VocabHit): VocabEntry | null {
  // 1. An explicit data-block on the template (today: header/hero; more as tagging expands).
  if (h.block && BY_KEY.has(h.block)) return BY_KEY.get(h.block)!;
  // 2. An image with a known slot (IMAGE_TARGETS.md vocabulary).
  const ni = h.nanoImage || '';
  if (ni === 'hero') return BY_KEY.get('hero')!;
  if (ni === 'logo') return BY_KEY.get('logo')!;
  if (ni === 'og') return BY_KEY.get('social')!;
  if (ni.startsWith('product:')) return BY_KEY.get('product-card')!;
  if (ni.startsWith('section:')) return BY_KEY.get('story')!; // a content-section image
  // 3. A circled button/link is a call-to-action.
  if (h.btnText || h.btnTag) return BY_KEY.get('cta')!;
  // 4. Infer the section from the nearest heading's words.
  const hay = `${h.heading || ''} ${h.text || ''}`.toLowerCase();
  if (/\b(our )?story|about|who we are|mission/.test(hay)) return BY_KEY.get('story')!;
  if (/\bshop|products?|collection|drop|browse|all items|catalog/.test(hay)) return BY_KEY.get('products')!;
  if (/\bfooter|©|all rights|privacy|terms|policy/.test(hay)) return BY_KEY.get('footer')!;
  // 5. A bare image we couldn't slot → treat as the hero-ish main image.
  if (h.img) return BY_KEY.get('hero')!;
  return null;
}

/** A one-line context note the app pushes to Venus's live session the moment a circle closes, so she
 *  knows WHAT was pointed at before the creator finishes asking. Falls back to the raw label. */
export function venusContextForHit(h: VocabHit, fallbackLabel?: string | null): string {
  const v = vocabForHit(h);
  if (v) return `(The creator just circled ${v.name} on the page. If they ask what it is or for help, explain ${v.name} and suggest ways to adjust it.)`;
  if (fallbackLabel) return `(The creator just circled ${fallbackLabel}. If they ask, explain what it is and how they could change it.)`;
  return '(The creator just circled a spot on the page. If they ask what it is, ask them to describe it, then explain it and how they could change it.)';
}

/** Compact, prompt-embeddable rundown of the whole vocabulary — folded into Venus's critique
 *  instruction so she teaches consistent names + real adjustments without us re-listing them inline. */
export const VOCABULARY_BRIEF: string = SITE_VOCABULARY.map(
  (v) => `• ${v.name} — ${v.what} Ways to adjust: ${v.adjust.join('; ')}.`,
).join('\n');
