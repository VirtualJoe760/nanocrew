# nanocrew-site — local rules

Thin per-unit file. **Read the root [`../CLAUDE.md`](../CLAUDE.md) + [`../docs/context/`](../docs/context/README.md) first** — this only adds what's specific to this unit.

**What this is:** the public web surface at **nanocrew.app** — marketing, the HQ store, and the
signed-in **account page**. Next.js 15 on Vercel.

## Local rules

- 🔴 **This unit holds NO database credential.** Everything comes from the API over HTTP. Anonymous
  reads use `lib/store.ts`; authed calls use **`lib/api.ts` → `apiFetch()`**, the web sibling of the
  app's `src/lib/api.ts` (Supabase session → bearer). If you find yourself importing `postgres` here,
  stop — add the endpoint to platform-api instead.
  *(`app/api/waitlist` was the one exception — it opened Postgres directly. As of 2026-08-19 it is a
  thin server-side **proxy** to platform-api `POST /api/public/beta-signup`. That is why the rule
  exists: `DATABASE_URL` was never set here, so the table was never created and every beta signup
  fell through to a `console.log` — no row, no email, no invite.)*
- 🔴 **Account parity.** The account page mirrors the app's. Change one → change the app and the API
  in the same commit, and update the matrix in
  [`../docs/accounts/ACCOUNT_SURFACE.md`](../docs/accounts/ACCOUNT_SURFACE.md).
- **Two API bases, deliberately** (see the same doc): `platform.nanocrew.app` for anything needing
  `PATCH`/`DELETE` (account, stores, collaborators); `api.nanocrew.app` — the app's Cloud Run
  backend — **for Stripe Connect payouts only**, because its CORS allows just `GET, POST, OPTIONS`.
  A new capability needing another verb goes on platform-api.
- 🔴 **The palette is the APP's, not this site's own.** Tokens in `app/globals.css` come from
  `src/constants/theme.ts` (`#08080a` ground, `#cdd1d9` platinum accent) and `eve-glyph.tsx`
  (`#7fd7e6`, used **only** where Eve herself appears). **No gold, no warm neutrals.** The legacy
  names (`--paper`, `--ink`, `--gold`, `--line`) are aliases of the new ones so older pages inherit
  the palette — prefer `--bg` / `--text` / `--accent` / `--edge` in new code.
- **Type is Jost**, the app's face, self-hosted via `next/font/local` from `app/fonts/`. Don't link
  a font CDN.
- **Eve's mark** (`app/eve-mark.tsx`) and the background field (`app/eve-sky.tsx`) mirror the
  geometry in `src/components/eve/eve-glyph.tsx` and `scripts/gen-app-icon.mjs`. Change the glyph
  there → change it here. The **social share card** (`app/opengraph-image.tsx`, re-exported by
  `app/twitter-image.tsx`, so it is every share preview) draws the same geometry — it was still the
  retired gold serif "NC" lockup until 2026-08-19. `public/brand/` holds the two rasters emailed
  clients need; both are generated, so don't hand-edit them. See
  [`../assets/brand/README.md`](../assets/brand/README.md).
- **Email landing pages live here**, not on platform-api: a CTA points at one route on this site and
  that route branches (phone → `nanocrew://` deep link, desktop → complete it on the web). Never put
  a bare deep link in an email — it's a dead click on every laptop. See
  [`../docs/accounts/EMAIL_PIPELINE.md`](../docs/accounts/EMAIL_PIPELINE.md).
- Stack: Next 15 · React 19 · `@supabase/supabase-js` (auth only). `npm run dev` (port 3000).

## Known gaps
- `eslint-config-next` isn't declared, so Vercel skips linting this unit entirely.
- `app/api/checkout`, `order-lookup`, `returns` are thin proxies to endpoints platform-api already
  exposes — collapsible now that CORS is open.
