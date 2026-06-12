import { desc, sql } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';

// GET /api/platform/admin — the whole platform at a glance. Admin emails only.
const ADMIN_EMAILS = (process.env.PLATFORM_ADMIN_EMAILS ?? 'josephsardella@gmail.com')
  .split(',')
  .map((e) => e.trim().toLowerCase());

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user || !ADMIN_EMAILS.includes(user.email.toLowerCase())) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const stores = await db
      .select({
        id: schema.stores.id,
        name: schema.stores.name,
        slug: schema.stores.slug,
        status: schema.stores.status,
        deploymentUrl: schema.stores.deploymentUrl,
        createdAt: schema.stores.createdAt,
      })
      .from(schema.stores)
      .orderBy(desc(schema.stores.createdAt));
    const [totals] = await db
      .select({
        orders: sql<number>`count(*)`.mapWith(Number),
        revenueCents: sql<number>`coalesce(sum(${schema.orders.totalCents}), 0)`.mapWith(Number),
      })
      .from(schema.orders);
    const [creators] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.creators);
    return Response.json({ stores, totals, creators: creators.count });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
