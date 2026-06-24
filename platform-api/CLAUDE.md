# platform-api — local rules

Thin per-unit file. **Read the root [`../CLAUDE.md`](../CLAUDE.md) + [`../docs/context/`](../docs/context/README.md) first** — this only adds what's specific to this unit.

**What this is:** the public storefront API + webhooks. Next.js 16 on Vercel (`nanocrew-api.vercel.app`).
Stripe lives here (the central POS), not in the app or the templates.

## Local rules
- 🔴 **`db/schema.ts` is a hand-kept COPY of `../src/db/schema.ts`.** Re-sync it on **every**
  migration — the table/column **shape** must match (the files aren't byte-identical; imports/context
  differ). (See [`../docs/context/NEVER_VIOLATE.md`](../docs/context/NEVER_VIOLATE.md) §1.)
- 🔴 **New tables = RLS on.** Any migration that adds a table must `ENABLE ROW LEVEL SECURITY`.
- **Stripe is server-only and central.** Templates never hold Stripe keys; they proxy checkout here.
  Webhooks must be **idempotent** (guard order updates, e.g. `status != 'paid'`) — they retry.
- **Public storefront responses** are the data contract — change a shape here →
  [`../docs/storefront/STOREFRONT_DATA_CONTRACT.md`](../docs/storefront/STOREFRONT_DATA_CONTRACT.md) + [`API.md`](../docs/architecture/API.md).
- Stack: Next 16 · React 19 · `drizzle-orm` · `postgres` · `stripe`. `npm run dev` (port 3200).
