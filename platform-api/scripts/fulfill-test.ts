// Isolated fulfillment-guard test. Seeds a self-contained paid order whose product carries a
// policy-violating design prompt, calls the REAL submitOrderToPrintful, and asserts it HOLDS the
// order (status 'on_hold', no printfulOrderId) without ever reaching Printful — then deletes
// everything. Run from platform-api/:  set -a; . ../.env.local; set +a; npx tsx scripts/fulfill-test.ts
import postgres from 'postgres';

import { submitOrderToPrintful } from '@/lib/fulfill';

const STORE = '36d70399-eebb-4139-bfe2-e022f8f0cd60';
const CAT = 'f754e82c-c9c7-4626-95f7-53915ad17de5';
const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 });

async function main() {
  const tag = `TEST${Date.now()}`;
  const ids: Record<string, string> = {};
  try {
    [{ id: ids.d }] = (await sql`insert into designs (store_id, catalogue_id, prompt, url) values (${STORE}, ${CAT}, ${'hardcore porn xxx explicit sex'}, ${'https://x/y.png'}) returning id`) as any;
    [{ id: ids.c }] = (await sql`insert into compositions (store_id, catalogue_id, design_id, template_key, placement, status, printful_sync_product_id) values (${STORE}, ${CAT}, ${ids.d}, ${'71'}, ${'front'}, ${'published'}, ${tag}) returning id`) as any;
    [{ id: ids.p }] = (await sql`insert into products (store_id, catalogue_id, printful_sync_product_id, slug, name, is_published) values (${STORE}, ${CAT}, ${tag}, ${'test-' + tag}, ${'Test Product'}, true) returning id`) as any;
    [{ id: ids.v }] = (await sql`insert into variants (product_id, printful_sync_variant_id, sku, color, size, retail_price_cents) values (${ids.p}, ${tag + 'V'}, ${tag + '-1'}, ${'Black'}, ${'M'}, 2500) returning id`) as any;
    const ship = { name: 'Test', address: { line1: '1 Test St', city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' } };
    [{ id: ids.o }] = (await sql`insert into orders (store_id, customer_email, status, subtotal_cents, total_cents, shipping_address_json) values (${STORE}, ${'test@example.invalid'}, ${'paid'}, 2500, 2500, ${sql.json(ship)}) returning id`) as any;
    await sql`insert into order_items (order_id, variant_id, quantity, unit_price_cents, name_snapshot, variant_snapshot) values (${ids.o}, ${ids.v}, 1, 2500, ${'Test Product'}, ${'M / Black'})`;

    await submitOrderToPrintful(ids.o);

    const [after] = (await sql`select status, printful_order_id as pf from orders where id=${ids.o}`) as any;
    const held = after.status === 'on_hold' && !after.pf;
    console.log(held ? `✓  fulfillment HELD a forbidden design (status=${after.status}, not submitted to print)` : `✗ FAIL  status=${after.status} printfulOrderId=${after.pf}`);
    process.exitCode = held ? 0 : 1;
  } catch (e) {
    console.log('✗ FAIL  harness error:', e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  } finally {
    if (ids.o) await sql`delete from order_items where order_id=${ids.o}`.catch(() => {});
    if (ids.o) await sql`delete from orders where id=${ids.o}`.catch(() => {});
    if (ids.v) await sql`delete from variants where id=${ids.v}`.catch(() => {});
    if (ids.p) await sql`delete from products where id=${ids.p}`.catch(() => {});
    if (ids.c) await sql`delete from compositions where id=${ids.c}`.catch(() => {});
    if (ids.d) await sql`delete from designs where id=${ids.d}`.catch(() => {});
    await sql.end();
  }
}
main();
