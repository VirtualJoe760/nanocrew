// One-time backfill: product mockup images were stored as Printful tmp S3 URLs,
// which expire (~72h). Re-host every still-alive tmp image on Cloudinary and
// update the row. Dead URLs are reported — re-render those mockups from their
// compositions if any show up. (publish+api.ts now persists at publish time.)
// Usage: node scripts/persist-mockups.mjs
import fs from 'node:fs';
import postgres from 'postgres';
import { v2 as cloudinary } from 'cloudinary';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const grab = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1];

cloudinary.config({
  cloud_name: grab('CLOUDINARY_CLOUD_NAME'),
  api_key: grab('CLOUDINARY_API_KEY'),
  api_secret: grab('CLOUDINARY_API_SECRET'),
  secure: true,
});
const sql = postgres(grab('DATABASE_URL'), { prepare: false, max: 1 });

const upload = (buffer) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: 'nanocrew/mockups' }, (err, res) =>
      err || !res ? reject(err ?? new Error('upload failed')) : resolve(res.secure_url),
    );
    stream.end(buffer);
  });

const rows = await sql`
  select p.id, p.name, p.image_url, s.slug as store
  from products p join stores s on s.id = p.store_id
  where p.image_url like '%printful-upload%' or p.image_url like '%/tmp/%'`;
console.log(`${rows.length} products with temporary mockup URLs`);

let saved = 0;
const dead = [];
for (const r of rows) {
  try {
    const res = await fetch(r.image_url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const url = await upload(Buffer.from(await res.arrayBuffer()));
    await sql`update products set image_url = ${url} where id = ${r.id}`;
    saved++;
    console.log(`  ✓ ${r.store}/${r.name}`);
  } catch (e) {
    dead.push(`${r.store}/${r.name}`);
    console.log(`  ✗ ${r.store}/${r.name} — ${e.message} (URL dead; needs mockup re-render)`);
  }
}
console.log(`done: ${saved} persisted, ${dead.length} dead`);
await sql.end();
process.exit(0);
