import { NextResponse } from 'next/server';

import { API_BASE, STORE_SLUG } from '@/lib/store';

// Checkout forwards to the central Nano Crew POS — prices, Stripe, and Printful fulfilment all
// happen there. This site never sees a payment key. We pass variant ids straight through (the
// store pages already resolve them from the public catalogue); the POS re-prices from the DB.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      items?: { variantId?: string; quantity?: number }[];
    } | null;

    const items = (body?.items ?? [])
      .map((i) => ({ variantId: String(i.variantId ?? ''), quantity: Math.min(10, Math.max(1, Number(i.quantity) || 1)) }))
      .filter((i) => i.variantId);

    if (!items.length) {
      return NextResponse.json({ error: 'Your bag is empty.' }, { status: 400 });
    }

    const res = await fetch(`${API_BASE}/api/public/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeSlug: STORE_SLUG, items }),
    });
    const d = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (!res.ok || !d?.url) {
      return NextResponse.json({ error: d?.error ?? 'Checkout failed.' }, { status: 502 });
    }
    return NextResponse.json({ url: d.url });
  } catch (err) {
    console.error('[checkout] error', err);
    return NextResponse.json({ error: 'Checkout failed.' }, { status: 500 });
  }
}
