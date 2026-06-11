import { getBlankColors } from '@/lib/printful';

// GET /api/blank/:id/colors → { colors: [{ color, colorCode, image }] }
export async function GET(_req: Request, { id }: Record<string, string>) {
  if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
  try {
    const colors = await getBlankColors(id);
    return Response.json({ colors });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Failed to load colors' },
      { status: 502 },
    );
  }
}
