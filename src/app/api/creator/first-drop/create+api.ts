import { getUserFromRequest } from '@/lib/auth';
import { createFirstDropProduct, giftRemaining, type FirstDropIdea } from '@/lib/first-drop';
import { guardRate } from '@/lib/rate-limit';
import { storeForMember } from '@/lib/tenant';

// POST /api/creator/first-drop/create { storeSlug, idea: {garment, name, prompt} } → { started }
//
// Builds ONE approved first-drop concept end to end (design → composition → mockup → publish)
// as the FREE onboarding gift — server-to-server via the internal identity, so nothing debits
// the creator (same exemption as the silent AUTO_FIRST_DROP door). Fire-and-forget: the build
// takes a minute or two, and Eve keeps the conversation moving while it runs; the product
// appears in the catalogue (and the site repaints) when it lands.
//
// GIFT GATE: only while the store has fewer than 4 products — after that, designing goes
// through the normal paid pipeline. The idea usually comes from `propose`, but a creator may
// have voice-tweaked it ("make it a sweatshirt instead") — it's their gift either way.

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const limited = await guardRate(`first-drop-create:${user.id}`, 8, 60);
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as { storeSlug?: string; idea?: Partial<FirstDropIdea> } | null;
  const idea = body?.idea;
  if (!body?.storeSlug || !idea?.name || !idea.prompt) {
    return Response.json({ error: 'storeSlug and idea {garment, name, prompt} required' }, { status: 400 });
  }

  const store = await storeForMember(body.storeSlug, user.id);
  if (!store) return Response.json({ error: 'store not found' }, { status: 404 });

  const remaining = await giftRemaining(store.id);
  if (!remaining) return Response.json({ error: 'first drop already stocked' }, { status: 403 });

  const clean: FirstDropIdea = {
    garment: idea.garment === 'sweatshirt' ? 'sweatshirt' : 'tee',
    name: String(idea.name).slice(0, 60),
    prompt: String(idea.prompt).slice(0, 500),
  };

  void createFirstDropProduct({ storeId: store.id, baseUrl: new URL(req.url).origin, idea: clean }).catch((e) =>
    console.warn('[first-drop] guided create failed:', e instanceof Error ? e.message : e),
  );
  return Response.json({ started: true, name: clean.name, remaining: remaining - 1 });
}
