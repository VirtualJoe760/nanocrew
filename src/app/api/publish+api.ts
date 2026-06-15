import { eq, inArray } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { uploadImage } from '@/lib/cloudinary';
import { db, schema } from '@/lib/db';
import { guardRate } from '@/lib/rate-limit';
import { TenantError, assertCompositionOwner } from '@/lib/tenant';
import { createSyncProduct, getCatalogVariants, upscaleForPrint, type MockupPosition } from '@/lib/printful';
import { minRetailCents } from '@/lib/pricing';
import { revalidateStorefront } from '@/lib/storefront-revalidate';

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
  const limited = await guardRate(`pf:${user.id}`, 30, 60);
  if (limited) return limited;
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

    // Capture our Printful cost per variant up front — both to enforce the price floor (a product
    // can't be sold below cost + margin) and to record real margin. Best effort: if the catalog
    // lookup hiccups we fall back to the absolute floor rather than failing the publish.
    const costByVariant = new Map<number, number>();
    try {
      const catalog = await getCatalogVariants(comp.templateKey);
      for (const cv of catalog) costByVariant.set(cv.id, cv.priceCents);
    } catch {
      /* leave costs null → minRetailCents falls back to the absolute floor */
    }

    // Price floor: never below the variant's cost + margin (or the absolute floor when cost unknown).
    const tooLow = body.variants.find((v) => v.retailPriceCents < minRetailCents(costByVariant.get(v.printfulVariantId) ?? null));
    if (tooLow) {
      const min = minRetailCents(costByVariant.get(tooLow.printfulVariantId) ?? null);
      return Response.json(
        { error: `Price too low for ${tooLow.size}/${tooLow.color}: minimum is $${(min / 100).toFixed(2)}.`, minRetailCents: min },
        { status: 400 },
      );
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

    // Refresh the brand's storefront so the newly-published product appears on the live site.
    const [store] = await db
      .select({ slug: schema.stores.slug })
      .from(schema.stores)
      .where(eq(schema.stores.id, comp.storeId))
      .limit(1);
    void revalidateStorefront(store?.slug);

    return Response.json({ ok: true, printfulSyncProductId: syncProductId, product });
  } catch (e) {
    const status = e instanceof TenantError ? e.status : 502;
    return Response.json({ error: e instanceof Error ? e.message : 'Publish failed' }, { status });
  }
}
