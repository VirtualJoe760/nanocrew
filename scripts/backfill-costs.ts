// Backfill variants.printful_cost_cents for products published before cost capture existed.
// Each variant's blank comes from its composition (template_key); we fetch Printful's
// catalog cost per blank once and map by variant id (sku = "<syncProductId>-<variantId>").
// Usage: npx tsx --env-file=.env.local scripts/backfill-costs.ts
import postgres from 'postgres';

import { getCatalogVariants } from '../src/lib/printful';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  const rows = await sql<{ variant_id: string; sku: string; template_key: string }[]>`
    select v.id as variant_id, v.sku, c.template_key
    from variants v
    join products p on p.id = v.product_id
    join compositions c on c.printful_sync_product_id = p.printful_sync_product_id
    where v.printful_cost_cents is null`;
  console.log(`${rows.length} variants to price`);

  // Cache catalog cost maps per blank so we hit Printful once each.
  const costByBlank = new Map<string, Map<number, number>>();
  let updated = 0;
  for (const r of rows) {
    if (!costByBlank.has(r.template_key)) {
      try {
        const catalog = await getCatalogVariants(r.template_key);
        costByBlank.set(r.template_key, new Map(catalog.map((c) => [c.id, c.priceCents])));
        console.log(`  blank ${r.template_key}: ${catalog.length} variants priced`);
      } catch (e) {
        console.log(`  blank ${r.template_key}: failed (${e instanceof Error ? e.message : e})`);
        costByBlank.set(r.template_key, new Map());
      }
    }
    const printfulVariantId = Number(r.sku.split('-').pop());
    const cost = costByBlank.get(r.template_key)?.get(printfulVariantId);
    if (cost != null) {
      await sql`update variants set printful_cost_cents = ${cost} where id = ${r.variant_id}`;
      updated++;
    }
  }
  console.log(`✓ priced ${updated}/${rows.length} variants`);
  await sql.end();
  process.exit(0);
}
void main();
