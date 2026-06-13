// Backfill fulfillment: submit every paid-but-unsubmitted order to Printful as a
// DRAFT (mirrors platform-api/lib/fulfill.ts — the webhook handles new orders).
// Usage: node scripts/submit-paid-orders.mjs
import fs from 'node:fs';
import postgres from 'postgres';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const grab = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1];
const sql = postgres(grab('DATABASE_URL'), { prepare: false, max: 1 });

const orders = await sql`
  select o.id, o.customer_email, o.shipping_address_json as ship
  from orders o
  where o.status = 'paid' and o.printful_order_id is null`;
console.log(`${orders.length} paid orders awaiting submission`);

for (const o of orders) {
  const items = await sql`
    select oi.quantity, v.printful_sync_variant_id as sv
    from order_items oi join variants v on v.id = oi.variant_id
    where oi.order_id = ${o.id} and v.printful_sync_variant_id is not null`;
  const addr = o.ship?.address;
  if (!items.length || !addr?.line1) {
    console.log(`  ✗ ${o.id}: missing ${items.length ? 'address' : 'sync variants'}`);
    continue;
  }
  const res = await fetch('https://api.printful.com/orders?confirm=0', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${grab('PRINTFUL_API_KEY')}`,
      'X-PF-Store-Id': grab('PRINTFUL_STORE_ID'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      external_id: o.id,
      recipient: {
        name: o.ship?.name ?? 'Customer',
        email: o.customer_email,
        address1: addr.line1,
        address2: addr.line2 ?? undefined,
        city: addr.city,
        state_code: addr.state ?? undefined,
        country_code: addr.country,
        zip: addr.postal_code ?? undefined,
      },
      items: items.map((i) => ({ sync_variant_id: Number(i.sv), quantity: i.quantity })),
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.result?.id) {
    console.log(`  ✗ ${o.id}: ${json?.error?.message ?? res.status}`);
    continue;
  }
  await sql`update orders set printful_order_id = ${String(json.result.id)}, status = 'submitted_to_printful' where id = ${o.id}`;
  console.log(`  ✓ ${o.id} → printful ${json.result.id} (${json.result.status})`);
}
await sql.end();
process.exit(0);
