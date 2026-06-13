import { getUserFromRequest } from '@/lib/auth';
import { guardRate } from '@/lib/rate-limit';
import { uploadImage } from '@/lib/cloudinary';

// POST /api/creator/upload { dataUrl } — host an image (e.g. a post cover) on Cloudinary
// and return its URL. Authed + rate-limited; no DB row, just media hosting.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const limited = await guardRate(`upload:${user.id}`, 30, 60);
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as { dataUrl?: string; folder?: string } | null;
  const dataUrl = body?.dataUrl;
  if (!dataUrl?.startsWith('data:')) return Response.json({ error: 'dataUrl required' }, { status: 400 });

  const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  if (buffer.length > 10 * 1024 * 1024) return Response.json({ error: 'image too large (max 10MB)' }, { status: 400 });

  try {
    const url = await uploadImage(buffer, { folder: 'nanocrew/uploads' });
    return Response.json({ url });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Upload failed' }, { status: 502 });
  }
}
