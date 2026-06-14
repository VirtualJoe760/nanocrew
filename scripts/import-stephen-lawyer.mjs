// One-off: import Stephen Lawyer Clothing into the Nanocrew ecosystem.
//   - reads his 28 products / 685 variants from HIS Neon DB
//   - re-creates each product in OUR shared Printful store (his existing print files transfer by URL)
//   - writes products + variants into OUR Supabase under store `stephen-lawyer`, storing the NEW
//     Printful sync-variant ids so fulfillment works, and his retail prices.
//
// Safe by default: DRY RUN (reads only). Pass --live to actually create Printful products + DB rows.
// Pass --replace to first delete the store's existing (demo) products. Idempotent: skips a product
// whose slug already exists under the store. Printful cost is left null (run backfill-costs after).
//
//   node scripts/import-stephen-lawyer.mjs            # dry run
//   node scripts/import-stephen-lawyer.mjs --live --replace
import fs from 'node:fs';
import postgres from 'postgres';

const LIVE = process.argv.includes('--live');
const REPLACE = process.argv.includes('--replace');
const STORE_SLUG = 'stephen-lawyer';

const readEnv = (path) => {
  const t = fs.readFileSync(path, 'utf8');
  return (k) => t.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim().replace(/^"|"$/g, '');
};
const his = readEnv('/Users/macdaddyjoe/code/stephen-lawyer/.env.local');
const ours = readEnv('/Users/macdaddyjoe/code/nanocrew/.env.local');

const HIS_DB = his('DATABASE_URL');
const HIS_PF_KEY = his('PRINTFUL_API_KEY');
const HIS_PF_STORE = his('PRINTFUL_STORE_ID');
const OUR_DB = ours('DATABASE_URL');
const OUR_PF_KEY = ours('PRINTFUL_API_KEY');
const OUR_PF_STORE = ours('PRINTFUL_STORE_ID');
for (const [k, v] of Object.entries({ HIS_DB, HIS_PF_KEY, HIS_PF_STORE, OUR_DB, OUR_PF_KEY, OUR_PF_STORE }))
  if (!v) throw new Error(`missing ${k}`);

