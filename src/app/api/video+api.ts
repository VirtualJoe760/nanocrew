import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { isStoreMember } from '@/lib/tenant';
import { uploadVideo } from '@/lib/cloudinary';
import { generateProductVideo } from '@/lib/veo';
import { generateVoiceoverAd } from '@/lib/voiceover-ad';
import { CREDIT_COSTS, debit, grant, InsufficientCreditsError } from '@/lib/credits';

// POST /api/video { productId, mode? } — generate a product video for the feed and save
// videoUrl on the product.
//   mode 'voiceover' (default) — CHEAP (~$0.10): product image + Ken-Burns + ElevenLabs
//     voiceover ad line, composited with ffmpeg.
//   mode 'veo' — PREMIUM (dollars/clip): Veo 3 generative motion of the garment.
// Cached on the product row; never on-demand per viewer. The creator must own the product's
// store and have the credits — we debit before generating and refund if it fails.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { productId?: string; mode?: 'voiceover' | 'veo'; force?: boolean } | null;
  if (!body?.productId) return Response.json({ error: 'productId required' }, { status: 400 });

  const [product] = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.id, body.productId))
    .limit(1);
  if (!product) return Response.json({ error: 'product not found' }, { status: 404 });
  if (product.videoUrl && !body.force) return Response.json({ videoUrl: product.videoUrl, cached: true });
  if (!product.imageUrl) return Response.json({ error: 'product has no image' }, { status: 400 });

  const [store] = await db
    .select({ name: schema.stores.name, tagline: schema.stores.tagline, creatorId: schema.stores.creatorId })
    .from(schema.stores)
    .where(eq(schema.stores.id, product.storeId))
    .limit(1);
  if (!store || !(await isStoreMember(product.storeId, user.id))) return Response.json({ error: 'not your product' }, { status: 403 });

  // Charge before generating; refund if generation/upload fails so a failed render is free.
  const op = body.mode === 'veo' ? 'video_veo' : 'video_voiceover';
  try {
    await debit(user.id, op, product.id);
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return Response.json({ error: 'insufficient_credits', needed: e.needed, balance: e.balance }, { status: 402 });
    }
    throw e;
  }

  try {
    let buffer: Buffer;
    if (body.mode === 'veo') {
      const prompt =
        `Slow cinematic product showcase of this garment ("${product.name}") on an invisible ` +
        'mannequin, gentle 360 rotation, soft studio lighting, subtle fabric movement, ' +
        'clean minimal background, premium streetwear commercial feel. Vertical format.';
      buffer = await generateProductVideo({ prompt, imageUrl: product.imageUrl });
    } else {
      buffer = await generateVoiceoverAd({
        name: product.name,
        storeName: store?.name ?? 'Nanocrew',
        tagline: store?.tagline ?? null,
        imageUrl: product.imageUrl,
      });
    }

    const videoUrl = await uploadVideo(buffer, { folder: 'nanocrew/videos' });
    await db.update(schema.products).set({ videoUrl }).where(eq(schema.products.id, product.id));
    return Response.json({ videoUrl, mode: body.mode ?? 'voiceover' });
  } catch (e) {
    await grant(user.id, CREDIT_COSTS[op], 'refund', product.id).catch(() => {});
    return Response.json({ error: e instanceof Error ? e.message : 'Video failed' }, { status: 502 });
  }
}
