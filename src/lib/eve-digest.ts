// EVE'S DIGEST — her proactive status report (docs/studio/EVE_CONTROL.md, "Digest / Stats").
//
// Joe: "Eve when first pulled down should greet the user and ask if they want a digest — a status
// report about their account, brand performance." Pure + cheap: eve-home feeds it /api/creator/stats
// and renders the result. A headline she can say, a few metric tiles, and ONE actionable next step —
// never a wall of numbers.
//
// v1 uses only what's already free (revenue/orders all-time + 30-day views). Per-day/week units
// (sales-series) are a later route; this is the honest first cut.

export type DigestStore = {
  name: string;
  slug: string;
  status: string;
  orders: number;
  revenueCents: number;
  views30d: number;
};

export type Digest = {
  headline: string;
  tiles: { label: string; value: string }[];
  suggestion: string;
};

function money(cents: number): string {
  const dollars = cents / 100;
  return dollars >= 1000
    ? `$${Math.round(dollars).toLocaleString()}`
    : `$${dollars.toFixed(dollars % 1 === 0 ? 0 : 2)}`;
}

export function buildDigest(stores: DigestStore[]): Digest {
  const orders = stores.reduce((n, s) => n + (s.orders || 0), 0);
  const revenue = stores.reduce((n, s) => n + (s.revenueCents || 0), 0);
  const views = stores.reduce((n, s) => n + (s.views30d || 0), 0);
  const live = stores.filter((s) => s.status === 'live');

  const headline =
    orders > 0
      ? `${orders} order${orders === 1 ? '' : 's'} · ${money(revenue)} all-time.`
      : views > 0
        ? `${views.toLocaleString()} view${views === 1 ? '' : 's'} in 30 days — no orders yet.`
        : !stores.length
          ? "You're just getting started."
          : 'Your store is set up — time to get eyes on it.';

  const tiles = [
    { label: 'Orders', value: orders.toLocaleString() },
    { label: 'Revenue', value: money(revenue) },
    { label: 'Views · 30d', value: views.toLocaleString() },
  ];

  let suggestion: string;
  if (!stores.length) suggestion = "Let's build your first brand — just start talking.";
  else if (!live.length) suggestion = 'Get a brand live to start selling — I can finalize your site.';
  else if (views === 0) suggestion = 'No views yet — a fresh drop or a post helps people find you.';
  else if (orders === 0) suggestion = `${views.toLocaleString()} views, no sales yet — want to refresh a product or run a promo?`;
  else suggestion = "Momentum's good — a new drop keeps it going. Want to design one?";

  return { headline, tiles, suggestion };
}

/** The same numbers, written for EVE'S EAR rather than the screen.
 *
 *  The digest used to render silently while she was told only "give them the headline" — she had no
 *  figures, so any follow-up ("how's Urban doing?", "how much last month?") was a guess. This hands
 *  her the real per-brand values to speak from, plus an explicit boundary: the digest is all-time
 *  orders/revenue + a 30-day view count and NOTHING else, so anything time-sliced or per-product she
 *  must decline rather than invent. Wrong revenue spoken confidently is the worst failure here.
 *
 *  Kept compact on purpose — this is injected into a LIVE audio session, not a report. */
export function digestBriefing(stores: DigestStore[]): string {
  if (!stores.length) {
    return '(Their digest is on screen and they have no brands yet. Say so warmly in one sentence and offer to start one. Invent nothing.)';
  }
  const orders = stores.reduce((n, s) => n + (s.orders || 0), 0);
  const revenue = stores.reduce((n, s) => n + (s.revenueCents || 0), 0);
  const views = stores.reduce((n, s) => n + (s.views30d || 0), 0);
  const per = stores
    .map((s) => `"${s.name}" (${s.status}): ${s.orders || 0} orders, ${money(s.revenueCents || 0)}, ${(s.views30d || 0).toLocaleString()} views/30d`)
    .join('; ');
  return [
    '(Their digest is now on screen. These are the REAL figures — speak from them and invent nothing:',
    `TOTALS: ${stores.length} brand${stores.length === 1 ? '' : 's'}, ${orders} order${orders === 1 ? '' : 's'}, ${money(revenue)} revenue all-time, ${views.toLocaleString()} views in the last 30 days.`,
    `BY BRAND: ${per}.`,
    'Give them the headline in one short sentence, then your read on it — what it means and what you would do next.',
    'LIMITS: orders and revenue are ALL-TIME, views are the last 30 days. You do not have per-day/per-week trends, per-product sales, or any earlier period. If they ask for something outside that, say plainly that you do not have it yet — never estimate.)',
  ].join(' ');
}
