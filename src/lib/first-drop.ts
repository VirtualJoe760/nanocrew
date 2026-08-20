import { GoogleGenAI } from '@google/genai';
import { and, asc, eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// Server-side port of scripts/first-drop.mjs: from a provisioned brand's profile, Gemini
// invents on-brand print concepts → the design/composition/mockup/publish routes turn each
// into a live product in the store's first catalogue. Printable apparel only (tees/sweats).
//
// TWO DOORS, one pipeline (Joe, 2026-08-20):
//  · SILENT — generateFirstDrop() fire-and-forget on store creation, ONLY when AUTO_FIRST_DROP=1
//    (off by default: each run spends real Gemini + Printful money).
//  · EVE-GUIDED — the /api/creator/first-drop endpoints: `propose` returns the concepts so Eve
//    can pitch each one aloud, `create` builds ONE approved product per call. Same free-gift
//    internal identity, gift-gated by product count (docs/studio/BUILD_FLOW.md).

const BLANK = { tee: 71, sweatshirt: 380 } as const; // proven DTG blanks
const PRICE = { tee: 2899, sweatshirt: 4899 } as const;
const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];

type Garment = 'tee' | 'sweatshirt';
export interface FirstDropIdea {
  garment: Garment;
  name: string;
  prompt: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log('[first-drop]', ...a);

/** Whether auto-generation is switched on (off by default — it spends real money). */
export function autoFirstDropEnabled(): boolean {
  return process.env.AUTO_FIRST_DROP === '1';
}

/** The onboarding gift covers a store's first products only. */
export const GIFT_LIMIT = 4;

/** How many free first-drop products this store can still receive (0 = gift spent). */
export async function giftRemaining(storeId: string): Promise<number> {
  const products = await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(eq(schema.products.storeId, storeId))
    .limit(GIFT_LIMIT);
  return Math.max(0, GIFT_LIMIT - products.length);
}

/** The store fields both doors need, plus its first catalogue. Throws when missing. */
async function loadStore(storeId: string) {
  const [store] = await db
    .select({
      id: schema.stores.id,
      creatorId: schema.stores.creatorId,
      name: schema.stores.name,
      tagline: schema.stores.tagline,
      brandProfile: schema.stores.brandProfile,
      designSystem: schema.stores.designSystem,
    })
    .from(schema.stores)
    .where(eq(schema.stores.id, storeId))
    .limit(1);
  if (!store) throw new Error('store not found');
  const [cat] = await db
    .select({ id: schema.catalogues.id, name: schema.catalogues.name })
    .from(schema.catalogues)
    .where(eq(schema.catalogues.storeId, store.id))
    .orderBy(asc(schema.catalogues.createdAt))
    .limit(1);
  if (!cat) throw new Error('store has no catalogue');
  return { store, cat };
}

/** Gemini invents `count` palette-constrained print concepts for the brand's first drop.
 *  Pure proposal — no credits spent, nothing written. Eve pitches these aloud; the silent
 *  door feeds them straight into createFirstDropProduct. */
export async function proposeFirstDropIdeas(storeId: string, count = 4): Promise<FirstDropIdea[]> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('no Gemini API key');
  const n = Math.min(Math.max(count, 1), 6);
  const { store } = await loadStore(storeId);

  const profile = (store.brandProfile ?? {}) as {
    products?: string[];
    voice?: string;
    story?: string;
    vibeKeywords?: string[];
  };
  const ds = (store.designSystem ?? {}) as { palette?: { role: string; hex: string }[] };
  const palette = (ds.palette ?? []).map((p) => `${p.role}: ${p.hex}`).join(', ');
  const wantsSweats = /sweat|hoodie|crew/i.test((profile.products ?? []).join(' '));

  const ai = new GoogleGenAI({ apiKey });
  const ideaRes = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `You are the design director for the clothing brand "${store.name}".
Tagline: ${store.tagline}. Voice: ${profile.voice ?? ''}. Story: ${profile.story ?? ''}
Vibe: ${(profile.vibeKeywords ?? []).join(', ')}. Palette (use ONLY these colors): ${palette}.

Invent ${n} distinct print graphics for the brand's first drop${wantsSweats ? ' (mix of tees and sweatshirts)' : ' (tees)'}.
Reply with ONLY a JSON array, no markdown fences:
[{"garment": "tee" | "sweatshirt",
  "name": "<two-to-four word product name, in the brand voice>",
  "prompt": "<one-sentence, highly specific graphic-design prompt for an image model: subject, composition, style, texture. Palette-constrained to the colors above. A standalone print graphic — no shirts, no mockups, no photographs of people.>"}]`,
          },
        ],
      },
    ],
  });
  const ideasText = (ideaRes.text ?? '').replace(/```json|```/g, '').trim();
  return (JSON.parse(ideasText) as FirstDropIdea[]).slice(0, n);
}

/** Build ONE first-drop product from an approved concept: design → composition → mockup →
 *  publish, server-to-server AS the store's creator via the internal-service identity (the
 *  free onboarding gift — /api/generate, /api/merge and publish's auto-shots all skip charging
 *  internal@nanocrew). Returns 'duplicate' when a product with this name already exists. */
