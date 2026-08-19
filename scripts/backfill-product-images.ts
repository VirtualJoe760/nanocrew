// ONE-OFF REPAIR (Joe, 2026-08-18: three Stephen Lawyer products were blank cards). Publishes that
// skipped the "Generate Printful mockup" step landed products with imageUrl null — the placement
// editor no longer requires that step, and both the card image AND model shots hung off it.
// /api/publish is fixed forward; this repairs the rows already in the DB.
//   set -a; . ./.env.local; set +a; npx tsx scripts/backfill-product-images.ts [--apply]
import postgres from 'postgres';

import { getProductMeta, renderMockups, upscaleForPrint, type MockupFile } from '../src/lib/printful';
import { uploadImage } from '../src/lib/cloudinary';

const APPLY = process.argv.includes('--apply');
const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 2 });

type Row = {
  id: string;
  name: string;
  store_slug: string;
  sync_id: string | null;
  template_key: string | null;
  placements: { placement: string; designId: string; position: Record<string, number | boolean> | null }[] | null;
  design_id: string | null;
};

async function persist(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await uploadImage(Buffer.from(await res.arrayBuffer()), { folder: 'nanocrew/mockups' });
  } catch {
    return null;
  }
}

async function main() {
  const rows = (await sql`
    SELECT p.id, p.name, s.slug AS store_slug, p.printful_sync_product_id AS sync_id,
           c.template_key, c.placements, c.design_id
      FROM products p
      JOIN stores s ON s.id = p.store_id
      LEFT JOIN compositions c ON c.printful_sync_product_id = p.printful_sync_product_id
     WHERE p.image_url IS NULL
       AND (p.model_shots IS NULL OR jsonb_array_length(p.model_shots) = 0)
  `) as unknown as Row[];
  console.log(`blank products: ${rows.length}${APPLY ? '' : '  (dry run — pass --apply to write)'}`);

  for (const r of rows) {
    const saved = r.placements?.length
      ? r.placements
      : r.design_id
        ? [{ placement: 'front', designId: r.design_id, position: null }]
        : [];
    const ids = [...new Set(saved.map((p) => p.designId))];
    const designs = ids.length
      ? ((await sql`SELECT id, url FROM designs WHERE id IN ${sql(ids)}`) as unknown as { id: string; url: string }[])
      : [];
    const urlById = new Map(designs.map((d) => [d.id, d.url]));

    let image: string | null = null;
    if (r.template_key) {
      // The real garment mockup — same call publish makes.
      const files: MockupFile[] = saved
        .filter((p) => urlById.get(p.designId) && !urlById.get(p.designId)!.startsWith('data:'))
        .map((p) => ({
          placement: p.placement,
          image_url: upscaleForPrint(urlById.get(p.designId)!),
          ...(p.position
            ? {
                position: {
                  area_width: Number(p.position.areaWidth),
                  area_height: Number(p.position.areaHeight),
                  width: Number(p.position.width),
                  height: Number(p.position.height),
                  top: Number(p.position.top),
                  left: Number(p.position.left),
                  ...(p.position.limitToPrintArea === false ? { limit_to_print_area: false } : {}),
                },
              }
            : {}),
        }));
      const [variant] = (await sql`
        SELECT sku FROM variants WHERE product_id = ${r.id} LIMIT 1
      `) as unknown as { sku: string }[];
      const variantId = Number(variant?.sku?.split('-').pop());
      if (files.length && Number.isFinite(variantId)) {
        // Printful rate-limits bursts (429 with a retry-after ~60s) — one patient retry.
        for (let attempt = 0; attempt < 2 && !image; attempt++) {
          if (attempt) await new Promise((res) => setTimeout(res, 65_000));
          try {
            const meta = await getProductMeta(r.template_key).catch(() => ({ technique: null, defaultOptions: {} }));
            const rendered = await renderMockups(
              r.template_key,
              variantId,
              files,
              meta.technique,
              meta.technique === 'KNITWEAR' ? meta.defaultOptions : undefined,
            );
            image = await persist(rendered.front ?? Object.values(rendered)[0] ?? null);
          } catch (e) {
            console.log(`   mockup attempt ${attempt + 1} failed: ${e instanceof Error ? e.message : e}`);
          }
        }
      }
    }
    // Fall back to the design art so the card is at least never blank.
    if (!image) image = saved.map((p) => urlById.get(p.designId)).find((u) => u && !u.startsWith('data:')) ?? null;

    console.log(` - ${r.store_slug}/${r.name.slice(0, 34).padEnd(34)} → ${image ? image.slice(0, 72) : 'NO SOURCE'}`);
    if (APPLY && image) await sql`UPDATE products SET image_url = ${image} WHERE id = ${r.id}`;
  }
  await sql.end();
}

void main();
