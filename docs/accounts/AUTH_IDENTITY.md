# Auth & Identity

How a person becomes known to Nano Crew, how the server proves it on every request, and what
that identity is allowed to touch. **Read this before editing anything that signs a user in,
reads a token, or scopes data to a creator.**

## There is one identity: a Supabase Auth user

Auth itself lives entirely in **Supabase Auth** (`auth.users`). Our own `creators` table is a
**mirror**, not a second source of truth (`src/db/schema.ts`):

```ts
export const creators = pgTable('creators', {
  id: uuid('id').primaryKey(),            // = Supabase auth.users.id (NOT defaultRandom)
  email: text('email').notNull().unique(),
  name: text('name'),
  phone: text('phone'),                   // collected on email signup
  image: text('image'),
  termsAcceptedAt: timestamp('terms_accepted_at'),  // legal acceptance, recorded at account creation
  termsVersion: text('terms_version'),              // which Terms+Creator-Agreement version (lib/legal.ts)
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

- `creators.id` **equals** the Supabase user id — the access token's `sub`. We never mint our
  own user ids; we copy Supabase's.
- `email` is **UNIQUE** — one row per person. Everything a creator owns FKs to `creators.id`
  with `onDelete: 'cascade'`: `stores.creatorId`, `creditAccounts.creatorId`,
  `subscriptions.creatorId`, `connectedAccounts.creatorId`, `deviceTokens.creatorId`,
  `store_collaborators.creatorId`, `designs.createdBy`.

So "an account" = a Supabase user = a `creators` row. There is no separate "shopper" account
type today (see [ORDERS.md](ORDERS.md)).

## Signing in (client) — `src/lib/oauth.ts` + `src/hooks/use-auth.ts`

The app authenticates against Supabase Auth via `supabase-js`. Providers (`src/lib/oauth.ts`):

- **Apple on iOS** uses the **native** Sign in with Apple sheet (`expo-apple-authentication`,
  lazy-required — dev-build-only) and exchanges the identity token via
  `supabase.auth.signInWithIdToken({ provider: 'apple', token })` — no client secret to
  configure or expire. The Supabase Apple provider only needs the bundle id `com.nanocrew.app`.
- **Google / Facebook** run the web OAuth flow in an `expo-web-browser` auth session
  (`signInWithOAuth({ skipBrowserRedirect: true })`), then hand the callback tokens to
  supabase-js via `createSessionFromUrl` (PKCE `exchangeCodeForSession`, or `setSession` with
  the returned access/refresh tokens). **Facebook is hidden for v1** (button removed, provider
  off — see `CLAUDE.md`).
- **On web**, Supabase's normal full-page redirect (`redirectTo: window.location.origin`) does
  the work.

`useAuth()` (`src/hooks/use-auth.ts`) holds the `Session`, subscribes to
`onAuthStateChange`, and — once signed in — best-effort registers the device for push
(`registerForPush(session.access_token)`). Authed client calls attach the Supabase token via
`apiFetch()` (`src/lib/api.ts`).

**Email signup collects more + records legal acceptance.** The Account screen's email signup asks for
**name + phone** and requires accepting the **Terms + Creator Agreement** (a required checkbox; OAuth
providers usually supply name only, so this is the gap we fill). These ride in `signUp`'s
`options.data` (`user_metadata`: `name`, `phone`, `terms_version`); `getUserFromRequest` surfaces
`phone` + `termsVersion`, and `/api/me` upserts them onto `creators` and **stamps `termsAcceptedAt`
server-side** the first time (never overwriting an existing acceptance). The accepted version comes
from `src/lib/legal.ts` `TERMS_VERSION`; the full text (incl. the creator indemnification /
manufacturer-hold-harmless / generation-records clause) is at `/terms`.

> The redirect URI is `nanocrew://auth` in a dev/standalone build (`exp://…/--/auth` in the
> retired Expo Go). It plus the web origin must be allow-listed in Supabase → Auth → Redirect
> URLs.

## Verifying a token (server) — two different mechanisms

Both deployable units accept the **same** Supabase access token in `Authorization: Bearer …`
and return the same `AuthedUser { id, email, name? }`, but they verify it differently:

### App backend (Railway) — verifies LOCALLY · `src/lib/auth.ts`

`getUserFromRequest(req)` verifies the JWT's **ES256 signature against the project JWKS** using
Web Crypto, with **zero network I/O in the hot path** (keys come from `SUPABASE_JWKS`, cached;
falls back to fetching the JWKS once if unset). It then checks `exp`, `aud === 'authenticated'`,
and `iss === <SUPABASE_URL>/auth/v1`, and pins `alg === 'ES256'` (no `none`/HS confusion).

