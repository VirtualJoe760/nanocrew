import { getUserFromRequest } from '@/lib/auth';
import { getCatalogBlanks } from '@/lib/printful';

// Full Printful blank catalogue (gender bucket + type + thumbnail). Cached server-side.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const blanks = await getCatalogBlanks();
    return Response.json({ blanks });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Failed to load catalogue' },
      { status: 502 },
    );
  }
}
