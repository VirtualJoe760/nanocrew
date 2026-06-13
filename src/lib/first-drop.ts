import { GoogleGenAI } from '@google/genai';
import { asc, eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// Server-side port of scripts/first-drop.mjs: from a provisioned brand's profile, Gemini
// invents on-brand print concepts → the design/composition/mockup/publish routes turn each
// into a live product in the store's first catalogue. Fired (fire-and-forget) on store
// creation so a new brand isn't empty — but ONLY when AUTO_FIRST_DROP=1, because each run
// spends real Gemini + Printful credits. Printable apparel only (tees/sweats).

const BLANK = { tee: 71, sweatshirt: 380 } as const; // proven DTG blanks
const PRICE = { tee: 2899, sweatshirt: 4899 } as const;
const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];

type Garment = 'tee' | 'sweatshirt';
interface Idea {
  garment: Garment;
  name: string;
  prompt: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Whether auto-generation is switched on (off by default — it spends real money). */
export function autoFirstDropEnabled(): boolean {
  return process.env.AUTO_FIRST_DROP === '1';
}

export async function generateFirstDrop(opts: { storeId: string; baseUrl: string; count?: number }): Promise<void> {
  const count = Math.min(opts.count ?? 4, 6);
  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  const log = (...a: unknown[]) => console.log('[first-drop]', ...a);

  // The designer routes require auth. We call them server-to-server AS the store's creator
  // via the internal-service key (INTERNAL_API_KEY) — set once the store is loaded below.
  let actingCreatorId = '';
  const headers = (): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    const key = process.env.INTERNAL_API_KEY;
    if (key && actingCreatorId) {
      h['x-internal-key'] = key;
      h['x-internal-creator'] = actingCreatorId;
    }
    return h;
  };

  const post = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(opts.baseUrl + path, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
      });
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
    const res = await fetch(opts.baseUrl + path, { headers: headers() });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || json.error) throw new Error(`${path}: ${json.error ?? res.status}`);
    return json;
  };

  try {
    if (!apiKey) throw new Error('no Gemini API key');
    if (!process.env.INTERNAL_API_KEY) throw new Error('INTERNAL_API_KEY not configured (needed for server-side generation)');

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
      .where(eq(schema.stores.id, opts.storeId))
      .limit(1);
    if (!store) throw new Error('store not found');
    actingCreatorId = store.creatorId;

    const profile = (store.brandProfile ?? {}) as {
      products?: string[];
      voice?: string;
      story?: string;
      vibeKeywords?: string[];
    };
    const ds = (store.designSystem ?? {}) as { palette?: { role: string; hex: string }[] };
    const paletteArr = ds.palette ?? [];
    const palette = paletteArr.map((p) => `${p.role}: ${p.hex}`).join(', ');

    const [cat] = await db
      .select({ id: schema.catalogues.id, name: schema.catalogues.name })
      .from(schema.catalogues)
      .where(eq(schema.catalogues.storeId, store.id))
      .orderBy(asc(schema.catalogues.createdAt))
      .limit(1);
    if (!cat) throw new Error('store has no catalogue');

    log(`── ${store.name} (“${store.tagline}”) → ${cat.name} ──`);

    // 1. Gemini invents concepts (palette-constrained, printable garments).
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

Invent ${count} distinct print graphics for the brand's first drop${wantsSweats ? ' (mix of tees and sweatshirts)' : ' (tees)'}.
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
    const ideas = (JSON.parse(ideasText) as Idea[]).slice(0, count);
    log(`concepts: ${ideas.map((i) => i.name).join(' · ')}`);

    // 2. Blank + color choices.
    const bg = paletteArr.find((p) => p.role === 'background')?.hex ?? '#ffffff';
    const dark = parseInt(bg.slice(1, 3), 16) < 128;
    const preferredColors = dark ? ['Black', 'Navy', 'White'] : ['White', 'Black', 'Natural'];

    const { PNG } = await import('pngjs');

    for (const idea of ideas) {
      const existing = await db
        .select({ id: schema.products.id })
        .from(schema.products)
        .where(eq(schema.products.storeId, store.id))
        .limit(50);
      // Cheap name-dedupe (small catalogues): skip if a product with this name exists.
      const dupe = existing.length
        ? await db
            .select({ id: schema.products.id })
            .from(schema.products)
            .where(eq(schema.products.name, idea.name))
            .limit(1)
        : [];
      if (dupe.length) {
        log(`  ✓ ${idea.name} (already published)`);
        continue;
      }

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
    }

    // Products published + site provisioned → 'ready' (not 'live' — live means a domain is attached).
    await db.update(schema.stores).set({ status: 'ready' }).where(eq(schema.stores.id, store.id));
    log('── done ──');
  } catch (e) {
    log('failed:', e instanceof Error ? e.message : e);
  }
}
