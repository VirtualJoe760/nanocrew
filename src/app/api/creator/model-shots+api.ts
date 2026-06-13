import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { CREDIT_COSTS, debit, grant, InsufficientCreditsError } from '@/lib/credits';
import { generateModelShots } from '@/lib/model-shots';

// POST /api/creator/model-shots { productId } — generate an on-model photo gallery for one of
// the creator's products (Nano Banana). Ownership-checked + credit-gated; debits before
// generating and refunds if nothing comes back. Stores the URLs on products.model_shots.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { productId?: string } | null;
  if (!body?.productId) return Response.json({ error: 'productId required' }, { status: 400 });

  const [product] = await db
    .select({ id: schema.products.id, imageUrl: schema.products.imageUrl, storeId: schema.products.storeId })
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
  if (!store || store.creatorId !== user.id) return Response.json({ error: 'not your product' }, { status: 403 });

  try {
    await debit(user.id, 'model_shots', product.id);
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return Response.json({ error: 'insufficient_credits', needed: e.needed, balance: e.balance }, { status: 402 });
    }
    throw e;
  }

  try {
    const shots = await generateModelShots(product.imageUrl, 3);
    if (!shots.length) throw new Error('no shots generated');
    await db.update(schema.products).set({ modelShots: shots }).where(eq(schema.products.id, product.id));
    return Response.json({ modelShots: shots });
  } catch (e) {
    await grant(user.id, CREDIT_COSTS.model_shots, 'refund', product.id).catch(() => {});
    return Response.json({ error: e instanceof Error ? e.message : 'Model shots failed' }, { status: 502 });
  }
}
