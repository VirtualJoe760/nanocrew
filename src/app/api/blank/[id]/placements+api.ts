import { getBlankPlacements } from '@/lib/printful';

// GET /api/blank/:id/placements → { placements: [{ key, label, allOver }] }
export async function GET(_req: Request, { id }: Record<string, string>) {
  if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
  try {
    const placements = await getBlankPlacements(id);
    return Response.json({ placements });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Failed to load placements' },
      { status: 502 },
    );
  }
}
