import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { uploadVideo } from '@/lib/cloudinary';
import { generateProductVideo } from '@/lib/veo';
import { generateVoiceoverAd } from '@/lib/voiceover-ad';

// POST /api/video { productId, mode? } — generate a product video for the feed and save
// videoUrl on the product.
//   mode 'voiceover' (default) — CHEAP (~$0.10): product image + Ken-Burns + ElevenLabs
//     voiceover ad line, composited with ffmpeg.
//   mode 'veo' — PREMIUM (dollars/clip): Veo 3 generative motion of the garment.
// Cached on the product row; never on-demand per viewer.
export async function POST(req: Request) {
  try {
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
      .select({ name: schema.stores.name, tagline: schema.stores.tagline })
      .from(schema.stores)
      .where(eq(schema.stores.id, product.storeId))
      .limit(1);

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
    return Response.json({ error: e instanceof Error ? e.message : 'Video failed' }, { status: 502 });
  }
}
