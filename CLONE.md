# CLONE.md — migrate Nano Crew to a fresh Mac

> **You are Claude Code on a brand-new MacBook Pro.** Your job: stand up the entire **Nano Crew**
> project — all repos, all context, all access — so the human can keep working exactly where they
> left off. Read this whole file first, then execute top-to-bottom. Steps marked **🧑 HUMAN** are for
> the human to do (auth, passwords, moving secret files) — you must **not** do those yourself; pause
> and ask. Everything else, you run.
>
> **This file contains NO secrets** — every key/token/password travels in the files the human
> AirDrops (next section). Never paste a secret value into a file or a chat.

Author: built on the *old* Mac (`/Users/macdaddyjoe/code/nanocrew`) as a migration handoff. Assumes
the new Mac uses the **same username (`macdaddyjoe`)** and the **same project path
(`/Users/macdaddyjoe/code/nanocrew`)** — see "If the username/path differ" at the end if not.

---

## 0. What Nano Crew is (30-second orientation)
AI-native creator commerce (Expo / React Native, iOS + Android). A creator talks to **Venus** (voice/
typed AI) → it auto-generates a Printful-backed shop **and** a per-brand storefront website, then they
design, sell, and edit by chatting. **The deep context lives in the repo** — after you clone, the
source of truth is `CLAUDE.md` → `docs/context/` (read-order in `docs/context/README.md`). Don't
re-derive what's already documented there.

