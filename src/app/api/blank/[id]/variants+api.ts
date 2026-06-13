import { getUserFromRequest } from '@/lib/auth';
import { getCatalogVariants } from '@/lib/printful';

// GET /api/blank/:id/variants → { variants: [{ id, size, color, colorCode, priceCents, image }] }
export async function GET(req: Request, { id }: Record<string, string>) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
  try {
    const variants = await getCatalogVariants(id);
    return Response.json({ variants });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Failed to load variants' },
      { status: 502 },
    );
  }
}
