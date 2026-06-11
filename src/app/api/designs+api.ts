import { db, schema } from '@/lib/db';
import { getStoreIdForCatalogue } from '@/lib/tenant';
import { uploadImage } from '@/lib/cloudinary';

// POST /api/designs → store an uploaded image (data URL) as a design row.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      catalogueId?: string;
      dataUrl?: string;
      name?: string;
    } | null;
    const dataUrl = body?.dataUrl;
    if (!body?.catalogueId || !dataUrl?.startsWith('data:')) {
      return Response.json({ error: 'catalogueId and dataUrl required' }, { status: 400 });
    }
    const comma = dataUrl.indexOf(',');
    const buffer = Buffer.from(dataUrl.slice(comma + 1), 'base64');
    if (buffer.length > 10 * 1024 * 1024) {
      return Response.json({ error: 'image too large (max 10MB)' }, { status: 400 });
    }

    let url = dataUrl;
    try {
      url = await uploadImage(buffer, { folder: 'nanocrew/designs' });
    } catch {
      // Cloudinary down — keep the data URL so the upload still works (heavier row).
    }

    const storeId = await getStoreIdForCatalogue(body.catalogueId);
    const [row] = await db
      .insert(schema.designs)
      .values({
        storeId,
        catalogueId: body.catalogueId,
        prompt: body.name?.trim() || 'Uploaded image',
        url,
      })
      .returning({ id: schema.designs.id, prompt: schema.designs.prompt, url: schema.designs.url });
    return Response.json({ design: row });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