Why local: the old approach called `/auth/v1/user` on every request, but on EAS Hosting
(Cloudflare Workers) opening a postgres socket *after* an outbound `fetch()` in the same request
reliably failed — breaking every authed DB route. Verifying locally means authed routes make no
fetch before their DB query. (The backend has since moved to Railway, but local verify stays —
it's strictly better.)

`getUserFromRequest` also honors a **trusted server-to-server path**: a valid `x-internal-key`
(constant-time compared to `INTERNAL_API_KEY`) plus an `x-internal-creator` header authenticates
**as** that creator, so the normal ownership checks still apply (used by `AUTO_FIRST_DROP`
first-drop generation).

### platform-api (Vercel) — verifies REMOTELY · `platform-api/lib/auth.ts`

`getUserFromRequest(req)` calls `GET {SUPABASE_URL}/auth/v1/user` with the bearer token +
`apikey`, and maps the response to `AuthedUser`. Simpler, one network call per authed request —
fine here because platform-api's creator routes are lower-traffic and Vercel doesn't have the
Workers socket pathology. **This is a deliberate divergence from the app**, not drift; the file
header even calls itself a "mirror of nanocrew/src/lib/auth.ts."

## What the identity can touch — store ownership + collaborators · `src/lib/tenant.ts`

A **store is owned by exactly one creator** (`stores.creatorId`). Beyond the owner, extra
creators may admin/design a store via **`store_collaborators`** (`src/db/schema.ts`) — the owner
is implicit and never listed there; `role` defaults to `'admin'` (room for `'designer'` later).
This is what lets a client (e.g. Stephen Lawyer) and the agency share one store.

`src/lib/tenant.ts` is the scoping layer every authed creator/designer route runs through:

- `isStoreMember(storeId, userId)` — true if owner **or** collaborator.
- `accessibleStoreIds(userId)` — owned ∪ collaborated store ids (the workhorse — orders, stats,
  products all filter by this).
- `storeForMember(slug, userId)`, `getCreatorStore(userId)` — resolve by slug / pick the
  primary store.
- `assert{Product,Catalogue,Composition,Design}Owner(id, userId)` — resolve a child row's store
  and throw `TenantError(403)` unless the user owns or collaborates on it.

Paid AI endpoints layer credits (`src/lib/credits.ts`) and rate-limiting
(`src/lib/rate-limit.ts`) on top of this.

## Storefront `/admin` auth — CREATOR-ONLY today · `nanocrew-templates/templates/*/lib/platform-auth.ts`

Every generated brand site ships an `/admin` that calls **platform-api** (not the app) with the
**same Supabase account** as the Nano Crew app — no Supabase SDK in the template, just the REST
endpoints (`lib/platform-auth.ts`, present in all four templates):

- `sendMagicLink(email)` → `POST {supabaseUrl}/auth/v1/otp` **with `create_user: false`**.
- `passwordLogin(email, password)` → `POST /auth/v1/token?grant_type=password`.
- token cached in `localStorage`; `creatorApi()` attaches it as a bearer to `brand.apiBase`.

**The load-bearing fact: `create_user: false` means a brand site cannot create a new account.**
There is **no shopper signup** anywhere in the templates today — `/admin` is for the creator who
already has a Nano Crew account to manage their own store. A random visitor cannot make an account
on a brand site.

## Target — the unified account (task list #21–28)

The intended end state is **one account that works on the app AND every brand site**, built on
the *same* Supabase identity we already have (no new auth system, no second user table):

- **Signing up on a brand site creates a real Nano Crew account.** The shopper-facing auth on a
  brand storefront flips from the creator-only `create_user: false` admin login to a normal
  `create_user: true` Supabase signup (email/password or OAuth), minting an `auth.users` row +
  its `creators` mirror — the exact same identity they'd have if they'd signed up in the app.
- **The same Supabase identity everywhere.** A person who signed up on `brandA.clothing` is
  signed in on the Nano Crew app and on `brandB.clothing` too — one token, one account. No
  per-site accounts.
- This unlocks the shopper "my orders" view (see [ORDERS.md](ORDERS.md) "Target") with **no
  schema change** — orders already carry `customerEmail`, which now maps to a logged-in account's
  email.

When you build any of this, wire the shopper auth at the **template level** so every generated
brand site gets it (per `AGENTS.md`), and update this doc + [ORDERS.md](ORDERS.md) in the same
change.
</content>
