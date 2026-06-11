// Seed demo stores with REAL published products, driving the live API pipeline:
// generate (Nano Banana) → composition → Printful mockup → publish (sync product).
// Usage: node scripts/seed-demo.mjs   (Metro must be running on :8081)
import fs from 'node:fs';
import postgres from 'postgres';

const API = 'http://localhost:8081';
const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const DB_URL = env.match(/^DATABASE_URL=(.+)$/m)[1];
const CREATOR = '00000000-0000-0000-0000-000000000001'; // platform creator (bootstrap)

const BRANDS = [
  {
    name: 'Stephen Lawyer',
    slug: 'stephen-lawyer',
    tagline: 'Skate-born streetwear from the flagship crew.',
    catalogue: 'Summer 2026',
    products: [
      {
        prompt:
          'a lone skater silhouette mid-kickflip against a gritty halftone sun, distressed streetwear graphic, black and orange',
        blank: 71,
        name: 'Kickflip Sun Tee',
        color: 'Black',
        priceCents: 2899,
      },
      {
        prompt:
          'the words "STAY GOLD" in dripping gold chrome graffiti lettering, bold high-contrast streetwear graphic',
        blank: 380,
        name: 'Stay Gold Hoodie',
        color: 'Black',
        priceCents: 4999,
      },
    ],
  },
  {
    name: 'Neon Saints',
    slug: 'neon-saints',
    tagline: 'Electric color for night people.',
    catalogue: 'Voltage Drop',
    products: [
      {
        prompt:
          'a neon-outlined praying hands icon with electric cyan and magenta glow, synthwave streetwear graphic',
        blank: 71,
        name: 'Neon Prayer Tee',
        color: 'Black',
        priceCents: 2699,
      },
      {
        prompt:
          'a chrome halo ring with neon lightning bolts, retro-future streetwear graphic, purple and teal',
        blank: 380,
        name: 'Halo Voltage Hoodie',
        color: 'Navy',
        priceCents: 5199,
      },
    ],
  },
  {
    name: 'Golden Hour',
    slug: 'golden-hour',
    tagline: 'Sun-faded essentials for the slow evenings.',
    catalogue: 'Dusk Collection',
    products: [
      {
        prompt:
          'a minimalist gradient sunset circle over ocean waves, warm amber and dusty pink, clean modern graphic',
        blank: 71,
        name: 'Dusk Circle Tee',
        color: 'White',
        priceCents: 2599,
      },
      {
        prompt:
          'hand-drawn palm trees leaning in golden evening light, vintage faded surf graphic, muted earth tones',
        blank: 380,
        name: 'Last Light Hoodie',
        color: 'White',
        priceCents: 4899,
      },
    ],
  },
];

const sql = postgres(DB_URL, { prepare: false, max: 1 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (path, body) => {
  // Printful's mockup generator rate-limits hard — back off and retry on 429.
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

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

for (const brand of BRANDS) {
  log(`── ${brand.name} ──`);
  const [store] = await sql`
    insert into stores (creator_id, name, slug, tagline, status, is_public, printful_store_id)
    values (${CREATOR}, ${brand.name}, ${brand.slug}, ${brand.tagline}, 'live', true, '18313070')
    on conflict (slug) do update set tagline = excluded.tagline
    returning id`;
  const [cat] = await sql`
    insert into catalogues (store_id, name, slug)
    values (${store.id}, ${brand.catalogue}, ${brand.catalogue.toLowerCase().replace(/[^a-z0-9]+/g, '-')})
    on conflict (store_id, slug) do update set name = excluded.name
    returning id`;
  log(`store ${store.id.slice(0, 8)} · catalogue ${cat.id.slice(0, 8)}`);

  for (const p of brand.products) {
    // Skip if already published (idempotent re-runs).
    const existing = await sql`
      select id from products where store_id = ${store.id} and name = ${p.name} limit 1`;
    if (existing.length) {
      log(`  ✓ ${p.name} (already published)`);
      continue;
    }

    log(`  generating design: ${p.prompt.slice(0, 50)}…`);
    const gen = await post('/api/generate', { prompt: p.prompt, catalogueId: cat.id });
    if (!gen.id) throw new Error('design row not created');

    const comp = await post('/api/compositions', {
      catalogueId: cat.id,
      designId: gen.id,
      templateKey: String(p.blank),
      placement: 'front',
    });

    log(`  fetching print area + variants…`);
    const [pa, vars] = await Promise.all([
      get(`/api/blank/${p.blank}/printareas`),
      get(`/api/blank/${p.blank}/variants`),
    ]);
    const front = pa.areas.find((a) => a.placement === 'front') ?? pa.areas[0];
    // Big bold chest print at the design's NATURAL aspect (designs are auto-cropped to
    // their art now): target 88% of the print width, clamped to 85% of its height.
    const png = Buffer.from(await (await fetch(gen.image)).arrayBuffer());
    const { PNG } = await import('pngjs');
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

    log(`  rendering Printful mockup…`);
    const mock = await post('/api/mockup', {
      compositionId: comp.composition.id,
      templateKey: String(p.blank),
      variantId: pa.variantId,
      placements: [{ placement: front.placement, designId: gen.id, position }],
    });

    let colorVars = vars.variants.filter((v) => v.color === p.color).slice(0, 4);
    if (!colorVars.length) {
      const fallback = vars.variants[0].color;
      log(`  (no ${p.color} variants — falling back to ${fallback})`);
      colorVars = vars.variants.filter((v) => v.color === fallback).slice(0, 4);
    }
    log(`  publishing ${p.name} (${colorVars.length} ${p.color} variants)…`);
    const pub = await post('/api/publish', {
      compositionId: comp.composition.id,
      name: p.name,
      description: `${p.name} — ${brand.tagline}`,
      variants: colorVars.map((v) => ({
        printfulVariantId: v.id,
        retailPriceCents: p.priceCents,
        size: v.size,
        color: v.color,
      })),
    });
    log(`  ✓ LIVE: sync product ${pub.printfulSyncProductId} · mockup ${mock.previewUrl ? 'yes' : 'no'}`);
  }
}

const summary = await sql`
  select s.name as store, count(p.id) as products
  from stores s left join products p on p.store_id = s.id
  group by s.name order by s.name`;
console.log('\nSEED COMPLETE:', JSON.stringify(summary));
await sql.end();
