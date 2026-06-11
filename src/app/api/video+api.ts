import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { uploadVideo } from '@/lib/cloudinary';
import { generateProductVideo } from '@/lib/veo';

// POST /api/video { productId } — generate (or return the cached) Veo product video,
// host it on Cloudinary, save videoUrl on the product. EXPENSIVE: seeding/curation only.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { productId?: string } | null;
    if (!body?.productId) return Response.json({ error: 'productId required' }, { status: 400 });

    const [product] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, body.productId))
      .limit(1);
    if (!product) return Response.json({ error: 'product not found' }, { status: 404 });
    if (product.videoUrl) return Response.json({ videoUrl: product.videoUrl, cached: true });
    if (!product.imageUrl) return Response.json({ error: 'product has no image' }, { status: 400 });

    const prompt =
      `Slow cinematic product showcase of this garment ("${product.name}") on an invisible ` +
      'mannequin, gentle 360 rotation, soft studio lighting, subtle fabric movement, ' +
      'clean minimal background, premium streetwear commercial feel. Vertical format.';

    const buffer = await generateProductVideo({ prompt, imageUrl: product.imageUrl });
    const videoUrl = await uploadVideo(buffer, { folder: 'nanocrew/videos' });

    await db
      .update(schema.products)
      .set({ videoUrl })
      .where(eq(schema.products.id, product.id));

    return Response.json({ videoUrl });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Video failed' }, { status: 502 });
  }
}
