# Nanocrew

AI-native creator commerce. A creator talks to **Venus** (voice or typed AI) to define a clothing
brand; Nanocrew auto-generates a Printful-backed shop **and** a per-brand storefront website, then
lets them design products, post, sell video ads, and edit their site by chatting — all from the app.

## Documentation
Full docs live in **[`docs/`](docs/README.md)**:
- [Architecture](docs/ARCHITECTURE.md) · [Pages & sections](docs/PAGES.md) · [API reference](docs/API.md)
- [Remaining features](docs/REMAINING_FEATURES.md) · [Production checklist](docs/PRODUCTION_CHECKLIST.md)
- [Database plan](docs/DATABASE_PLAN.md) · [Storefront engine](docs/STOREFRONT_ENGINE.md)

## Stack
Expo SDK / React Native + expo-router · Supabase Postgres + Drizzle ORM · Gemini "Nano Banana"
(design) + ElevenLabs (voice) · Printful (fulfilment) · Stripe (billing) · Cloudinary (media) ·
a Next.js public API (`platform-api/`, deployed to Vercel) · `nanocrew-templates` storefront
monorepo provisioned by a headless-Claude "forge" VPS.

## Develop

```bash
npm install
npm start            # Expo dev server (Metro hosts the +api routes)
npm run db:generate  # drizzle-kit generate after a schema change
npm run db:migrate   # apply migrations
```

Copy `src/db/schema.ts` → `platform-api/db/schema.ts` after every migration. Required environment
variables are listed in [docs/PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md).
