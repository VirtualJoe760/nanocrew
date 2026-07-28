# Tech Stack

The complete, current technology inventory for Nano Crew — derived from the actual manifests and
config (`package.json` ×4, `app.json`, `eas.json`, `babel.config.js`, `metro.config.js`,
`tsconfig.json`, `drizzle.config.ts`) and the `src/lib/**` integration surface, not from memory.
**Keep this in sync when you add or bump a dependency, swap a model, or change a deploy target.**

See also: [ARCHITECTURE.md](ARCHITECTURE.md) (how the units fit together), [DATABASE_PLAN.md](DATABASE_PLAN.md)
(schema), [API.md](API.md) (endpoints).

---

## At a glance — the four deployable units (+ two sibling repos)

| Unit | Where it lives | Framework | Runtime / host | Talks to |
|---|---|---|---|---|
| **Mobile app** (this repo) | `/` (Expo) | Expo SDK 54 · React Native 0.81 · React 19 | iOS/Android (Hermes) + web; **server routes (`**+api.ts`) on Google Cloud Run** (persistent Node via `expo serve`) | Postgres, Gemini, fal, Stripe, Printful, Cloudinary, Apple |
| **platform-api** | `platform-api/` | **Next.js 16** | Vercel (`nanocrew-api.vercel.app`) | Postgres, **Stripe**, Printful webhooks |
| **nanocrew-site** | `nanocrew-site/` | **Next.js 15** | Vercel | Postgres (read), shared POS |
| **forge-worker** | `forge-worker/` | Node ESM + **systemd** | **DigitalOcean droplet** (`ssh nanocrew-forge`) | Postgres queue, **headless `claude` CLI** |
| **nanocrew-templates** | sibling repo | Next.js storefronts ×5 | Vercel (per brand) | platform-api (thin client) |
| **forge** (the robot) | DO droplet | headless **Anthropic Claude** CLI | same droplet | GitHub, Vercel previews |

**One shared Supabase Postgres** underpins all of them. `platform-api/db/schema.ts` is a hand-kept
**copy** of `src/db/schema.ts` — re-sync on every migration.

---

## Language & runtime baseline

| | Version | Notes |
|---|---|---|
| **Node** | **22** (`.nvmrc`) | App backend (Cloud Run) + platform-api (Vercel) + forge-worker. Node 22 provides global `WebSocket` (needed by the Gemini Live web build). |
| **TypeScript** | **~6.0.3** (app) · ^5 (platform-api/site) | `strict: true`; path aliases `@/*` → `src/*`, `@/assets/*`. Extends `expo/tsconfig.base`. |
| **React** | **19.1.0** (app) · 19.2.4 (platform-api) · 19.0.0 (site) | |
| **Package manager** | **npm** (not pnpm) | |

---

## Mobile app (Expo SDK 54 / React Native 0.81)

