import { eq } from 'drizzle-orm';

import { corsJson, corsPreflight } from '@/lib/cors';
import { db, schema } from '@/lib/db';
import { sendReturnRequested } from '@/lib/notify';

export const OPTIONS = corsPreflight;

// The return reasons the platform accepts (POD = made-to-order, so no buyer's-remorse ship-backs).
// Mirrors the `return_reason` enum in db/schema.ts. See docs/accounts/RETURNS_REFUNDS.md.
const REASONS = ['defective', 'wrong_item', 'damaged', 'not_received'] as const;
type Reason = (typeof REASONS)[number];
// Photo evidence is required for these — a claim without it can't be triaged.
const PHOTO_REQUIRED: Reason[] = ['defective', 'damaged'];

// Statuses where opening a return makes no sense (already resolved or never fulfilled).
const NOT_CLAIMABLE = ['refunded', 'cancelled', 'failed', 'return_requested'];

// POST /api/public/returns { orderId, reason, photoUrls?, note?, items? }
// Opens a customer return claim (guest from a brand site OR the app). Validates the order exists +
// the return window is open + the reason is in-enum + photos present for defective/damaged, inserts
// a return_requests row (status 'requested'), flips the order → 'return_requested', then best-effort
// acks the buyer by email. Mirrors checkout/route.ts conventions. See docs/accounts/RETURNS_REFUNDS.md.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      orderId?: string;
      customerEmail?: string;
      reason?: string;
      photoUrls?: unknown;
      note?: string;
      items?: unknown;
    } | null;

    const orderId = body?.orderId?.trim();
    const reason = body?.reason?.trim() as Reason | undefined;
    // Ownership proof: the caller must present the order's email (the in-app proxy attaches the
    // verified account email; the guest flow carries the email it just looked the order up with).
    // Without it anyone holding a leaked order UUID could open a claim and freeze the brand's payout.
    const claimEmail = typeof body?.customerEmail === 'string' ? body.customerEmail.trim().toLowerCase() : '';
    if (!orderId) return corsJson({ error: 'orderId required' }, { status: 400 });
    if (!claimEmail) return corsJson({ error: 'email required' }, { status: 400 });
    if (!reason || !REASONS.includes(reason)) {
      return corsJson({ error: `reason must be one of: ${REASONS.join(', ')}` }, { status: 400 });
    }

    // Normalize evidence: only keep string URLs.
    const photoUrls = Array.isArray(body?.photoUrls)
      ? (body!.photoUrls as unknown[]).filter((u): u is string => typeof u === 'string' && !!u.trim()).slice(0, 12)
      : [];
    if (PHOTO_REQUIRED.includes(reason) && photoUrls.length === 0) {
      return corsJson({ error: 'a photo of the issue is required for defective or damaged items' }, { status: 400 });
    }
    // Optional line-item scope (null = the whole order). Passed through as-is; the creator inbox reads it.
    const items = Array.isArray(body?.items) && body!.items.length ? body!.items : null;
    const note = typeof body?.note === 'string' ? body!.note.slice(0, 2000) : null;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
      return corsJson({ error: 'order not found' }, { status: 404 });
    }

    const [order] = await db
      .select({
        id: schema.orders.id,
        storeId: schema.orders.storeId,
        status: schema.orders.status,
        customerEmail: schema.orders.customerEmail,
        returnWindowEndsAt: schema.orders.returnWindowEndsAt,
      })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);
    // Opaque 404 on a missing order OR an email mismatch — never confirm an order exists to a caller
    // who can't prove they own it (no enumeration, no IDOR).
    if (!order || order.customerEmail.trim().toLowerCase() !== claimEmail) {
      return corsJson({ error: 'order not found' }, { status: 404 });
    }

    // The window opens on ship and closes at returnWindowEndsAt (ship + RETURN_WINDOW_DAYS). No ship
    // date yet → nothing to return; past the deadline → closed.
    if (!order.returnWindowEndsAt) {
      return corsJson({ error: 'this order has not shipped yet' }, { status: 409 });
    }
    if (Date.now() >= order.returnWindowEndsAt.getTime()) {
      return corsJson({ error: 'the return window for this order has closed' }, { status: 409 });
    }
    if (NOT_CLAIMABLE.includes(order.status)) {
      return corsJson({ error: `a return can't be opened on a ${order.status} order` }, { status: 409 });
    }

    const [claim] = await db
      .insert(schema.returnRequests)
      .values({
        orderId: order.id,
        storeId: order.storeId, // denormalized for the creator inbox + RLS
        customerEmail: order.customerEmail,
        reason,
        itemsJson: items,
        photoUrls: photoUrls.length ? photoUrls : null,
        note,
        status: 'requested',
      })
      .returning();

    await db.update(schema.orders).set({ status: 'return_requested' }).where(eq(schema.orders.id, order.id));

    // Best-effort buyer acknowledgement — an email outage must never fail the claim.
    const [store] = await db
      .select({ slug: schema.stores.slug, name: schema.stores.name })
      .from(schema.stores)
      .where(eq(schema.stores.id, order.storeId))
      .limit(1);
    if (store) {
      await sendReturnRequested({ to: order.customerEmail, store, returnRequest: claim }).catch((e) =>
        console.error('[returns] notify:', e instanceof Error ? e.message : e),
      );
    }

    return corsJson({ returnRequest: claim }, { status: 201 });
  } catch (e) {
    console.error('[returns]', e instanceof Error ? e.message : e);
    return corsJson({ error: 'could not open return' }, { status: 500 });
  }
}
