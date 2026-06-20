import { and, eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { updateBrandJson } from '@/lib/brand-config';
import { buildBrandPatch } from '@/lib/brand-identity';
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

  // Compute the FULL identity cascade in one place (src/lib/brand-identity.ts). A rename/story/tagline
  // edit must propagate to every surface a brand's identity lives in — stores columns, brand_profile
  // (AI ground-truth), the mini-CMS site_config.copy overrides (which win on the live site), and the
  // baked brand.json (header + SEO). On a rename the old name is swapped → new everywhere it's embedded,
  // and the baked logo + OG card (which carry the old identity) are cleared so the creator remakes them.
  const cascade = buildBrandPatch(r, b);
  if (!Object.keys(cascade.dbPatch).length) return Response.json({ error: 'nothing to update' }, { status: 400 });

  const [updated] = await db
    .update(schema.stores)
    .set(cascade.dbPatch as Partial<typeof schema.stores.$inferInsert>)
    .where(eq(schema.stores.id, r.id))
    .returning();

  // Any identity change rebuilds the site (brand.json drives the header + SEO/meta/JSON-LD) and
  // revalidates the runtime reads (tagline/copy). isPublic-only edits just revalidate.
  void revalidateStorefront(updated.slug);
  if (cascade.brandJson) void updateBrandJson(updated.slug, cascade.brandJson);

  return Response.json({ store: summary(updated), logoCleared: cascade.nameChanged });
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
