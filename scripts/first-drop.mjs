// Auto-generate a brand's first product drop from its Studio interview profile:
// Gemini invents on-brand graphic concepts → Nano Banana renders each design →
// Printful mockup → publish as live products in the store's first catalogue.
// Mirrors the proven seed-demo.mjs pipeline, but driven by brand data instead of
// hardcoded specs. Printable apparel only (tees/sweats) — hats/pants are skipped
// until embroidery/AOP flows exist.
//
// Usage: node scripts/first-drop.mjs <store-slug> [count=4]   (Metro on :8081)
import fs from 'node:fs';
import postgres from 'postgres';
import { GoogleGenAI } from '@google/genai';

const API = 'http://localhost:8081';
const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const grab = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1];
const DB_URL = grab('DATABASE_URL');
const GEMINI_KEY = grab('GOOGLE_GENAI_API_KEY') ?? grab('GEMINI_API_KEY');

const slug = process.argv[2];
const COUNT = Math.min(parseInt(process.argv[3] ?? '4', 10), 6);
if (!slug) {
  console.error('usage: node scripts/first-drop.mjs <store-slug> [count]');
  process.exit(1);
}

const sql = postgres(DB_URL, { prepare: false, max: 1 });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const post = async (path, body) => {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && !json.error) return json;
    const msg = String(json.error || res.status);
    if (/429|TooManyRequests|too many requests/i.test(msg) && attempt < 6) {
      const wait = (parseInt(msg.match(/after (\d+) seconds/)?.[1] ?? '30', 10) + 5) * 1000;
      log(`  …rate limited, waiting ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    throw new Error(`${path}: ${msg}`);
  }
};
const get = async (path) => {
  const res = await fetch(API + path);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`${path}: ${json.error || res.status}`);
  return json;
};

// ── 1. Brand profile ────────────────────────────────────────────────────────
const [store] = await sql`
  select id, name, tagline, brand_profile as profile, design_system as ds
  from stores where slug = ${slug}`;
if (!store?.profile) {
  console.error(`store "${slug}" not found or has no brand profile`);
  process.exit(1);
}
const profile = store.profile;
const palette = (store.ds?.palette ?? []).map((p) => `${p.role}: ${p.hex}`).join(', ');
log(`── First drop for ${store.name} (“${store.tagline}”) ──`);

const [cat] = await sql`
  select id, name from catalogues where store_id = ${store.id} order by created_at limit 1`;
if (!cat) throw new Error('store has no catalogue');
log(`catalogue: ${cat.name}`);

// ── 2. Gemini invents on-brand concepts ─────────────────────────────────────
// Printable garments only; bias toward what the creator said they want to sell.
const wantsSweats = /sweat|hoodie|crew/i.test((profile.products ?? []).join(' '));
const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });
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

Invent ${COUNT} distinct print graphics for the brand's first drop${wantsSweats ? ' (mix of tees and sweatshirts)' : ' (tees)'}.
Reply with ONLY a JSON array, no markdown fences:
[{"garment": "tee" | "sweatshirt",
  "name": "<two-to-four word product name, in the brand voice>",
  "prompt": "<one-sentence, highly specific graphic-design prompt for an image model: subject, composition, style, texture. Palette-constrained to the colors above. A standalone print graphic — no shirts, no mockups, no photographs of people.>"}]`,
        },
      ],
    },
  ],
});
const ideasText = ideaRes.text.replace(/```json|```/g, '').trim();
const ideas = JSON.parse(ideasText).slice(0, COUNT);
log(`concepts: ${ideas.map((i) => i.name).join(' · ')}`);

// ── 3. Pick blanks + brand color ────────────────────────────────────────────
const BLANK = { tee: 71, sweatshirt: 380 }; // classic tee, hoodie — proven DTG blanks
const PRICE = { tee: 2899, sweatshirt: 4899 };
const bg = (store.ds?.palette ?? []).find((p) => p.role === 'background')?.hex ?? '#ffffff';
const dark = parseInt(bg.slice(1, 3), 16) < 128;
const preferredColors = dark ? ['Black', 'Navy', 'White'] : ['White', 'Black', 'Natural'];

// ── 4. Generate → compose → mockup → publish ────────────────────────────────
const { PNG } = await import('pngjs');
for (const idea of ideas) {
  const existing = await sql`
    select id from products where store_id = ${store.id} and name = ${idea.name} limit 1`;
  if (existing.length) {
    log(`  ✓ ${idea.name} (already published)`);
    continue;
  }
  const blank = BLANK[idea.garment] ?? BLANK.tee;

  log(`  ${idea.name}: generating design…`);
  const gen = await post('/api/generate', { prompt: idea.prompt, catalogueId: cat.id });
  if (!gen.id) throw new Error('design row not created');

  const comp = await post('/api/compositions', {
    catalogueId: cat.id,
    designId: gen.id,
    templateKey: String(blank),
    placement: 'front',
  });

  const [pa, vars] = await Promise.all([
    get(`/api/blank/${blank}/printareas`),
    get(`/api/blank/${blank}/variants`),
  ]);
  const front = pa.areas.find((a) => a.placement === 'front') ?? pa.areas[0];
  const png = Buffer.from(await (await fetch(gen.image)).arrayBuffer());
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

  const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
  const bySize = (a, b) => SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size);
  let colorVars = [];
  for (const c of preferredColors) {
    colorVars = vars.variants.filter((v) => v.color === c).sort(bySize).slice(0, 4);
    if (colorVars.length) break;
  }
  if (!colorVars.length)
    colorVars = vars.variants.filter((v) => v.color === vars.variants[0].color).sort(bySize).slice(0, 4);

  // Render the mockup on the color shoppers will actually buy — Printful's
  // default mockup garment is often a different colorway.
  log(`  ${idea.name}: rendering Printful mockup (${colorVars[0]?.color})…`);
  await post('/api/mockup', {
    compositionId: comp.composition.id,
    templateKey: String(blank),
    variantId: colorVars[0]?.id ?? pa.variantId,
    placements: [{ placement: front.placement, designId: gen.id, position }],
  });

  log(`  ${idea.name}: publishing (${colorVars.length} ${colorVars[0]?.color} variants)…`);
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

await sql`update stores set status = 'live' where id = ${store.id}`;
const [{ count }] = await sql`
  select count(*)::int as count from products where store_id = ${store.id} and is_published = true`;
log(`── done: ${count} published products; store status → live ──`);
await sql.end();
process.exit(0);
