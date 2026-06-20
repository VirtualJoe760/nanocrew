import { and, eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { revalidateStorefront } from '@/lib/storefront-revalidate';

// GET   /api/creator/stores/:slug — the creator's store settings + lifecycle status.
// PATCH /api/creator/stores/:slug { name?, tagline?, descriptionMd?, isPublic? } — update
//   post-creation settings. The slug is immutable (it ties the repo / Vercel project / brand.json).
//   Custom-domain + "go live" land here in Phase C (lifecycle: building → ready → live).

type Store = typeof schema.stores.$inferSelect;

async function resolve(req: Request, slug: string): Promise<Store | Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const [store] = await db
    .select()
    .from(schema.stores)
    .where(and(eq(schema.stores.slug, slug), eq(schema.stores.creatorId, user.id)))
    .limit(1);
  if (!store) return Response.json({ error: 'not found' }, { status: 404 });
  return store;
}

function summary(s: Store) {
  return {
    slug: s.slug,
    name: s.name,
    tagline: s.tagline,
    descriptionMd: s.descriptionMd,
    status: s.status, // draft | building | ready | live | suspended
    isPublic: s.isPublic, // marketplace visibility (separate from lifecycle)
    customDomain: s.customDomain,
    deploymentUrl: s.deploymentUrl,
  };
}

export async function GET(req: Request, { slug }: Record<string, string>) {
  const r = await resolve(req, slug);
  if (r instanceof Response) return r;
  return Response.json({ store: summary(r) });
}

export async function PATCH(req: Request, { slug }: Record<string, string>) {
  const r = await resolve(req, slug);
  if (r instanceof Response) return r;

  const b = (await req.json().catch(() => null)) as
    | { name?: string; tagline?: string; descriptionMd?: string; isPublic?: boolean }
    | null;
  if (!b) return Response.json({ error: 'invalid body' }, { status: 400 });

  const patch: Partial<typeof schema.stores.$inferInsert> = {};
  if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim().slice(0, 120);
  if (typeof b.tagline === 'string') patch.tagline = b.tagline.trim().slice(0, 200) || null;
  if (typeof b.descriptionMd === 'string') patch.descriptionMd = b.descriptionMd.trim() || null;
  if (typeof b.isPublic === 'boolean') patch.isPublic = b.isPublic;
  if (!Object.keys(patch).length) return Response.json({ error: 'nothing to update' }, { status: 400 });

  const [updated] = await db.update(schema.stores).set(patch).where(eq(schema.stores.id, r.id)).returning();
  // Refresh the live storefront so anything it reads at runtime (tagline/meta) reflects the change.
  // NOTE: the brand NAME shown on the site comes from baked brand.json / the logo, so a name change
  // shows in-app immediately but needs a rebuild (or the logo) to change the on-site header.
  void revalidateStorefront(updated.slug);
  return Response.json({ store: summary(updated) });
}

// DELETE /api/creator/stores/:slug — permanently delete this brand. Owner-only (resolve() checks
// creatorId, so collaborators can't). Deleting the store row cascades to its catalogues, designs,
// products, variants, orders, posts, page_views, collaborators, and revisions (all FK
// onDelete: cascade). External resources (Printful sub-store, GitHub repo, Vercel project) are left
// and cleaned up out of band — same policy as account deletion (DELETE /api/me).
export async function DELETE(req: Request, { slug }: Record<string, string>) {
  const r = await resolve(req, slug);
  if (r instanceof Response) return r;
  await db.delete(schema.stores).where(eq(schema.stores.id, r.id));
  return Response.json({ ok: true });
}
