import { timingSafeEqual } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import {
  sendReturnApproved,
  sendReturnDeclined,
  type EmailStore,
} from '@/lib/notify';

// POST /api/internal/notify — central dispatch so APP-SIDE creator actions (the approve/decline
// routes on the Railway backend) can fire a branded shopper email WITHOUT pulling Resend into the
// app. Resend lives ONLY in platform-api. Auth: a shared INTERNAL_API_KEY, constant-time compared
// (mirrors the first-drop internal-service path). Best-effort: a send that can't go out must not
// fail the creator action, so a configured-and-authed call always 202s.
//
// The app stays dumb — it posts only { action, returnId, reason? }; this route (which has DB access)
// resolves the return → store → buyer and renders the right branded email. See
// docs/accounts/EMAIL_PIPELINE.md (the §"App-triggered sends" contract) + RETURNS_REFUNDS.md.

type NotifyBody = { action: 'approved' | 'declined'; returnId: string; reason?: string };

function authorized(req: Request): boolean {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) return false; // unconfigured → reject (never an open door)
  const header = req.headers.get('x-internal-key') ?? '';
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ ok: false }, { status: 401 });

  const body = (await req.json().catch(() => null)) as NotifyBody | null;
  if (!body?.returnId || (body.action !== 'approved' && body.action !== 'declined')) {
    return Response.json({ ok: false, error: 'action ("approved"|"declined") and returnId are required' }, { status: 400 });
  }

  // Resolve the claim → its store → the buyer. If the row is gone, there's nothing to notify.
  const [claim] = await db
    .select({
      id: schema.returnRequests.id,
      reason: schema.returnRequests.reason,
      note: schema.returnRequests.note,
      resolution: schema.returnRequests.resolution,
      customerEmail: schema.returnRequests.customerEmail,
      storeId: schema.returnRequests.storeId,
    })
    .from(schema.returnRequests)
    .where(eq(schema.returnRequests.id, body.returnId))
    .limit(1);
  if (!claim) return Response.json({ ok: false, error: 'return not found' }, { status: 404 });

  const [storeRow] = await db
    .select({ slug: schema.stores.slug, name: schema.stores.name, logoUrl: schema.stores.logoUrl, siteConfig: schema.stores.siteConfig })
    .from(schema.stores)
    .where(eq(schema.stores.id, claim.storeId))
    .limit(1);
  if (!storeRow) return Response.json({ ok: false, error: 'store not found' }, { status: 404 });

  const store: EmailStore = {
    slug: storeRow.slug,
    name: storeRow.name,
    logoUrl: storeRow.logoUrl,
    colors: (storeRow.siteConfig as { colors?: Record<string, string | undefined> } | null)?.colors ?? null,
  };
  const returnRequest = {
    id: claim.id,
    reason: claim.reason as string,
    note: claim.note as string | null,
    resolution: claim.resolution as string | null,
  };

  // Dispatch is best-effort; each send swallows its own errors. We never surface a send failure as a
  // non-2xx — the caller's creator action already succeeded.
  if (body.action === 'approved') {
    await sendReturnApproved({ to: claim.customerEmail, store, returnRequest });
  } else {
    await sendReturnDeclined({ to: claim.customerEmail, store, returnRequest, reason: body.reason });
  }

  return Response.json({ ok: true }, { status: 202 });
}
