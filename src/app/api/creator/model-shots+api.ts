import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { isStoreMember } from '@/lib/tenant';
import { CREDIT_COSTS, debit, grant, InsufficientCreditsError } from '@/lib/credits';
import { generateModelShotsFromMockup } from '@/lib/model-shots';

// POST /api/creator/model-shots { productId } — generate an on-model photo gallery for one of
// the creator's products (Nano Banana). Ownership-checked + credit-gated; debits before
// generating and refunds if nothing comes back. Stores the URLs on products.model_shots.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { productId?: string } | null;
  if (!body?.productId) return Response.json({ error: 'productId required' }, { status: 400 });

  const [product] = await db
    .select({
      id: schema.products.id,
      imageUrl: schema.products.imageUrl,
      storeId: schema.products.storeId,
      compositionId: schema.products.compositionId,
    })
    .from(schema.products)
    .where(eq(schema.products.id, body.productId))
    .limit(1);
  if (!product) return Response.json({ error: 'product not found' }, { status: 404 });
  if (!product.imageUrl) return Response.json({ error: 'product has no image' }, { status: 400 });

  const [store] = await db
    .select({ creatorId: schema.stores.creatorId })
    .from(schema.stores)
    .where(eq(schema.stores.id, product.storeId))
    .limit(1);
  if (!store || !(await isStoreMember(product.storeId, user.id))) return Response.json({ error: 'not your product' }, { status: 403 });

  try {
    await debit(user.id, 'model_shots', product.id);
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return Response.json({ error: 'insufficient_credits', needed: e.needed, balance: e.balance }, { status: 402 });
    }
    throw e;
  }

  // Placement-aware (2026-08-20): resolve the source composition's placements so a back print is
  // shot from behind, not photographed invisibly from the front. Pre-link products (null
  // compositionId, before migration 0031) fall back to a front-framed shot — same as before.
  let placements: { placement: string; label: string }[] = [];
  if (product.compositionId) {
    const [comp] = await db
      .select({ placement: schema.compositions.placement, placements: schema.compositions.placements })
      .from(schema.compositions)
      .where(eq(schema.compositions.id, product.compositionId))
      .limit(1);
    const list = comp?.placements?.length ? comp.placements.map((p) => p.placement) : comp?.placement ? [comp.placement] : [];
    placements = [...new Set(list)].map((p) => ({ placement: p, label: p }));
  }

  try {
    const shots = await generateModelShotsFromMockup(product.imageUrl, placements, 3);
    if (!shots.length) throw new Error('no shots generated');
    await db.update(schema.products).set({ modelShots: shots }).where(eq(schema.products.id, product.id));
    return Response.json({ modelShots: shots });
  } catch (e) {
    await grant(user.id, CREDIT_COSTS.model_shots, 'refund', product.id).catch(() => {});
    return Response.json({ error: e instanceof Error ? e.message : 'Model shots failed' }, { status: 502 });
  }
}
