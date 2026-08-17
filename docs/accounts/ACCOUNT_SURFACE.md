# The account surface — app · web · API

**One creator identity, two front doors.** The Account page exists in the **app**
(`src/app/account.tsx`) and on the **web** (`nanocrew-site/app/account/`). They are not allowed to
drift: a creator who manages their brand from a laptop must find the same capabilities as one on a
phone, minus the deliberate exceptions listed below.

> **The rule (Joe, 2026-08-16):** *change the account page in one place and you change it in all
> three — app, website, API — in the same commit.* A PR that adds a capability to one front door and
> not the other is incomplete, exactly like a PR that ships code with stale docs.

## Parity matrix

Update this table in the same change that adds or moves a capability. It is the checklist.

| Capability | App | Web | Endpoint |
|---|---|---|---|
| Identity header (avatar · email · plan · creator id) | ✅ read-only | ✅ read-only | app `GET /api/me` · web `GET /api/creator/account` |
| Edit name / phone | ❌ *(captured at sign-up only)* | ✅ | `PATCH /api/creator/account` (platform-api) |
| Change password | ❌ | ✅ | Supabase `auth.updateUser` (client) |
| Your brands | ✅ | ✅ | app `GET /api/me` · web `GET /api/creator/stores` |
| Brand collaborators (invite · remove · revoke) | ✅ | ✅ | `GET/POST/DELETE /api/creator/stores/:slug/collaborators` — **owner-only on both** |
| Pending invitations (accept / decline) | ✅ | ✅ *(via the invite link)* | app `/api/creator/invites` · web `POST /api/public/invite` |
| Stripe payouts (Connect onboarding + status) | ✅ | ✅ | `GET/POST /api/creator/connect` — **the app's Cloud Run backend, shared by both** |
| Orders / purchases | ✅ | ❌ | `/api/customer/orders`, `/api/customer/returns` |
| Earnings | ✅ | ❌ | `/api/creator/stats` |
| Subscription & billing / paywall | ✅ | ❌ *(web billing is a separate rail)* | `/api/creator/subscription`, `/api/creator/billing/portal` |
| Platform admin | ✅ *(admin only)* | ❌ | `/api/platform/admin` |
| Eve Lab | ✅ *(dev only)* | ❌ | — |
| Sign out | ✅ | ✅ | Supabase |
| Delete account | ✅ | ❌ **deliberate** | `DELETE /api/me` |

### Deliberate exceptions — do not "fix" these without a decision

- **Email is never editable** on either surface. It is the identity key: collaboration invites match
  `store_invites.email` and customers look up orders by email, so changing it silently strips people
  of pending invites and order history. Moving an email is a migration, not a form field.
- **Account deletion stays in the app.** Irreversible, and it already has a confirmation flow there.
- **Name / phone editing is web-first** because the app has never offered it. If the app gains it,
  it must use `PATCH /api/creator/account` — do not add a second profile-write endpoint.

## Which backend serves what, and why

The site uses **two** API bases. This is not an accident and it is not free to change:

| Base | Serves | Constraint |
|---|---|---|
| `platform.nanocrew.app` (platform-api) | account, stores, collaborators | We control its CORS, so `PATCH`/`DELETE` work. |
| `api.nanocrew.app` (app backend, Cloud Run) | **Stripe Connect payouts only** | Its CORS is emitted by the Expo server runtime and allows only `GET, POST, OPTIONS` — so nothing needing another verb can live there. Reused anyway because Connect (accounts, onboarding links, refresh) lives in `src/lib/connect.ts`, and a second Connect integration against one Stripe account would be a liability. |

Practical consequence: **a new web capability that needs `PATCH`/`DELETE` goes on platform-api.** If
it must live on the app backend, it has to be expressible as `GET`/`POST`.

## When you touch the account page

1. Make the change in `src/app/account.tsx` **and** `nanocrew-site/app/account/`.
2. If it needs data, decide the backend using the table above — don't duplicate an endpoint that
   already exists on the other unit; call it if CORS allows.
3. Update the parity matrix here, and [`API.md`](../architecture/API.md) if a route shape changed.
4. If a capability is intentionally one-sided, add it to **Deliberate exceptions** with the reason.

Related: [`AUTH_IDENTITY.md`](AUTH_IDENTITY.md) · [`PAYOUTS_SETUP.md`](PAYOUTS_SETUP.md) ·
[`EMAIL_PIPELINE.md`](EMAIL_PIPELINE.md) · [`../architecture/ARCHITECTURE.md`](../architecture/ARCHITECTURE.md)
