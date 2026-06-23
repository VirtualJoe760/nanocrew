import { getUserFromRequest } from '@/lib/auth';
import { notifyPlatform } from '@/lib/notify-internal';

// POST /api/report — a user reports Market content (Apple Guideline 1.2 UGC moderation + the INFORM
// consumer-report mechanism). Best-effort: ALWAYS logs the report server-side (durable even if email
// is unconfigured) AND fires the ops email via the central notify route. Returns ok once authed so the
// UI can confirm. No DB write (migration-free MVP); pairs with the on-device block in lib/blocklist.ts.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as
    | { targetType?: string; slug?: string; reason?: string }
    | null;
  if (!body?.slug || !body?.reason?.trim()) {
    return Response.json({ error: 'slug and reason are required' }, { status: 400 });
  }
  const targetType = body.targetType === 'product' ? 'product' : 'brand';
  const reason = body.reason.trim().slice(0, 1000);
  console.warn(`[report] ${user.email ?? user.id} reported ${targetType} "${body.slug}": ${reason}`);
  await notifyPlatform({ action: 'report', targetType, slug: body.slug, reason, reporter: user.email });
  return Response.json({ ok: true });
}
