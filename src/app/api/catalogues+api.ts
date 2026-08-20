import { and, asc, eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { TenantError, getCreatorStore, storeForMember } from '@/lib/tenant';

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
    // The Design tab and Eve both name the brand they're designing for (?store=<slug>); the
    // slug-less fallback resolves only for a single-brand creator — several brands is a 409,
    // never a guess (BUG_AUDIT_2026-08-20 #1). storeForMember access-checks the slug.
    const slug = new URL(req.url).searchParams.get('store');
    const store = slug ? await storeForMember(slug, user.id) : await getCreatorStore(user.id);
    if (!store) return Response.json({ error: 'store not found' }, { status: 404 });
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
    const body = (await req.json().catch(() => null)) as
      | { name?: string; season?: string; storeSlug?: string }
      | null;
    const name = body?.name?.trim();
    if (!name) return Response.json({ error: 'name is required' }, { status: 400 });
    const season = body?.season?.trim() || null;
    const store = body?.storeSlug
      ? await storeForMember(body.storeSlug, user.id)
      : await getCreatorStore(user.id);
    if (!store) return Response.json({ error: 'store not found' }, { status: 404 });
    const slug = slugify(name);
    // GET-OR-CREATE: (store_id, slug) is unique, and the client can legitimately ask to create a
    // collection that already exists — e.g. the Design tab re-requesting the "Web Assets" bucket before
    // its GET has populated the list, or a creator re-using a name. A plain insert would throw a unique
    // violation → 500, which blocked the whole collection step (and thus the product canvas). Instead,
    // skip the conflicting insert and return the existing row, so creating a collection is idempotent.
    const [created] = await db
      .insert(schema.catalogues)
      .values({ storeId: store.id, name, slug, season })
      .onConflictDoNothing({ target: [schema.catalogues.storeId, schema.catalogues.slug] })
      .returning({ id: schema.catalogues.id, name: schema.catalogues.name, slug: schema.catalogues.slug });
    if (created) return Response.json({ catalogue: created });
    const [existing] = await db
      .select({ id: schema.catalogues.id, name: schema.catalogues.name, slug: schema.catalogues.slug })
      .from(schema.catalogues)
      .where(and(eq(schema.catalogues.storeId, store.id), eq(schema.catalogues.slug, slug)))
      .limit(1);
    return Response.json({ catalogue: existing });
  } catch (e) {
    return fail(e);
  }
}
