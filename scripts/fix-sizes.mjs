// Repair a store's size runs: ensure every published product has at least
// S/M/L/XL in its color, both on the Printful sync product and in our DB.
// Reuses the product's existing print files — no regeneration.
// Usage: node scripts/fix-sizes.mjs <store-slug>
import fs from 'node:fs';
import postgres from 'postgres';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const grab = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1];
const PF = grab('PRINTFUL_API_KEY');
const STORE_ID = grab('PRINTFUL_STORE_ID');
const sql = postgres(grab('DATABASE_URL'), { prepare: false, max: 1 });

const slug = process.argv[2];
if (!slug) {
  console.error('usage: node scripts/fix-sizes.mjs <store-slug>');
  process.exit(1);
}
const WANT = ['S', 'M', 'L', 'XL'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pf = async (path, init) => {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.printful.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${PF}`,
        'X-PF-Store-Id': STORE_ID,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
    const json = await res.json();
    if (res.ok) return json.result;
    const msg = json?.error?.message ?? String(res.status);
    if (/too many requests/i.test(msg) && attempt < 5) {
      const wait = (parseInt(msg.match(/after (\d+) seconds/)?.[1] ?? '60', 10) + 3) * 1000;
      console.log(`  …rate limited, waiting ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    throw new Error(`${path}: ${msg}`);
  }
};

const products = await sql`
  select p.id, p.name, p.printful_sync_product_id as sync_id
  from products p join stores s on s.id = p.store_id
  where s.slug = ${slug} and p.is_published = true and p.printful_sync_product_id is not null`;
console.log(`${products.length} products to check`);

for (const prod of products) {
  const sync = await pf(`/store/products/${prod.sync_id}`);
  const existing = sync.sync_variants;
  const sample = existing[0];

  // Which catalog product + color are we on?
  const catVariant = await pf(`/products/variant/${sample.variant_id}`);
  const catProductId = catVariant.variant.product_id;
  const color = catVariant.variant.color;
  const catalog = await pf(`/products/${catProductId}`);

  const haveSizes = new Set(
    await Promise.all(existing.map(async (v) => catalog.variants.find((c) => c.id === v.variant_id)?.size)),
  );
  const missing = WANT.filter((s) => !haveSizes.has(s));
  if (!missing.length) {
    console.log(`✓ ${prod.name}: size run already complete`);
    continue;
  }

  // Reuse the sibling's print files (skip preview/mockup file types).
  const files = sample.files
    .filter((f) => f.type !== 'preview')
    .map((f) => ({ id: f.id, type: f.type }));

  for (const size of missing) {
    const cat = catalog.variants.find((c) => c.color === color && c.size === size);
    if (!cat) {
      console.log(`  ✗ ${prod.name}: no ${color} ${size} in catalog`);
      continue;
    }
    const created = await pf(`/store/products/${prod.sync_id}/variants`, {
      method: 'POST',
      body: JSON.stringify({
        variant_id: cat.id,
        retail_price: sample.retail_price,
        files,
      }),
    });
    await sql`
      insert into variants (product_id, printful_sync_variant_id, sku, color, size, retail_price_cents, in_stock)
      values (${prod.id}, ${String(created.id)}, ${`${prod.sync_id}-${cat.id}`}, ${color}, ${size},
              ${Math.round(parseFloat(sample.retail_price) * 100)}, true)
      on conflict (sku) do nothing`;
    console.log(`  + ${prod.name}: ${color} ${size}`);
    await sleep(400);
  }
}
console.log('done');
await sql.end();
process.exit(0);
