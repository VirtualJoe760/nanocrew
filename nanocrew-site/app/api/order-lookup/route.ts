import { NextResponse } from 'next/server';

import { API_BASE } from '@/lib/store';

// Order lookup for the guest return flow forwards to the central Nano Crew platform — it validates
// the email + order id match and returns a minimal order view. This site holds no DB; like checkout,
// it proxies. See docs/accounts/RETURNS_REFUNDS.md.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { email?: string; orderNumber?: string } | null;
    const email = body?.email?.trim();
    const orderNumber = body?.orderNumber?.trim();
    if (!email || !orderNumber) {
      return NextResponse.json({ error: 'Email and order number are required.' }, { status: 400 });
    }

    const res = await fetch(`${API_BASE}/api/public/order-lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, orderNumber }),
      cache: 'no-store',
    });
    const d = (await res.json().catch(() => null)) as { order?: unknown; error?: string } | null;
    if (!res.ok) {
      // 404 = no match; pass the platform's status + message through verbatim.
      return NextResponse.json({ error: d?.error ?? 'Order not found.' }, { status: res.status });
    }
    return NextResponse.json({ order: d?.order });
  } catch (err) {
    console.error('[order-lookup] error', err);
    return NextResponse.json({ error: 'Lookup failed.' }, { status: 500 });
  }
}
