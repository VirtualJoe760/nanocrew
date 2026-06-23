import { timingSafeEqual } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import {
  sendBrandLive,
  sendContentReport,
  sendPayoutNotification,
  sendReturnApproved,
  sendReturnDeclined,
  type EmailStore,
} from '@/lib/notify';

// POST /api/internal/notify — central dispatch so APP-SIDE actions on the Railway backend can fire a
// branded email WITHOUT pulling Resend into the app. Resend lives ONLY in platform-api. Auth: a
// shared INTERNAL_API_KEY, constant-time compared (mirrors the first-drop internal-service path).
// Best-effort: a send that can't go out must not fail the caller's action, so a configured-and-authed
// call always 202s.
//
// The app stays dumb — it posts only a minimal { action, id } and this route (which has DB access)
// resolves the full context and renders the right email. See docs/accounts/EMAIL_PIPELINE.md
// (§"App-triggered sends") + RETURNS_REFUNDS.md.
//
// Actions:
//  - returns:   { action: 'approved'|'declined', returnId, reason? }  → buyer email (per-brand)
//  - brand-live:{ action: 'brand_live', slug }                        → creator email (from Nano Crew)
//  - payout:    { action: 'payout', orderId }                         → creator email (from Nano Crew)
//  - report:    { action: 'report', targetType, slug, reason, reporter? } → ops email (Market UGC)
type NotifyBody =
  | { action: 'approved' | 'declined'; returnId: string; reason?: string }
  | { action: 'brand_live'; slug: string }
  | { action: 'payout'; orderId: string }
  | { action: 'report'; targetType: string; slug: string; reason: string; reporter?: string };

function authorized(req: Request): boolean {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) return false; // unconfigured → reject (never an open door)
  const header = req.headers.get('x-internal-key') ?? '';
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function creatorEmail(creatorId: string): Promise<string | null> {
  const [c] = await db
    .select({ email: schema.creators.email })
    .from(schema.creators)
    .where(eq(schema.creators.id, creatorId))
    .limit(1);
  return c?.email ?? null;
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ ok: false }, { status: 401 });

  const body = (await req.json().catch(() => null)) as NotifyBody | null;
  if (!body || typeof body.action !== 'string') {
    return Response.json({ ok: false, error: 'action is required' }, { status: 400 });
  }

  // ── Market content report (Apple 1.2 / INFORM) → ops email. ─────────────────────────────────────
  if (body.action === 'report') {
    if (!body.slug || !body.reason) return Response.json({ ok: false, error: 'slug + reason required' }, { status: 400 });
    await sendContentReport({
      targetType: body.targetType || 'brand',
      slug: body.slug,
      reason: String(body.reason).slice(0, 1000),
      reporter: body.reporter,
    });
    return Response.json({ ok: true }, { status: 202 });
  }

  // ── Brand went live → tell the creator (FROM Nano Crew). ────────────────────────────────────────
  if (body.action === 'brand_live') {
    if (!body.slug) return Response.json({ ok: false, error: 'slug required' }, { status: 400 });
    const [store] = await db
      .select({ name: schema.stores.name, slug: schema.stores.slug, creatorId: schema.stores.creatorId, customDomain: schema.stores.customDomain })
      .from(schema.stores)
      .where(eq(schema.stores.slug, body.slug))
      .limit(1);
    if (!store) return Response.json({ ok: false, error: 'store not found' }, { status: 404 });
    const email = await creatorEmail(store.creatorId);
    if (email) {
      const url = store.customDomain ? `https://${store.customDomain}` : `https://nanocrew.app/b/${store.slug}`;
      await sendBrandLive({ to: email, brandName: store.name, url });
    }
    return Response.json({ ok: true }, { status: 202 });
  }

  // ── Held payout released → tell the creator (FROM Nano Crew). ────────────────────────────────────
  if (body.action === 'payout') {
    if (!body.orderId) return Response.json({ ok: false, error: 'orderId required' }, { status: 400 });
    const [order] = await db
      .select({ id: schema.orders.id, storeId: schema.orders.storeId, brandNetCents: schema.orders.brandNetCents, currency: schema.orders.currency })
      .from(schema.orders)
      .where(eq(schema.orders.id, body.orderId))
      .limit(1);
    if (!order) return Response.json({ ok: false, error: 'order not found' }, { status: 404 });
    const [store] = await db
      .select({ name: schema.stores.name, creatorId: schema.stores.creatorId })
      .from(schema.stores)
      .where(eq(schema.stores.id, order.storeId))
      .limit(1);
    if (store) {
      const email = await creatorEmail(store.creatorId);
      if (email) {
        await sendPayoutNotification({
          to: email,
          brandName: store.name,
          amountCents: order.brandNetCents,
          currency: order.currency,
          order: { id: order.id },
        });
      }
    }
    return Response.json({ ok: true }, { status: 202 });
  }

  // ── Returns: approved / declined → buyer email (per-brand). ──────────────────────────────────────
  if (body.action !== 'approved' && body.action !== 'declined') {
    return Response.json({ ok: false, error: 'unknown action' }, { status: 400 });
  }
  if (!body.returnId) {
    return Response.json({ ok: false, error: 'returnId required' }, { status: 400 });
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
