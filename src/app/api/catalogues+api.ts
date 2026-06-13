import { asc, eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { TenantError, getCreatorStore } from '@/lib/tenant';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function fail(e: unknown) {
  const status = e instanceof TenantError ? e.status : 500;
  return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status });
}

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const store = await getCreatorStore(user.id);
    const rows = await db
      .select({ id: schema.catalogues.id, name: schema.catalogues.name, slug: schema.catalogues.slug })
      .from(schema.catalogues)
      .where(eq(schema.catalogues.storeId, store.id))
      .orderBy(asc(schema.catalogues.sortOrder), asc(schema.catalogues.createdAt));
    return Response.json({ catalogues: rows });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const body = (await req.json().catch(() => null)) as { name?: string; season?: string } | null;
    const name = body?.name?.trim();
    if (!name) return Response.json({ error: 'name is required' }, { status: 400 });
    const season = body?.season?.trim() || null;
    const store = await getCreatorStore(user.id);
    const [row] = await db
      .insert(schema.catalogues)
      .values({ storeId: store.id, name, slug: slugify(name), season })
      .returning({ id: schema.catalogues.id, name: schema.catalogues.name, slug: schema.catalogues.slug });
    return Response.json({ catalogue: row });
  } catch (e) {
    return fail(e);
  }
}
