import { getUserFromRequest } from '@/lib/auth';
import { getMockupTemplate } from '@/lib/printful';

// GET /api/blank/:id/template?placement=front → { template: MockupTemplateGeom | null }
// The flat mockup image + REAL print-area fractions, so previews blend the design onto the
// garment's actual print zone (never a hardcoded rectangle over a full-body photo).
export async function GET(req: Request, { id }: Record<string, string>) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
  const placement = new URL(req.url).searchParams.get('placement') ?? 'front';
  try {
    const template = await getMockupTemplate(id, placement);
    return Response.json({ template });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed to load template' }, { status: 502 });
  }
}
