import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { guardRate } from '@/lib/rate-limit';
import { CREDIT_COSTS, debit, grant, InsufficientCreditsError } from '@/lib/credits';
import { generateProductSceneVideo } from '@/lib/scene-video';
import type { SceneAspect } from '@/lib/seedance';

// POST /api/creator/scene-video { productId, scene, aspectRatio, target } — the "cool short":
// Nano Banana renders an on-model scene still, Seedance animates it. Publish to the storefront
// (target 'website' → appends to products.model_videos, capped at 3) or the Nanocrew feed
// (target 'feed' → products.video_url). Ownership-checked, rate-limited, credit-gated, refunds on fail.
const MAX_WEBSITE_VIDEOS = 3;

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // Generative video is the priciest call — cap to 4 per 10 min per creator.
  const limited = await guardRate(`scene-video:${user.id}`, 4, 600);
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as
    | { productId?: string; scene?: string; aspectRatio?: SceneAspect; target?: 'website' | 'feed' }
    | null;
  if (!body?.productId || !body.scene?.trim()) return Response.json({ error: 'productId and scene required' }, { status: 400 });
  const aspectRatio: SceneAspect = body.aspectRatio === '16:9' ? '16:9' : '9:16';
  const target = body.target === 'feed' ? 'feed' : 'website';

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
  if (!store || store.creatorId !== user.id) return Response.json({ error: 'not your product' }, { status: 403 });

  try {
    await debit(user.id, 'scene_video', product.id);
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return Response.json({ error: 'insufficient_credits', needed: e.needed, balance: e.balance }, { status: 402 });
    }
    throw e;
  }

  try {
    const { stillUrl, videoUrl } = await generateProductSceneVideo({
      imageUrl: product.imageUrl,
      name: product.name,
      scene: body.scene.trim().slice(0, 200),
      aspectRatio,
    });

    if (target === 'feed') {
      await db.update(schema.products).set({ videoUrl }).where(eq(schema.products.id, product.id));
    } else {
      const existing = product.modelVideos ?? [];
      const modelVideos = existing.length >= MAX_WEBSITE_VIDEOS ? [videoUrl] : [...existing, videoUrl];
      await db.update(schema.products).set({ modelVideos }).where(eq(schema.products.id, product.id));
    }
    return Response.json({ videoUrl, stillUrl, target, aspectRatio });
  } catch (e) {
    await grant(user.id, CREDIT_COSTS.scene_video, 'refund', product.id).catch(() => {});
    return Response.json({ error: e instanceof Error ? e.message : 'Scene video failed' }, { status: 502 });
  }
}
