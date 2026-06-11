@AGENTS.md

# Nanocrew

**AI-native Shopify for creators** — a mobile app (Expo / React Native, iOS + Android) where a creator describes their brand, Claude builds them a real clothing store (logo/OG/favicon via Nano Banana, theme, copy), it goes live on its own domain and in an in-app marketplace, and a design studio lets them generate clothing that auto-fulfills through Printful. Powered by the operator's Anthropic API key. "Nanocrew" is a working name.

The `stephen-lawyer` repo (sibling dir) is the reference store / template-zero and the proven version of the create→design→Printful loop. Its backend (Gemini, Cloudinary, Printful in Next.js route handlers) is the API shape this app consumes.

## Stack
- Expo SDK 56, Expo Router (file-based routing, `src/app/`), React Native 0.85, React 19, TypeScript.
- Canvas stack already present: `react-native-gesture-handler`, `react-native-reanimated`, `react-native-worklets`. (Skia to be added for the design canvas.)
- npm (not pnpm — avoids RN native-module hoisting issues).

## App structure (tabs)
- `src/app/index.tsx` — **Market** (marketplace / discovery)
- `src/app/studio.tsx` — **Studio** (AI brand interview + store management)
- `src/app/design.tsx` — **Design** (design generator canvas)
- `src/app/account.tsx` — **Account** (sales, settings, profile)
- Native tabs: `src/components/app-tabs.tsx` (NativeTabs + SF Symbols). Web tabs: `src/components/app-tabs.web.tsx`.
- Screens currently use `src/components/section-screen.tsx` placeholders describing each section's planned scope.

## TODO / known
- Android tab icons: NativeTabs uses iOS SF Symbols; add Android `drawable`s.
- Two `tsc` CSS-import errors are template artifacts resolved by Metro + Expo's generated `expo-env.d.ts` on first `expo start`.

## Run
`npm run ios` · `npm run android` · `npm run web`

## Open architecture forks (decide before building `commerce-core`)
- Per-creator codegen via shared `@app/commerce-core` package + template repo; instant config-preview, materialize real code on publish.
- Platform-as-merchant Printful model + Stripe Connect payouts.
- Vercel project + custom-domain automation.
