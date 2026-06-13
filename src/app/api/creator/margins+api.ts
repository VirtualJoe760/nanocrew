import { and, eq, min, sql } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';

// GET /api/creator/margins — per-product unit economics across the creator's stores:
// retail (cheapest variant), our Printful cost, and the margin between them. Products whose
// cost wasn't captured (older publishes) are returned with cost/margin null. Feeds the
// cockpit's MARGINS section so creators see profit, not just revenue.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const rows = await db
      .select({
        productId: schema.products.id,
        name: schema.products.name,
        storeName: schema.stores.name,
        retailCents: min(schema.variants.retailPriceCents),
        costCents: min(schema.variants.printfulCostCents),
      })
      .from(schema.products)
      .innerJoin(schema.stores, eq(schema.products.storeId, schema.stores.id))
      .leftJoin(schema.variants, eq(schema.variants.productId, schema.products.id))
      .where(and(eq(schema.stores.creatorId, user.id), eq(schema.products.isPublished, true)))
      .groupBy(schema.products.id, schema.stores.name)
      .orderBy(sql`min(${schema.variants.printfulCostCents}) is null, ${schema.products.name}`);

    const products = rows.map((r) => {
      const retail = r.retailCents ?? null;
      const cost = r.costCents ?? null;
      const marginCents = retail != null && cost != null ? retail - cost : null;
      const marginPct = marginCents != null && retail ? Math.round((marginCents / retail) * 100) : null;
      return { productId: r.productId, name: r.name, storeName: r.storeName, retailCents: retail, costCents: cost, marginCents, marginPct };
    });

    const withCost = products.filter((p) => p.marginCents != null);
    const avgMarginPct = withCost.length
      ? Math.round(withCost.reduce((n, p) => n + (p.marginPct ?? 0), 0) / withCost.length)
      : null;

    return Response.json({ products, avgMarginPct });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
