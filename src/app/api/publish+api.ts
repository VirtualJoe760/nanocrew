import { eq, inArray } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { uploadImage } from '@/lib/cloudinary';
import { db, schema } from '@/lib/db';
import { TenantError, assertCompositionOwner } from '@/lib/tenant';
import { createSyncProduct, getCatalogVariants, upscaleForPrint, type MockupPosition } from '@/lib/printful';

/** Printful mockup URLs are temporary S3 links (~72h) — persist to Cloudinary. */
async function persistMockup(url: string | null): Promise<string | null> {
  if (!url) return null;
  if (!/printful.*amazonaws|\/tmp\//.test(url)) return url; // already permanent
  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    return await uploadImage(Buffer.from(await res.arrayBuffer()), { folder: 'nanocrew/mockups' });
  } catch {
    return url;
  }
}

// POST /api/publish — turn a composition into a LIVE Printful sync product and mirror it
// into the local products/variants tables. The print file is always the upscaled RAW
// design PNG + saved position — never the AI composite or mockup.

interface VariantInput {
  printfulVariantId: number;
  retailPriceCents: number;
  size: string;
  color: string;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'product'
  );
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const body = (await req.json().catch(() => null)) as {
      compositionId?: string;
      name?: string;
      description?: string;
      variants?: VariantInput[];
    } | null;
    const name = body?.name?.trim();
    if (!body?.compositionId || !name || !body.variants?.length) {
      return Response.json({ error: 'compositionId, name, variants required' }, { status: 400 });
    }
    await assertCompositionOwner(body.compositionId, user.id);

    const [comp] = await db
      .select()
      .from(schema.compositions)
      .where(eq(schema.compositions.id, body.compositionId))
      .limit(1);
    if (!comp) return Response.json({ error: 'composition not found' }, { status: 404 });

    // Idempotent: already published → return the existing product.
    if (comp.status === 'published' && comp.printfulSyncProductId) {
      return Response.json({
        ok: true,
        alreadyPublished: true,
        printfulSyncProductId: comp.printfulSyncProductId,
      });
    }

    // One print file per placement, from the upscaled raw design.
    const placementList = comp.placements?.length
      ? comp.placements
      : [{ placement: comp.placement, designId: comp.designId, position: comp.position ?? null }];
    const designIds = [...new Set(placementList.map((p) => p.designId))];
    const designRows = await db
      .select({ id: schema.designs.id, url: schema.designs.url })
      .from(schema.designs)
      .where(inArray(schema.designs.id, designIds));
    const urlById = new Map(designRows.map((r) => [r.id, r.url]));

    const files = placementList
      .filter((p) => {
        const url = urlById.get(p.designId);
        return url && !url.startsWith('data:');
      })
      .map((p) => ({
        type: p.placement,
        url: upscaleForPrint(urlById.get(p.designId)!),
        ...(p.position
          ? {
              position: {
                area_width: p.position.areaWidth,
                area_height: p.position.areaHeight,
                width: p.position.width,
                height: p.position.height,
                top: p.position.top,
                left: p.position.left,
                ...(p.position.limitToPrintArea === false ? { limit_to_print_area: false } : {}),
              } satisfies MockupPosition,
            }
          : {}),
      }));
    if (!files.length) {
      return Response.json({ error: 'no usable print files (designs must be hosted)' }, { status: 400 });
    }

    const synced = await createSyncProduct(
      {
        sync_product: { name, thumbnail: comp.previewUrl ?? undefined },
        sync_variants: body.variants.map((v) => ({
          variant_id: v.printfulVariantId,
          retail_price: (v.retailPriceCents / 100).toFixed(2),
          files,
        })),
      },
      comp.id,
    );
    const syncProductId = String(synced.id);

    await db
      .update(schema.compositions)
      .set({ status: 'published', printfulSyncProductId: syncProductId })
      .where(eq(schema.compositions.id, comp.id));

    // Mirror into the local catalog (feeds the Market tab + the feed) — the composition
    // already knows which store it belongs to.
    const [product] = await db
      .insert(schema.products)
      .values({
        storeId: comp.storeId,
        catalogueId: comp.catalogueId ?? null, // the collection/drop this product lives in
        printfulSyncProductId: syncProductId,
        slug: `${slugify(name)}-${syncProductId}`,
        name,
        descriptionMd: body.description?.trim() || null,
        imageUrl: await persistMockup(comp.previewUrl ?? null),
        isPublished: true,
      })
      .returning({ id: schema.products.id, slug: schema.products.slug });

    // Capture our Printful cost per variant so the cockpit can show real margin. Best
    // effort — a pricing hiccup must not fail the publish (cost stays null, margin hidden).
    const costByVariant = new Map<number, number>();
    try {
      const catalog = await getCatalogVariants(comp.templateKey);
      for (const cv of catalog) costByVariant.set(cv.id, cv.priceCents);
    } catch {
      /* leave costs null */
    }

    await db.insert(schema.variants).values(
      body.variants.map((v) => ({
        productId: product.id,
        sku: `${syncProductId}-${v.printfulVariantId}`,
        color: v.color,
        size: v.size,
        retailPriceCents: v.retailPriceCents,
        printfulCostCents: costByVariant.get(v.printfulVariantId) ?? null,
      })),
    );

    return Response.json({ ok: true, printfulSyncProductId: syncProductId, product });
  } catch (e) {
    const status = e instanceof TenantError ? e.status : 502;
    return Response.json({ error: e instanceof Error ? e.message : 'Publish failed' }, { status });
  }
}