export async function createFirstDropProduct(opts: {
  storeId: string;
  baseUrl: string;
  idea: FirstDropIdea;
}): Promise<'created' | 'duplicate'> {
  if (!process.env.INTERNAL_API_KEY) throw new Error('INTERNAL_API_KEY not configured (needed for server-side generation)');
  const { store, cat } = await loadStore(opts.storeId);
  const { idea } = opts;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-internal-key': process.env.INTERNAL_API_KEY,
    'x-internal-creator': store.creatorId,
  };
  const post = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(opts.baseUrl + path, { method: 'POST', headers, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok && !json.error) return json;
      const msg = String(json.error ?? res.status);
      if (/429|TooManyRequests|too many requests/i.test(msg) && attempt < 6) {
        const wait = (parseInt(msg.match(/after (\d+) seconds/)?.[1] ?? '30', 10) + 5) * 1000;
        log(`  …rate limited, waiting ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      throw new Error(`${path}: ${msg}`);
    }
  };
  const get = async (path: string): Promise<Record<string, unknown>> => {
    const res = await fetch(opts.baseUrl + path, { headers });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || json.error) throw new Error(`${path}: ${json.error ?? res.status}`);
    return json;
  };

  // Cheap name-dedupe (small catalogues): skip if THIS store already has a product with this
  // name (the old query wasn't store-scoped — a name collision on another brand false-duped).
  const dupe = await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(and(eq(schema.products.storeId, store.id), eq(schema.products.name, idea.name)))
    .limit(1);
  if (dupe.length) {
    log(`  ✓ ${idea.name} (already published)`);
    return 'duplicate';
  }

  const ds = (store.designSystem ?? {}) as { palette?: { role: string; hex: string }[] };
  const paletteArr = ds.palette ?? [];
  const bg = paletteArr.find((p) => p.role === 'background')?.hex ?? '#ffffff';
  const dark = parseInt(bg.slice(1, 3), 16) < 128;
  const preferredColors = dark ? ['Black', 'Navy', 'White'] : ['White', 'Black', 'Natural'];

  const { PNG } = await import('pngjs');
  const blank = BLANK[idea.garment] ?? BLANK.tee;

  log(`  ${idea.name}: generating design…`);
  const gen = await post('/api/generate', { prompt: idea.prompt, catalogueId: cat.id });
  if (!gen.id) throw new Error('design row not created');

  const comp = (await post('/api/compositions', {
    catalogueId: cat.id,
    designId: gen.id,
    templateKey: String(blank),
    placement: 'front',
  })) as { composition: { id: string } };

  const [pa, vars] = (await Promise.all([
    get(`/api/blank/${blank}/printareas`),
    get(`/api/blank/${blank}/variants`),
  ])) as [
    { areas: { placement: string; areaWidth: number; areaHeight: number }[]; variantId?: string },
    { variants: { id: string; color: string | null; size: string | null }[] },
  ];
  const front = pa.areas.find((a) => a.placement === 'front') ?? pa.areas[0];

  const png = Buffer.from(await (await fetch(gen.image as string)).arrayBuffer());
  const dims = PNG.sync.read(png);
  const aspect = dims.width / dims.height || 1;
  let w = front.areaWidth * 0.88;
  let h = w / aspect;
  if (h > front.areaHeight * 0.85) {
    h = front.areaHeight * 0.85;
    w = h * aspect;
  }
  const position = {
    areaWidth: front.areaWidth,
    areaHeight: front.areaHeight,
    width: Math.round(w),
    height: Math.round(h),
    left: Math.round((front.areaWidth - w) / 2),
    top: Math.round(Math.min(front.areaHeight * 0.08, front.areaHeight - h)),
  };

  const bySize = (a: { size: string | null }, b: { size: string | null }) =>
    SIZE_ORDER.indexOf(a.size ?? '') - SIZE_ORDER.indexOf(b.size ?? '');
  let colorVars: { id: string; color: string | null; size: string | null }[] = [];
  for (const c of preferredColors) {
    colorVars = vars.variants.filter((v) => v.color === c).sort(bySize).slice(0, 4);
    if (colorVars.length) break;
  }
  if (!colorVars.length) {
    colorVars = vars.variants.filter((v) => v.color === vars.variants[0]?.color).sort(bySize).slice(0, 4);
  }

  log(`  ${idea.name}: mockup (${colorVars[0]?.color})…`);
  await post('/api/mockup', {
    compositionId: comp.composition.id,
    templateKey: String(blank),
    variantId: colorVars[0]?.id ?? pa.variantId,
    placements: [{ placement: front.placement, designId: gen.id, position }],
  });

  log(`  ${idea.name}: publishing (${colorVars.length} ${colorVars[0]?.color})…`);
  await post('/api/publish', {
    compositionId: comp.composition.id,
    name: idea.name,
    description: `${idea.name} — ${store.tagline}`,
    variants: colorVars.map((v) => ({
      printfulVariantId: v.id,
      retailPriceCents: PRICE[idea.garment] ?? PRICE.tee,
      size: v.size,
      color: v.color,
    })),
  });
  log(`  ✓ ${idea.name} live`);
  return 'created';
}

/** The SILENT door: invent the concepts and build them all, fire-and-forget. */
export async function generateFirstDrop(opts: { storeId: string; baseUrl: string; count?: number }): Promise<void> {
  try {
    const { store, cat } = await loadStore(opts.storeId);
    log(`── ${store.name} (“${store.tagline}”) → ${cat.name} ──`);
    const ideas = await proposeFirstDropIdeas(opts.storeId, opts.count ?? 4);
    log(`concepts: ${ideas.map((i) => i.name).join(' · ')}`);
    for (const idea of ideas) {
      await createFirstDropProduct({ storeId: opts.storeId, baseUrl: opts.baseUrl, idea });
    }
    // Products published + site provisioned → 'ready' (not 'live' — live means a domain is attached).
    await db.update(schema.stores).set({ status: 'ready' }).where(eq(schema.stores.id, opts.storeId));
    log('── done ──');
  } catch (e) {
    log('failed:', e instanceof Error ? e.message : e);
  }
}
