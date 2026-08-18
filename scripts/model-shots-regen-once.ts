// One-off (2026-08-17): REGENERATE all published products' model shots — realism contract + action poses.
import 'dotenv/config';
import postgres from 'postgres';
import { generateModelShots } from '../src/lib/model-shots';

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
(async () => {
  const rows = await sql`
    select p.id, p.name, p.image_url, s.slug as store
    from products p join stores s on s.id = p.store_id
    where p.is_published = true and p.image_url is not null`;
  for (const r of rows) {
    try {
      console.log(`[regen] ${r.store} / ${r.name} …`);
      const shots = await generateModelShots(r.image_url, 6);
      if (shots.length >= 3) {
        await sql`update products set model_shots = ${sql.json(shots)} where id = ${r.id}`;
        console.log(`[regen] ${r.store} / ${r.name} → ${shots.length} shots`);
      } else {
        console.log(`[regen] ${r.store} / ${r.name} → only ${shots.length}, kept old set`);
      }
    } catch (e) {
      console.log(`[regen] ${r.store} / ${r.name} FAILED:`, e instanceof Error ? e.message : e);
    }
  }
  await sql.end();
  console.log('[regen] done');
})();
