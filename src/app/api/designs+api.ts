import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { TenantError, assertCatalogueOwner } from '@/lib/tenant';
import { uploadImage } from '@/lib/cloudinary';

// POST /api/designs → store an uploaded image (data URL) as a design row.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const body = (await req.json().catch(() => null)) as {
      catalogueId?: string;
      dataUrl?: string;
      url?: string;
      name?: string;
    } | null;
    const dataUrl = body?.dataUrl;
    // Two ways to register a design: an uploaded data URL (we upload it), or an
    // already-hosted https URL (e.g. an approved staged generation — store as-is, no re-upload).
    const hostedUrl =
      typeof body?.url === 'string' && /^https:\/\//.test(body.url) ? body.url : null;
    if (!body?.catalogueId || (!dataUrl?.startsWith('data:') && !hostedUrl)) {
      return Response.json({ error: 'catalogueId and dataUrl or url required' }, { status: 400 });
    }

    let url = hostedUrl ?? dataUrl!;
    if (!hostedUrl) {
      const comma = dataUrl!.indexOf(',');
      const buffer = Buffer.from(dataUrl!.slice(comma + 1), 'base64');
      if (buffer.length > 10 * 1024 * 1024) {
        return Response.json({ error: 'image too large (max 10MB)' }, { status: 400 });
      }
      try {
        url = await uploadImage(buffer, { folder: 'nanocrew/designs' });
      } catch {
        // Cloudinary down — keep the data URL so the upload still works (heavier row).
      }
    }

    const storeId = await assertCatalogueOwner(body.catalogueId, user.id);
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
    const status = e instanceof TenantError ? e.status : 500;
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status });
  }
}