### Framework, navigation, build
| Package | Version | Role |
|---|---|---|
| `expo` | ~54.0.0 | SDK / native runtime |
| `expo-router` | ~6.0.24 | File-based routing + **server API routes** (`*+api.ts`); typed routes on |
| `react-native` | 0.81.5 | Hermes engine |
| `react-native-web` | ~0.21.0 | Web target (`web.output: "server"`) |
| `react-compiler` | (experiment) | `experiments.reactCompiler: true` in app.json |
| `babel-preset-expo` | — | + `@babel/plugin-transform-class-static-block` (three.js ships static-init blocks the native transform doesn't parse by default) |
| Metro | (expo default) | **Override:** forces `@google/genai` → its `dist/web` build (the node build `require('ws')`, which RN lacks). See `metro.config.js`. |
| `expo-updates` | ~29.0.18 | OTA updates (`runtimeVersion.policy: appVersion`, channels dev/preview/production) |

### UI, animation, rendering
| Package | Version | Role |
|---|---|---|
| `@shopify/react-native-skia` | 2.2.12 | GPU canvas — Venus avatar, dot-field backgrounds, native garment-mockup blend modes (web split: `*.web.tsx` uses CSS). Web needs CanvasKit WASM. |
| `react-native-reanimated` | ~4.1.1 | Animations (gestures, canvas) |
| `react-native-worklets` | 0.5.1 | Worklet runtime (auto-added by babel-preset-expo) |
| `react-native-gesture-handler` | ~2.28.0 | Pan/pinch on the Design canvas |
| `react-native-screens` | ~4.16.0 | Native screen primitives |
| `react-native-safe-area-context` | ~5.6.0 | Insets |
| `react-native-svg` | 15.12.1 | Vector UI (NC mark, fabric background) |
| `expo-image` | ~3.0.11 | Images (`contentFit`) |
| `expo-video` | ~3.0.16 | Feed / ad playback |
| `expo-audio` | ~1.1.1 | Venus TTS playback, tour narration |
| `react-native-audio-api` | ^0.12.2 | Low-level audio (Venus speech-level analysis / lip-sync) — registered as an Expo plugin |
| `expo-haptics`, `expo-symbols`, `expo-status-bar`, `expo-system-ui`, `expo-splash-screen` | — | Chrome/feedback |

### 3D avatar (Venus)
| Package | Version | Role |
|---|---|---|
| `three` | ^0.184.0 | 3D scene |
| `@react-three/fiber` | ^9.6.1 | React renderer for three |
| `@react-three/drei` | ^10.7.7 | R3F helpers |
| `expo-gl` | ~16.0.10 | WebGL context on native |
| `react-native-nitro-modules` | ^0.35.9 | Native module bridge (Skia/audio deps) |
| `@types/three` | ^0.184.1 | — |

> Avatar work is web/native-split; three only loads in the Venus Lab. See [studio/VENUS_AVATAR.md](../studio/VENUS_AVATAR.md).

### Native capabilities (require a dev/standalone build — Expo Go retired)
| Package | Version | Role | Env gate |
|---|---|---|---|
| `expo-notifications` | ~0.32.17 | Push | `PUSH_ENABLED=true` |
| `expo-apple-authentication` | ~8.0.8 | Native Sign in with Apple (`signInWithIdToken`) | — |
| `react-native-iap` | ^15.3.2 | **Apple IAP / StoreKit 2** | dormant until `APPLE_IAP_*` |
| `react-native-view-shot` | 4.0.3 | Annotated-screenshot capture (live-site editor) | bundled native module |
| `react-native-webview` | 13.15.0 | In-app web views |
| `expo-image-picker` | ~17.0.11 | Try-on / brand imagery |
| `expo-file-system` | ~19.0.23 | Audio/image temp files (legacy API import) |
| `expo-crypto`, `expo-device`, `expo-constants`, `expo-linking`, `expo-web-browser`, `expo-auth-session`, `expo-font`, `expo-asset` | — | Auth/OAuth, device info, deep links, bundled fonts |

### Client data & auth
| Package | Version | Role |
|---|---|---|
| `@supabase/supabase-js` | ^2.108.1 | Auth (token issued client-side, attached via `apiFetch()`) |
| `@react-native-async-storage/async-storage` | 2.2.0 | Session persistence + on-device brand blocklist |
| `react-native-url-polyfill` | ^3.0.0 | URL polyfill for RN |

---

## Data layer (shared)

| Package | Version | Role |
|---|---|---|
| **Supabase Postgres** | — | Single multi-tenant database (the `creators` identity = Supabase uid). **RLS deny-all** on every public table; servers use the service key. |
| `drizzle-orm` | ^0.45.2 | Typed query builder + schema (`src/db/schema.ts`) |
| `drizzle-kit` | ^0.31.10 | Migrations (`db:generate` / `db:migrate`) + `db:studio`. **25 migrations** to date. |
| `postgres` (postgres-js) | ^3.4.9 | Driver. **Constraint:** authed routes must not `fetch()` before the first DB query (persistent Node/postgres-js). Migrations use the **session pooler** (`DATABASE_URL_SESSION`), runtime the transaction pooler. |

**Auth model:** Supabase Auth issues JWTs; the app verifies locally and platform-api verifies remotely
(`SUPABASE_JWKS`). Store ownership + `store_collaborators` enforced in code via `src/lib/tenant.ts`.
See [accounts/AUTH_IDENTITY.md](../accounts/AUTH_IDENTITY.md).

---

## AI & ML services

The core of the product. Two AI roles: **Venus** (conversation + asset generation) and the **forge
robot** (site building).

### Google Gemini — via `@google/genai` ^2.8.0
| Model | Used for | Where |
|---|---|---|
| `gemini-2.5-flash-image` (**"Nano Banana"**) | Design generation + image edits (can't emit alpha → magenta chroma-key, `transparency.ts`) | `model-shots.ts`, `first-drop.ts`, `provision.ts`, generate routes |
| `gemini-2.5-flash` | Interview, ✦ Enhance copy, plans, content safety | `interview.ts`, `content-safety.ts`, `adapt.ts` |
| `gemini-2.5-pro` | **Authoring the forge build brief** (`authorBrandBrief`) | `provision.ts` |
| `gemini-2.5-flash-preview-tts` | Venus TTS (`/api/say`) | `src/app/api/say+api.ts` (`TTS_MODEL`) |
| `gemini-2.5-flash-native-audio-preview-12-2025` | **Gemini Live** real-time voice (push-to-talk Venus) | `src/app/api/voice-live-token+api.ts` (`LIVE_MODEL`) + `live-voice.ts` |
| `gemini-2.0-flash` | Misc lightweight text | — |

> The Gemini **Live** session forces the `@google/genai` **web build** (global `WebSocket`) on both
> client and server via the Metro override — the node build's `require('ws')` hangs in RN.

### fal.ai — video (`fal-video.ts`, `scene-video.ts`)
Creator-pickable tiers in a `VIDEO_MODELS` registry (variable credit cost):

| Model | Endpoint |
|---|---|
| **wan** (60cr) | `fal-ai/wan-25-preview/image-to-video` |
| **seedance** (260cr) | `bytedance/seedance-2.0/fast/image-to-video` |
| **veo3** (400cr) | `fal-ai/veo3/image-to-video` |

Direct Veo (`veo.ts`) also references `veo-3.0-fast-generate-001`.

### ElevenLabs — `eleven_turbo_v2_5` TTS (alternate Venus voice path, `api.elevenlabs.io`).

### Anthropic Claude — the **forge robot**
Headless `claude` CLI on the DigitalOcean droplet builds/revises brand sites on working branches.
Conditioned by a Master `CLAUDE.md` at `/home/forge/.claude/CLAUDE.md` (mirrors
`forge-worker/forge-CLAUDE.md`). See [studio/FORGE_AI.md](../studio/FORGE_AI.md).

### Custom DSP — lip-sync (no external service)
FFT formant analysis (`venus-formants.ts`) → JALI viseme mapper (`venus-viseme-map.ts`) →
self-calibrating `VoiceNorm` + time-synced speech levels (`venus-speech-level.ts`) → drivers
(`venus-lipsync.ts`). Unit-tested with the `tsx` runner (`npm run test:lipsync`).

---

## Commerce, payments & fulfillment

| Service | SDK / API | Role |
|---|---|---|
| **Stripe** | `stripe` ^22.2.1 (platform-api) + raw `api.stripe.com/v1` | Checkout (central POS), subscriptions/billing, **Stripe Connect** destination-charge payouts, webhooks. Stripe Tax planned (marketplace facilitator). |
| **Apple IAP / StoreKit 2** | `react-native-iap` v15 + **App Store Server API** (`app-store.ts`, ES256 JWT) | Plans + credit packs on iOS; server-side receipt verification (`api.storekit.itunes.apple.com` + sandbox). |
| **Printful** | REST `api.printful.com` (`printful.ts`) | Primary POD provider — catalog, variants, mockups, order fulfillment. |
| POD abstraction | `src/lib/pod-policy.ts` (`POD_PROVIDERS`) | Per-provider content policy + future fulfillers (manufacturer-connect roadmap). Adding a provider is a platform-api change — **zero template edits**. |

Pricing is single-sourced (`pricing.ts`, cost+floor) and enforced at `/api/publish`.

---

## Media & image processing

| Tool | Version | Role |
|---|---|---|
| **Cloudinary** | `cloudinary` ^2.10.0 (`api.cloudinary.com`) | Asset hosting + transforms |
| `sharp` | ^0.35.1 (dev/server) | App icon/mark generation (`gen-icons.mjs`) |
| `jpeg-js` / `pngjs` | ^0.4.4 / ^7.0.0 | Pixel-level **magenta chroma-key + auto-crop** (`transparency.ts`) — Nano Banana can't emit alpha |
| `react-native-view-shot` | 4.0.3 | On-device annotated-screenshot capture for the live-site editor |

---

## Infrastructure, hosting & external platforms

| Platform | Used as | Notes |
|---|---|---|
| **Google Cloud Run** | App backend host (`api.nanocrew.app`, direct `backend-927523030808.us-west1.run.app`) | Persistent Node via `expo serve` — **NOT** EAS Hosting (Cloudflare Workers broke postgres-js for authed routes). Deploy: `./scripts/deploy-cloudrun.sh nanocrew-api us-west1 backend`. Free tier, `min-instances=0` (cold starts). Migrated off Railway Jul 2026. |
| **Vercel** | platform-api + nanocrew-site + every brand storefront | `api.vercel.com` also used to provision custom domains (`domains.ts`). |
| **DigitalOcean** | forge droplet | Headless Claude + `nanocrew-forge-worker` systemd service draining the `store_revisions` queue. **Hand-kept mirror** — re-scp `worker.mjs` after edits. |
| **Supabase** | Postgres + Auth | The shared DB + identity provider. |
| **GitHub** | `api.github.com` (`revise.ts`, `provision.ts`) | Branch-based site edits: `revision/<id>` branch → Vercel preview → approve → merge. Needs `GITHUB_OWNER`/`GITHUB_TOKEN`. |
| **Expo / EAS** | Build · Submit · Update | `eas.json` profiles dev/preview/production (`autoIncrement`, `appVersionSource: local`). iOS submit via ASC API key. Project `2bf027c9-…`. |
| **Expo Push** | `exp.host/--/api/v2/push/send` (`push.ts`) | Notifications; FCM/Firebase for Android push is planned. |
| **Resend** | email (`notify.ts`, `RESEND_API_KEY`) | Branded transactional mail (per-brand `no-reply-{slug}@…`). |

---

## Dev tooling & quality

| Tool | Version | Role |
|---|---|---|
| **ESLint** | ^9.0.0 + `eslint-config-expo` ~10.0.0 | `npm run lint` (`expo lint`) |
| **TypeScript** | ~6.0.3, `strict` | Typecheck gate before build/push |
| **tsx** | (via `test:lipsync`) | Lightweight test runner for the lip-sync DSP suite |
| `dotenv` | ^17.4.2 | Loads `.env.local` for drizzle-kit |
| `drizzle-kit studio` | — | DB browser |

**Pre-push gate (Joe's rule):** `tsc` + `npx expo export` + `expo lint` must pass; commit at each
milestone; end commit messages with the Co-Authored-By trailer. (Run automatically — the "working
loop" in [`../context/CODE_STANDARDS.md`](../context/CODE_STANDARDS.md).)

---

## Design tokens & fonts

- **Fonts:** **Jost** bundled (`assets/fonts/Jost-{Thin,Light,Regular,Medium}.ttf`, OFL) as the mono
  type; system `sans` / `serif` / `rounded` otherwise. (General Sans referenced as the app sans in
  brand notes.)
- **Palette (cool monochrome + platinum silver, no gold)** lives in **three files that must stay in
  sync**: `src/constants/theme.ts` (`Colors`), `src/lib/studio-palette.ts` (`makeStudioPalette`),
  `src/components/nc-screen.tsx` (`usePalette`). Individual brand storefronts keep their own colors.
- App-level UI primitives + reuse rules: *(front-end UI-system doc — to be added under `docs/app/`).*

---

## Platform targets

| | Status |
|---|---|
| **iOS** | iPhone-only (`supportsTablet: false`), bundle `com.nanocrew.app`, build 37. Live on TestFlight; submitted to App Store. Capabilities: IAP, Push, Sign in with Apple. |
| **Android** | `com.nanocrew.app`, versionCode 6, adaptive icon. `.aab` built; Google Play internal testing. |
| **Web** | `react-native-web`, `web.output: "server"` (used for dev preview + nanocrew.app surfaces). |

---

## Stack-specific gotchas (footguns that come from these choices)

> These are the stack-derived half of the hard rules; the full enforced set (tenancy, cascade,
> process) is [`../context/NEVER_VIOLATE.md`](../context/NEVER_VIOLATE.md).

1. **Metro `@google/genai` web-build override** — don't remove it; the node build's `ws` dependency hangs the Gemini Live session in RN.
2. **Babel `class-static-block` plugin** — required for three.js to parse on native.
3. **postgres-js on the persistent Node host** — no `fetch()` before the first DB query in an authed route.
4. **Schema is duplicated** — `platform-api/db/schema.ts` mirrors `src/db/schema.ts`.
5. **forge-worker is a hand-kept mirror** — re-scp `worker.mjs` after editing; pushing the repo doesn't ship it.
6. **Skia/three are web/native-split** — `*.web.tsx` variants; Skia web needs the CanvasKit WASM `locateFile`.
7. **Dev build mandatory** — Expo Go can't load the native modules (notifications, apple-auth, IAP, view-shot, audio-api).
