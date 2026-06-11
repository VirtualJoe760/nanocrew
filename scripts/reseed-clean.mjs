// Wipe seeded content (DB + Printful sync products) so seed-demo.mjs can regenerate it
// through the fixed transparency pipeline.
import fs from 'node:fs';
import postgres from 'postgres';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const DB_URL = env.match(/^DATABASE_URL=(.+)$/m)[1];
const PF_KEY = env.match(/^PRINTFUL_API_KEY=(.+)$/m)[1];
const PF_STORE = env.match(/^PRINTFUL_STORE_ID=(.+)$/m)[1];

const sql = postgres(DB_URL, { prepare: false, max: 1 });

// Delete every Printful sync product in the store (test/seed data only at this point).
const listRes = await fetch('https://api.printful.com/store/products?limit=100', {
  headers: { Authorization: `Bearer ${PF_KEY}`, 'X-PF-Store-Id': PF_STORE },
});
const list = (await listRes.json()).result ?? [];
console.log('Printful sync products to delete:', list.length);
for (const p of list) {
  const del = await fetch(`https://api.printful.com/store/products/${p.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${PF_KEY}`, 'X-PF-Store-Id': PF_STORE },
  });
  console.log(`  deleted ${p.id} (${p.name}) → ${del.status}`);
  await new Promise((r) => setTimeout(r, 700));
}

// Wipe DB content (order matters only for non-cascading refs; most cascade).
await sql`delete from order_items`;
await sql`delete from orders`;
await sql`delete from variants`;
await sql`delete from products`;
await sql`delete from canvas_nodes`;
await sql`delete from compositions`;
await sql`delete from designs`;
console.log('DB content wiped (stores + catalogues kept).');
await sql.end();
