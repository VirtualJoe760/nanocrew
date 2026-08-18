// One-off (2026-08-17, task #3): generate on-model shots for every published product missing them.
import 'dotenv/config';
import postgres from 'postgres';
import { generateModelShots } from '../src/lib/model-shots';

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
(async () => {
  const rows = await sql`
    select p.id, p.name, p.image_url, s.slug as store
    from products p join stores s on s.id = p.store_id
    where p.is_published = true and p.image_url is not null
      and (p.model_shots is null or jsonb_array_length(p.model_shots) = 0)`;
  for (const r of rows) {
    try {
      console.log(`[backfill] ${r.store} / ${r.name} …`);
      const shots = await generateModelShots(r.image_url, 3);
      if (shots.length) {
        await sql`update products set model_shots = ${sql.json(shots)} where id = ${r.id}`;
        console.log(`[backfill] ${r.store} / ${r.name} → ${shots.length} shots`);
      } else {
        console.log(`[backfill] ${r.store} / ${r.name} → NO SHOTS (model declined)`);
      }
    } catch (e) {
      console.log(`[backfill] ${r.store} / ${r.name} FAILED:`, e instanceof Error ? e.message : e);
    }
  }
  await sql.end();
  console.log('[backfill] done');
})();
