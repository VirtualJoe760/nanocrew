import { getUserFromRequest } from '@/lib/auth';
import { giftRemaining, proposeFirstDropIdeas } from '@/lib/first-drop';
import { guardRate } from '@/lib/rate-limit';
import { storeForMember } from '@/lib/tenant';

// POST /api/creator/first-drop/propose { storeSlug, count? } → { ideas }
//
// The EVE-GUIDED door of the first drop (Joe, 2026-08-20: she proposes each demo product aloud
// for a quick OK instead of the silent AUTO_FIRST_DROP path). Pure proposal — Gemini invents the
// palette-constrained concepts, nothing is generated or written, no credits spent. The companion
// `create` endpoint builds one approved concept per call as the free onboarding gift, so this
// carries the same GIFT GATE: only a store that is still essentially empty (< 4 products)
// qualifies — otherwise 'propose' is just free ideation, which is the paid /api/idea's job.

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const limited = await guardRate(`first-drop-propose:${user.id}`, 6, 60);
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as { storeSlug?: string; count?: number } | null;
  if (!body?.storeSlug) return Response.json({ error: 'storeSlug required' }, { status: 400 });

  const store = await storeForMember(body.storeSlug, user.id);
  if (!store) return Response.json({ error: 'store not found' }, { status: 404 });

  const remaining = await giftRemaining(store.id);
  if (!remaining) return Response.json({ error: 'first drop already stocked' }, { status: 403 });

  try {
    const ideas = await proposeFirstDropIdeas(store.id, Math.min(body.count ?? remaining, remaining));
    return Response.json({ ideas, remaining });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 502 });
  }
}
