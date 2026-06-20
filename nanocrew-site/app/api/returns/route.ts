import { NextResponse } from 'next/server';

import { API_BASE } from '@/lib/store';

// Open a return claim — forwards to the central Nano Crew platform, which validates the return window,
// reason, and (for defective/damaged) the photo, inserts the claim, flips the order, and acks the
// buyer by email. This site holds no commerce state; like checkout, it proxies. The platform's error
// (window closed, missing photo, …) is surfaced verbatim. See docs/accounts/RETURNS_REFUNDS.md.
const REASONS = ['defective', 'wrong_item', 'damaged', 'not_received'];

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      orderId?: string;
      reason?: string;
      note?: string;
      photoUrls?: unknown;
      items?: unknown;
    } | null;

    const orderId = body?.orderId?.trim();
    const reason = body?.reason?.trim();
    if (!orderId) return NextResponse.json({ error: 'Order is required.' }, { status: 400 });
    if (!reason || !REASONS.includes(reason)) {
      return NextResponse.json({ error: 'Pick a valid reason.' }, { status: 400 });
    }
    const photoUrls = Array.isArray(body?.photoUrls)
      ? (body!.photoUrls as unknown[]).filter((u): u is string => typeof u === 'string' && !!u.trim())
      : undefined;
    const note = typeof body?.note === 'string' ? body!.note : undefined;

    const res = await fetch(`${API_BASE}/api/public/returns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, reason, photoUrls, note }),
      cache: 'no-store',
    });
    const d = (await res.json().catch(() => null)) as { returnRequest?: { id: string }; error?: string } | null;
    if (!res.ok || !d?.returnRequest) {
      return NextResponse.json({ error: d?.error ?? 'Could not open your return.' }, { status: res.status || 502 });
    }
    return NextResponse.json({ id: d.returnRequest.id });
  } catch (err) {
    console.error('[returns] error', err);
    return NextResponse.json({ error: 'Could not open your return.' }, { status: 500 });
  }
}
