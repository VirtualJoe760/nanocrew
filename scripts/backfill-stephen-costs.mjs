// Backfill variants.printful_cost_cents for the imported Stephen Lawyer catalog (the normal
// backfill keys off the designer composition, which these imports don't have). For each of our
// sync products we read its sync-variants (catalog variant id + blank product id) from OUR Printful
// store, fetch each blank's variant prices once, and map cost back to our variants by sync-variant id.
//   node scripts/backfill-stephen-costs.mjs
import fs from 'node:fs';
import postgres from 'postgres';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const grab = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim().replace(/^"|"$/g, '');
const KEY = grab('PRINTFUL_API_KEY');
const STORE = grab('PRINTFUL_STORE_ID');
const sql = postgres(grab('DATABASE_URL'), { max: 1 });

async function pf(path, attempt = 0) {
  const res = await fetch(`https://api.printful.com${path}`, { headers: { Authorization: `Bearer ${KEY}`, 'X-PF-Store-Id': STORE } });
  if (res.status === 429 && attempt < 6) {
    const wait = Number(res.headers.get('Retry-After') || 60) + 2;
    console.log(`  (rate-limited — waiting ${wait}s)`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return pf(path, attempt + 1);
  }
  const j = await res.json();
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return j.result;
}

const [store] = await sql`select id from stores where slug='stephen-lawyer'`;
const prods = await sql`select id, printful_sync_product_id from products where store_id=${store.id} and printful_sync_product_id is not null`;
console.log(`backfilling costs for ${prods.length} products…`);

const blankPriceCache = new Map(); // catalog variant_id → costCents
async function costFor(catVariantId, blankProductId) {
  if (blankPriceCache.has(catVariantId)) return blankPriceCache.get(catVariantId);
  const blank = await pf(`/products/${blankProductId}`); // all variants of this blank, with prices
  for (const v of blank.variants ?? []) blankPriceCache.set(v.id, Math.round(parseFloat(v.price || '0') * 100));
  return blankPriceCache.get(catVariantId) ?? null;
}

let updated = 0;
for (const p of prods) {
  try {
    const sp = await pf(`/store/products/${p.printful_sync_product_id}`);
    for (const sv of sp.sync_variants ?? []) {
      const cost = await costFor(sv.variant_id, sv.product?.product_id);
      if (cost == null) continue;
      const r = await sql`update variants set printful_cost_cents=${cost} where printful_sync_variant_id=${String(sv.id)} and printful_cost_cents is null`;
      updated += r.count;
    }
    await new Promise((r) => setTimeout(r, 800));
  } catch (e) {
    console.log(`  ✗ ${p.printful_sync_product_id}: ${e.message}`);
  }
}
console.log(`done — set cost on ${updated} variants (${blankPriceCache.size} catalog prices cached)`);
await sql.end();