async function pf(key, store, path, init, attempt = 0) {
  const res = await fetch(`https://api.printful.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, 'X-PF-Store-Id': store, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (res.status === 429 && attempt < 6) {
    const wait = Number(res.headers.get('Retry-After') || 60) + 2;
    console.log(`    (rate-limited — waiting ${wait}s)`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return pf(key, store, path, init, attempt + 1);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → ${res.status} ${json.error?.message ?? JSON.stringify(json).slice(0, 120)}`);
  return json.result;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hisDb = postgres(HIS_DB, { max: 1 });
const ourDb = postgres(OUR_DB, { max: 1 });

console.log(`\n=== Import Stephen Lawyer → ${STORE_SLUG} ===  mode: ${LIVE ? 'LIVE' : 'DRY RUN'}${REPLACE ? ' --replace' : ''}\n`);

const [store] = await ourDb`select id from stores where slug=${STORE_SLUG}`;
if (!store) throw new Error(`store ${STORE_SLUG} not found in our DB`);
let [cat] = await ourDb`select id from catalogues where store_id=${store.id} order by created_at limit 1`;

const hisProducts = await hisDb`select id, printful_sync_product_id, slug, name, description_md, hero_image_url, is_published from products order by name`;
const hisVariants = await hisDb`select product_id, printful_sync_variant_id, sku, color, size, retail_price_cents, in_stock from variants`;
const varsByProduct = new Map();
for (const v of hisVariants) { if (!varsByProduct.has(v.product_id)) varsByProduct.set(v.product_id, []); varsByProduct.get(v.product_id).push(v); }
console.log(`his catalog: ${hisProducts.length} products, ${hisVariants.length} variants\n`);

if (LIVE && REPLACE) {
  const del = await ourDb`delete from products where store_id=${store.id} returning id`;
  console.log(`cleared ${del.length} existing (demo) products from the store\n`);
}
if (LIVE && !cat) {
  [cat] = await ourDb`insert into catalogues (store_id, name, slug) values (${store.id}, 'All Products', 'all') returning id`;
}

let created = 0, skipped = 0, failed = 0;
for (const p of hisProducts) {
  try {
    const [exists] = await ourDb`select id from products where store_id=${store.id} and slug=${p.slug}`;
    if (exists && !(LIVE && REPLACE)) { console.log(`  · ${p.name}  (skip — already imported)`); skipped++; continue; }

    // 1) read his sync product (his Printful store) → variants + print files
    const src = await pf(HIS_PF_KEY, HIS_PF_STORE, `/store/products/${p.printful_sync_product_id}`);
    const srcVariants = src.sync_variants ?? [];
    // his sync_variant id → catalog variant_id (to chain his Neon variants to our new ones)
    const catByHisSV = new Map(srcVariants.map((v) => [String(v.id), v.variant_id]));

    if (!LIVE) {
      console.log(`  · ${p.name}  → would create ${srcVariants.length} variants (files: ${srcVariants[0]?.files?.length ?? 0})`);
      created++;
      continue;
    }

    // 2) create in OUR Printful store (transfer files by URL)
    const body = {
      sync_product: { name: p.name, thumbnail: src.sync_product?.thumbnail_url ?? undefined },
      sync_variants: srcVariants.map((v) => ({
        variant_id: v.variant_id,
        retail_price: v.retail_price,
        files: (v.files ?? []).filter((f) => f.url).map((f) => ({ type: f.type, url: f.url, ...(f.position ? { position: f.position } : {}) })),
      })),
    };
    const made = await pf(OUR_PF_KEY, OUR_PF_STORE, '/store/products', { method: 'POST', body: JSON.stringify(body) });
    const newSyncId = made.id ?? made.sync_product?.id;
    await sleep(1200); // Printful rate-limit courtesy
    const back = await pf(OUR_PF_KEY, OUR_PF_STORE, `/store/products/${newSyncId}`);
    const newSyncVariantByCat = new Map((back.sync_variants ?? []).map((v) => [v.variant_id, String(v.id)]));

    // 3) write product + variants to our DB
    const [prod] = await ourDb`
      insert into products (store_id, catalogue_id, printful_sync_product_id, slug, name, description_md, image_url, is_published)
      values (${store.id}, ${cat.id}, ${String(newSyncId)}, ${p.slug}, ${p.name}, ${p.description_md}, ${p.hero_image_url}, ${p.is_published})
      returning id`;
    const rows = (varsByProduct.get(p.id) ?? []).map((hv) => {
      const catId = catByHisSV.get(String(hv.printful_sync_variant_id));
      const newSV = catId != null ? newSyncVariantByCat.get(catId) : null;
      return { product_id: prod.id, printful_sync_variant_id: newSV, sku: hv.sku, color: hv.color, size: hv.size, retail_price_cents: hv.retail_price_cents, in_stock: hv.in_stock };
    });
    for (const r of rows) {
      await ourDb`insert into variants (product_id, printful_sync_variant_id, sku, color, size, retail_price_cents, in_stock)
        values (${r.product_id}, ${r.printful_sync_variant_id}, ${r.sku}, ${r.color}, ${r.size}, ${r.retail_price_cents}, ${r.in_stock})
        on conflict do nothing`;
    }
    const mapped = rows.filter((r) => r.printful_sync_variant_id).length;
    console.log(`  ✓ ${p.name}  → printful ${newSyncId}, ${rows.length} variants (${mapped} fulfillable)`);
    created++;
    await sleep(2500);
  } catch (e) {
    console.log(`  ✗ ${p.name}  — ${e.message}`);
    failed++;
  }
}

console.log(`\n${LIVE ? 'Created' : 'Would create'}: ${created} · skipped: ${skipped} · failed: ${failed}`);
if (!LIVE) console.log('Dry run — no Printful or DB writes. Re-run with --live --replace to execute.');
else console.log('Next: run scripts/backfill-costs.ts to capture Printful costs for margins/floor.');
await hisDb.end();
await ourDb.end();
