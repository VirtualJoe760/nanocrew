import { eq, inArray } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { corsJson, corsPreflight } from '@/lib/cors';
import { db, schema } from '@/lib/db';
import { accessibleStoreIds } from '@/lib/tenant';

export const OPTIONS = corsPreflight;
export const dynamic = 'force-dynamic';

// GET /api/creator/stores — every brand this creator can reach, owned or collaborated on.
// Mirrors the app's "Your brands" list (src/app/account.tsx): name, slug · status.
//
// `role` is the important field: only an OWNER may administer collaborators, so the web uses it to
// decide whether to offer that surface at all — the same rule the collaborators route enforces
// server-side. A collaborator seeing the brand is not a collaborator who may manage its members.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return corsJson({ error: 'unauthorized' }, { status: 401 });

  const ids = await accessibleStoreIds(user.id);
  if (!ids.length) return corsJson({ stores: [] });

  const rows = await db
    .select({
      id: schema.stores.id,
      slug: schema.stores.slug,
      name: schema.stores.name,
      status: schema.stores.status,
      creatorId: schema.stores.creatorId,
      customDomain: schema.stores.customDomain,
    })
    .from(schema.stores)
    .where(inArray(schema.stores.id, ids));

  const stores = rows
    .map(({ creatorId, ...s }) => ({ ...s, role: creatorId === user.id ? ('owner' as const) : ('collaborator' as const) }))
    .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'owner' ? -1 : 1));

  return corsJson({ stores });
}

// Kept next to the list so both read from the same place: a store's public web address, used by the
// account page's "view site" links.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return corsJson({ error: 'unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { slug?: string } | null;
  if (!b?.slug) return corsJson({ error: 'slug required' }, { status: 400 });

  const ids = await accessibleStoreIds(user.id);
  const [store] = await db
    .select({ id: schema.stores.id, slug: schema.stores.slug, customDomain: schema.stores.customDomain })
    .from(schema.stores)
    .where(eq(schema.stores.slug, b.slug))
    .limit(1);
  if (!store || !ids.includes(store.id)) return corsJson({ error: 'not found' }, { status: 404 });

  const base = (process.env.EMAIL_LINK_BASE ?? 'https://nanocrew.app').replace(/\/+$/, '');
  return corsJson({ url: store.customDomain ? `https://${store.customDomain}` : `${base}/b/${store.slug}` });
}
