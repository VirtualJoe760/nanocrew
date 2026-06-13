# nanocrew-site

The public **Nanocrew company website** — the business website for Stripe verification + the App Store,
and the future home of the desktop editor + web payments. A small Next.js (App Router) app, deployed to
Vercel as its own unit.

## Pages
- `/` — landing: hero, how-it-works, **waitlist** email capture (coming soon to iOS).
- `/terms`, `/privacy`, `/contact` — the policy pages Stripe (live activation) and the App Store require.
  These are **starter drafts — review with counsel before launch.**

## Run
```bash
cd nanocrew-site
npm install
npm run dev        # → http://localhost:3000
```

## Deploy (Vercel)
New Vercel project rooted at `nanocrew-site/`. Set env:
- `SITE_URL` — the deployed URL (e.g. `https://nanocrew.app`) for OG/metadata.
- `DATABASE_URL` — *optional*. With it, waitlist signups persist to a standalone `waitlist` table in
  the shared Postgres; without it, signups are accepted + logged (so the page works before it's wired).

Then put the deployed URL into Stripe's **business website** field and the App Store listing.

## To do before go-live
- Replace policy stubs with reviewed legal copy; set real `support@ / privacy@ / hello@` inboxes.
- Swap the "Coming soon to iOS" CTA for the real **App Store** link once the app is published.
- Attach the custom domain (`nanocrew.app`) — ties into the Phase C Vercel-domains work.