**Four deployable units (one shared Supabase Postgres):**
1. **Mobile app** (this repo root) — Expo; server routes (`src/app/**+api.ts`) run on **Google Cloud Run**.
2. **platform-api/** — Next.js on **Vercel** (public storefront API + webhooks + Stripe).
3. **nanocrew-templates** (separate repo) — 5 Next.js storefront templates.
4. **forge** — a **DigitalOcean droplet** (`ssh nanocrew-forge`) running headless Claude; the worker
   lives at `forge-worker/` in this repo and is hand-`scp`'d to the droplet.

---

## 1. 🧑 HUMAN — the transfer manifest (do this FIRST, this is "all the access")
None of these are in git. AirDrop / securely copy them from the **old Mac** to the **new Mac** at the
**exact same paths**. Tell Claude when each is in place.

| From (old Mac) | To (new Mac) — same path | What it is |
|---|---|---|
| `~/code/nanocrew/.env.local` | `~/code/nanocrew/.env.local` | **All 52 secrets** (every API key/token). The single source. |
| `~/.app-store-connect-keys/AuthKey_SP238255VU.p8` | same | Apple App Store Connect API key (EAS submit). |
| `~/.ssh/` (the `id_*` GitHub key, the `nanocrew` forge key, and `config`) | `~/.ssh/` | GitHub push/pull + the **forge droplet** access (`Host nanocrew-forge` → `IdentityFile ~/.ssh/nanocrew`). |
| `~/.claude/projects/-Users-macdaddyjoe-code-nanocrew/memory/` (29 files + `MEMORY.md`) | same | The project's **persistent memory** (cross-session context). Path slug must match the project path. |

> After copying `~/.ssh/`, run `chmod 600 ~/.ssh/id_* ~/.ssh/nanocrew && chmod 644 ~/.ssh/*.pub ~/.ssh/config`.
> If you'd rather not copy GitHub keys, generate a fresh one on the new Mac and add it to GitHub instead.

**Nothing else from `.env.local` needs reproducing** — there's no `.env.example`; that file *is* the
canonical list. The sub-projects (`platform-api/`, `nanocrew-site/`) read their secrets from Vercel/
Cloud Run in prod and don't need a local `.env.local` for normal dev.

---

## 2. Toolchain (Claude runs this)
Target versions (match the old Mac): **Node 22** (`.nvmrc`), npm 11, Xcode 26.3, CocoaPods 1.16, Watchman, gh 2.86.

```bash
# Homebrew (if missing)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install nvm watchman gh git
# Node 22 via nvm  (the repo pins 22 in .nvmrc; Cloud Run runs 22)
mkdir -p ~/.nvm && nvm install 22 && nvm alias default 22
# CocoaPods (for local native iOS builds) — Ruby gem
sudo gem install cocoapods   # or: brew install cocoapods
```
- **🧑 HUMAN:** install **Xcode** from the App Store, then `sudo xcodebuild -license accept` and
  `xcode-select --install` (Command Line Tools). Needed only for *local* on-device builds — EAS
  builds in the cloud regardless.
- EAS CLI is used via `npx eas-cli@latest` (no global install needed).

---

## 3. 🧑 HUMAN — authenticate (browsers/passwords — Claude must NOT do these)
- **GitHub:** `gh auth login` (or just rely on the copied SSH key). Verify: `ssh -T git@github.com`.
- **Expo/EAS:** the `EXPO_TOKEN` in `.env.local` auto-auths CLI commands; or `npx eas-cli@latest login`
  (account **averagexjoe** / josephsardella@gmail.com). Verify: `EXPO_TOKEN=… npx eas-cli@latest whoami`.
- **(optional) Vercel/gcloud CLIs** — only if you want CLI deploys; the API tokens in `.env.local`
  (`VERCEL_TOKEN`, `RAILWAY_API_TOKEN`) cover scripted deploys without a login.

---

## 4. Clone the repos (Claude runs)
```bash
mkdir -p ~/code && cd ~/code
git clone git@github.com:VirtualJoe760/nanocrew.git              # the main app (this repo) — REQUIRED
git clone git@github.com:VirtualJoe760/nanocrew-templates.git    # 5 storefront templates — REQUIRED
git clone git@github.com:VirtualJoe760/stephen-lawyer.git        # reference: the original create→design→Printful loop (optional)
git clone git@github.com:VirtualJoe760/store-alpha-master.git    # a brand store, reference (optional)
```
The main repo already contains `platform-api/`, `nanocrew-site/`, and `forge-worker/` — no separate
clones for those. The **forge** is a server, not a clone — see §8.

After cloning, **🧑 HUMAN drops in the secret files** from §1 (`.env.local` into `~/code/nanocrew/`, etc.).

---

## 5. Install dependencies (Claude runs)
```bash
cd ~/code/nanocrew && nvm use && npm install        # main app
cd platform-api && npm install && cd ..              # Next.js API
cd nanocrew-site && npm install && cd ..             # marketing/company site
cd forge-worker && npm install && cd ..              # the droplet worker (Node ESM)
cd ~/code/nanocrew-templates && npm install          # templates (per-template installs may also apply)
```
npm (not pnpm) everywhere.

---

## 6. Verify it runs (Claude runs)
```bash
cd ~/code/nanocrew
npx tsc --noEmit          # must be clean
npm run web               # Expo web on http://localhost:19010 — the dev surface (incl. the Venus Lab)
```
If the web app loads and you can reach **Account → Venus Lab (test)** (gated to
josephsardella@gmail.com), the env + auth are wired correctly. Other scripts: `npm run ios` /
`npm run android` (native), `npm run db:generate|db:migrate|db:studio` (Drizzle), `npm run test:lipsync`.

---

## 7. (Optional) Local native iOS dev build — for on-device work
EAS builds in the cloud, so this is only for local on-device iteration. Native modules
(react-native-skia, expo-gl, expo-notifications, apple-auth, react-native-iap, react-native-webview)
mean **Expo Go won't work — a dev build is required.**
```bash
cd ~/code/nanocrew
[ -d ios ] || npx expo prebuild -p ios            # generate ios/ if not present
cd ios && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install && cd ..   # the LANG vars matter (gotcha)
```
> **Gotcha (from memory):** `expo run:ios --device` is broken on Xcode 26.3 — instead open
> `ios/NanoCrew.xcworkspace` in **Xcode** and build to the device from the GUI, with Metro running
> (`npm run ios` or `npx expo start --dev-client`, port 8081). See `docs/ops/DEV_BUILD.md` +
> the `native-dev-build-gotchas` memory.

---

## 8. 🧑 HUMAN — the forge droplet (DigitalOcean)
The forge is a remote server, not a clone. Access = the `~/.ssh/nanocrew` key + the `Host nanocrew-forge`
entry in `~/.ssh/config` (both copied in §1). Verify: `ssh nanocrew-forge` (User `root`).
- The droplet runs headless Claude (provision/revise brand sites) + the `nanocrew-forge-worker`
  systemd service draining the `store_revisions` queue.
- **`forge-worker/worker.mjs` is a hand-kept mirror** — editing it in the repo does NOT deploy it;
  you must `scp` it to the droplet (see `forge-worker/README.md`). Same for `forge-worker/forge-CLAUDE.md`
  (→ `/home/forge/.claude/CLAUDE.md`).

---

## 9. Access & services map (what each token unlocks)
All values live in the copied `.env.local`. Accounts to retain access to:

| Service | Env var(s) | Account / notes |
|---|---|---|
| **GitHub** | SSH key, `GITHUB_TOKEN`, `GITHUB_OWNER` | VirtualJoe760. Branch-based site edits use the token. |
| **Expo / EAS** | `EXPO_TOKEN` | averagexjoe. Build + submit. Project `2bf027c9-53e8-4125-8fc8-7679b44942bc`. |
| **Apple / ASC** | `~/.app-store-connect-keys/AuthKey_SP238255VU.p8`, `APPLE_IAP_*`, `APPLE_BUNDLE_ID` | Team `B9B54TAWG4` · ascAppId `6780275901` · bundle `com.nanocrew.app`. |
| **Railway** (app backend) | `RAILWAY_API_TOKEN` (project-scoped) | project `nanocrew-api` (`6d1839f0-…`) · service `backend` (`f55f4d1e-…`) · env `production` (`29efd9e4-…`). URL `backend-production-d7eb.up.railway.app`. |
| **Vercel** | `VERCEL_TOKEN` | platform-api (`nanocrew-api.vercel.app`) + nanocrew-site + per-brand storefronts. |
| **Supabase** | `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS`, `DATABASE_URL`, `DATABASE_URL_SESSION`, `EXPO_PUBLIC_SUPABASE_*` | Auth + Postgres. Migrations use the **session** pooler. |
| **DigitalOcean** | `DO_API_TOKEN`, `VPS_HOST`, `VPS_USER` | the forge droplet. |
| **Stripe** | `STRIPE_SECRET_KEY` (live), `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_BILLING_WEBHOOK_SECRET`, `STRIPE_PRICE_*` | central POS + Connect payouts. |
| **Printful** | `PRINTFUL_API_KEY`, `PRINTFUL_STORE_ID` | POD provider. |
| **Google Gemini** | `GEMINI_API_KEY`, `GOOGLE_GENAI_API_KEY` | Venus text/voice + Nano-Banana images. |
| **fal / Seedance** | `SEEDANCE_API_KEY` | scene video. |
| **ElevenLabs** | `ELEVENLABS_API_KEY` | alt TTS. |
| **Simli** | `SIMLI_API_KEY` (+ `SIMLI_FACE_ID` optional) | the photoreal Venus renderer (Venus Lab). |
| **Cloudinary** | `CLOUDINARY_*` | media hosting/transform. |
| **Resend** | `RESEND_API_KEY` | transactional email. |
| **Anthropic** | `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` | the forge's headless Claude + scripts. |
| internal | `INTERNAL_API_KEY`, `COMP_EMAILS`, `PLATFORM_API_BASE`, `EXPO_PUBLIC_API_URL` | server-to-server + config. |

---

## 10. Deploy targets (reference — confirm with the human before any deploy)
- **App backend (Google Cloud Run):** deploy with `./scripts/deploy-cloudrun.sh nanocrew-api us-west1 backend`
  — it builds via Cloud Build (`cloudbuild.yaml` passes the 3 `EXPO_PUBLIC_*` values as `--build-arg`,
  since they're inlined into the client bundle) and uploads every other key from `.env.local` as a
  runtime env var. Serves at `https://api.nanocrew.app`. There is no git auto-deploy — run the script.
- **platform-api / nanocrew-site (Vercel):** deploy via Vercel (`VERCEL_TOKEN`) / git integration.
- **iOS build → TestFlight (EAS):** `EXPO_TOKEN=… npx eas-cli@latest build -p ios --profile production
  --auto-submit` (autoIncrement buildNumber; submits via the ASC `.p8`).
- **Forge worker:** `scp forge-worker/worker.mjs nanocrew-forge:…` (hand-kept mirror — see §8).

---

## 11. Hand off to the project's own context system
Once the repo is cloned and `npm run web` works, **stop following this file** and switch to the repo's
living docs — they're the source of truth from here on:
1. `CLAUDE.md` (repo root) — the orchestrator + read-order.
2. `docs/context/CONTEXT_GUIDE.md` — how to work with the agent here.
3. `docs/context/NEVER_VIOLATE.md` — the hard rules (read before any change).

The persistent **memory** you copied in §1 will auto-load each session (it's keyed to the project path).

---

## 12. ✅ Final verification checklist
- [ ] `~/code/nanocrew/.env.local` present (52 vars); `ssh -T git@github.com` works; `ssh nanocrew-forge` works.
- [ ] `npx tsc --noEmit` clean; `npm run web` serves on :19010; Venus Lab opens (tester email).
- [ ] `EXPO_TOKEN=… npx eas-cli@latest whoami` → averagexjoe.
- [ ] `gcloud run services describe backend --project=nanocrew-api --region=us-west1` returns the service URL.
- [ ] Memory dir copied (`~/.claude/projects/-Users-macdaddyjoe-code-nanocrew/memory/`, 29+ files).
- [ ] `nanocrew-templates` cloned + installed.

## If the username/path differ on the new Mac
The memory dir is keyed to the absolute project path (`-Users-macdaddyjoe-code-nanocrew`). If the new
Mac's username isn't `macdaddyjoe` or the project isn't at `~/code/nanocrew`, rename that slug folder
to match the new path (replace `/` with `-`), or the memory won't auto-load. Everything else is
path-independent.

---

## 🛑 Safety reminders for Claude (the new instance)
- **Never** type passwords, accept logins, or paste secret values — those are 🧑 HUMAN steps.
- Treat deploys, pushes, builds, and submissions as outward-facing — **confirm with the human first.**
- This migration is **setup only**: get it running + access wired. Don't deploy or build to prod as
  part of cloning.
