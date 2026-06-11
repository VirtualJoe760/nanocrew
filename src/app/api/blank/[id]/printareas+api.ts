import { getBlankPrintareas } from '@/lib/printful';

// GET /api/blank/:id/printareas → { areas: [{ placement, label, areaWidth, areaHeight }], variantId }
export async function GET(_req: Request, { id }: Record<string, string>) {
  if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
  try {
    const result = await getBlankPrintareas(id);
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Failed to load print areas' },
      { status: 502 },
    );
  }
}
