import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { storeForMember } from '@/lib/tenant';

type Annotation = { url: string; width: number; strokes: { x: number; y: number }[][] };
type Turn = { role: 'user' | 'assistant'; text: string };
type ImageOutcome = { slot: string; prompt: string; generated?: boolean; placed?: boolean; error?: string | null };
type EditPlan = { images?: ImageOutcome[]; edits?: string[] };

// POST /api/creator/revise { storeSlug, requestMd?, transcript?, editPlan?, screenshots?, annotations? }
//
// Records ONE durable row per submit from the live-site editor — the single place to debug an edit:
//   • transcript  — the raw Venus↔creator turns ("what was said")
//   • editPlan    — the structured outcome of the WHOLE submit: every image (generated? placed?
//                   error?) and every forge edit, with counts ("how many requests + what happened")
//   • requestMd   — the distilled note the forge actually receives
//
// Two shapes:
//   • forge edits present  → status 'building', enqueued on a working branch for the droplet worker.
//   • image-only (no edits) → status 'applied' is N/A; we record it as 'approved' (the images were
//     written straight to the live site already, so there's nothing to build/review) and do NOT
//     enqueue a forge job. We still keep the full transcript + editPlan for debugging.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json()) as {
      storeSlug?: string;
      requestMd?: string;
      transcript?: Turn[];
      editPlan?: EditPlan;
      screenshots?: string[];
      annotations?: Annotation[];
    };
    if (!b.storeSlug) return Response.json({ error: 'storeSlug required' }, { status: 400 });
    const store = await storeForMember(b.storeSlug, user.id);
    if (!store) return Response.json({ error: 'not found' }, { status: 404 });

    const annotations = (Array.isArray(b.annotations) ? b.annotations : [])
      .filter((a) => a && typeof a.url === 'string' && Array.isArray(a.strokes) && a.strokes.length > 0)
      .slice(0, 8);
    // Raw Venus↔creator turns kept alongside the distilled requestMd — lets us trace
    // "what the creator said" vs "what was captured/forged" when a request goes wrong.
    const transcript = (Array.isArray(b.transcript) ? b.transcript : [])
      .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string')
      .map((t) => ({ role: t.role, text: String(t.text).slice(0, 2000) }))
      .slice(-60);

    // Normalize the structured outcome so it's always queryable, with counts derived server-side.
    const rawImages = Array.isArray(b.editPlan?.images) ? b.editPlan!.images! : [];
    const images: ImageOutcome[] = rawImages
      .filter((i) => i && typeof i.slot === 'string')
      .map((i) => ({
        slot: String(i.slot),
        prompt: String(i.prompt ?? '').slice(0, 600),
        generated: !!i.generated,
        placed: !!i.placed,
        error: i.error ? String(i.error).slice(0, 300) : null,
      }))
      .slice(0, 8);
    const planEdits = (Array.isArray(b.editPlan?.edits) ? b.editPlan!.edits! : [])
      .filter((e) => typeof e === 'string' && e.trim())
      .map((e) => e.trim())
      .slice(0, 20);
    const editPlan = {
      images,
      edits: planEdits,
      counts: { images: images.length, edits: planEdits.length, total: images.length + planEdits.length },
    };

    const hasForgeWork = !!b.requestMd?.trim();
    // Require SOMETHING to record — either a forge note or at least one image attempt.
    if (!hasForgeWork && images.length === 0) {
      return Response.json({ error: 'requestMd or editPlan.images required' }, { status: 400 });
    }

    const requestMd = hasForgeWork
      ? b.requestMd!.trim()
      : `(image-only submit — applied directly to the live site)\n\n${images.map((i, n) => `${n + 1}. ${i.slot}: ${i.placed ? 'placed' : i.generated ? 'generated, not placed' : `failed${i.error ? ` — ${i.error}` : ''}`}`).join('\n')}`;
    const branch = hasForgeWork ? `revision/${Date.now().toString(36)}` : `direct/${Date.now().toString(36)}`;
    const status = hasForgeWork ? 'building' : 'approved'; // image-only is already live → nothing to build/review

    const [rev] = await db
      .insert(schema.storeRevisions)
      .values({
        storeId: store.id,
        requestMd,
        transcript: transcript.length ? transcript : null,
        editPlan,
        screenshots: annotations,
        status,
        branch,
      })
      .returning({ id: schema.storeRevisions.id });

    // One greppable summary line per submit: how many requests were made and what happened to each.
    const imgSummary = images.map((i) => `${i.slot}:${i.placed ? 'placed' : i.generated ? 'gen-only' : 'FAILED'}`).join(',') || 'none';
    console.log(
      `[pipeline:submit] slug=${b.storeSlug} turns=${transcript.length} requests=${editPlan.counts.total} ` +
        `images=${images.length}[${imgSummary}] edits=${planEdits.length} forge=${hasForgeWork ? `building(${branch})` : 'none'}`,
    );

    return Response.json({ revisionId: rev.id, branch, status, counts: editPlan.counts });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
