import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { isStoreMember } from '@/lib/tenant';
import { guardRate } from '@/lib/rate-limit';
import { CREDIT_COSTS, debit, grant, InsufficientCreditsError } from '@/lib/credits';
import { generateModelVideo } from '@/lib/model-video';

// POST /api/creator/model-videos { productId } — generate one on-model Veo video for a product
// (the video sibling of /api/creator/model-shots). Builds the storefront's on-model video
// gallery + the site's featured video wall. Ownership-checked, rate-limited (Veo is the
// priciest call), and credit-gated: debits before generating and refunds if nothing comes
// back. Appends to products.model_videos, capped at 3 angles (replaces once full).
const MAX_VIDEOS = 3;

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // A Veo clip is dollars + minutes — cap to 4 per 10 min per creator.
  const limited = await guardRate(`model-video:${user.id}`, 4, 600);
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as { productId?: string } | null;
  if (!body?.productId) return Response.json({ error: 'productId required' }, { status: 400 });

  const [product] = await db
    .select({ id: schema.products.id, name: schema.products.name, imageUrl: schema.products.imageUrl, storeId: schema.products.storeId, modelVideos: schema.products.modelVideos })
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
    await debit(user.id, 'video_veo', product.id);
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return Response.json({ error: 'insufficient_credits', needed: e.needed, balance: e.balance }, { status: 402 });
    }
    throw e;
  }

  const existing = product.modelVideos ?? [];
  try {
    const url = await generateModelVideo({ imageUrl: product.imageUrl, name: product.name, index: existing.length });
    // Append a new angle; once the gallery is full, regenerating starts a fresh set.
    const modelVideos = existing.length >= MAX_VIDEOS ? [url] : [...existing, url];
    await db.update(schema.products).set({ modelVideos }).where(eq(schema.products.id, product.id));
    return Response.json({ modelVideos });
  } catch (e) {
    await grant(user.id, CREDIT_COSTS.video_veo, 'refund', product.id).catch(() => {});
    return Response.json({ error: e instanceof Error ? e.message : 'Model video failed' }, { status: 502 });
  }
}
