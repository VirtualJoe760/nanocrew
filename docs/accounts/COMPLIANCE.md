# Marketplace compliance — onboarding brands the right way (US)

> **Status: research + build plan (2026-06-20). NOT legal/tax advice.** This is engineering
> orientation grounded in current US rules; the Terms language, marketplace-facilitator/sales-tax
> position, and 1099 filing must be confirmed with **counsel + a CPA** before relying on them.

Nano Crew is an **online marketplace + consulting partner**: creators (brands) sell POD products
through our central POS, get paid via **Stripe Connect (Express, destination charges)**, and accept a
Terms / Creator Agreement that frames the relationship (independent contractor; creator owns their
designs + indemnifies us — Terms v2026-06-18). That model is **much lighter-touch than gig platforms**
(no physical interaction → no driver-style background checks), and **Stripe Connect already does most
of the regulated work** (KYC/AML, sanctions, tax-ID collection). The gaps are an **age gate**, the
**INFORM Consumers Act** disclosures, and **sales-tax (marketplace facilitator)**.

## What Stripe Connect already covers (do NOT rebuild)
- **KYC / identity verification** of every connected account (name, DOB, address, SSN/EIN, bank).
- **AML + OFAC sanctions screening.**
- **Tax-ID collection** (the W-9-equivalent) during onboarding.
- **Age enforcement:** connected-account holders must be **18+** (Stripe allows 13–17 only with a
  legal-guardian form, in some countries).

## The regulatory map

### 1. Tax — W-9 / 1099-K
- Creators are paid through Stripe Connect, so Stripe collects their tax ID at onboarding — **we do
  NOT collect separate W-9s** for Stripe payouts.
- **1099-K threshold = $20,000 AND 200 transactions** for tax year 2025+ (the OBBBA, July 2025,
  reverted the $600 rule). Few early creators hit it.
- **To have Stripe FILE the 1099-Ks** for connected accounts, enable the **1099-K tax-reporting
  capability** on the Connect platform (off by default) so we aren't the filer.
- A separate **W-9 + 1099-NEC** only applies to payouts **outside** Stripe — e.g. the planned
  **affiliate/referral** program ([[affiliate-program]]). Collect a W-9 there.

### 2. KYC / "doing business with the right people" — Stripe, not background checks
- Stripe Connect's KYC/AML/OFAC *is* the vetting layer. **Uber-style background checks are NOT
  required** — those exist for passenger safety (a physical nexus we don't have). Our risk vectors are
  fraud, prohibited goods, and IP — covered by Stripe KYC + `pod-policy.ts` content screening at
  publish + INFORM (below).

### 3. INFORM Consumers Act (federal; in force since 2023-06-27) — **action needed**
We are an "online marketplace" with third-party sellers, so for any **high-volume seller**
(**200+ transactions AND $5,000+ gross in a 12-month window** within the prior 24 months) we must:
- **Collect + verify** bank account, tax ID, contact info → **Stripe Connect already does this**;
  retain the records and re-verify annually.
- **Disclose the seller to buyers** on their listings — seller name, physical address, and contact
  (carve-outs for individuals without a business address).
- Provide a consumer **"report suspicious activity"** mechanism.
- **Suspend** sellers who won't provide/verify the info.

### 4. Age / minors / COPPA — **action needed (current gap)**
- **Selling / receiving payments requires 18+.** Stripe requires 18 for connected accounts, AND
  minors generally **can't form a binding contract**, so an under-18 can't validly accept the Terms.
- **A minor's brand** (e.g. a 13-yo streamer) needs a **parent/guardian as the account holder** — the
  guardian signs the Terms and owns the Stripe account; the brand can still be "theirs."
- **COPPA:** don't knowingly collect personal info from **under-13**. Set a hard floor of 13 to have
  any account and **18+ (or guardian) to sell**, stated in the Terms.
- **Current gap:** we collect name/phone/terms but **no date of birth and no age gate** (see audit).

### 5. Sales tax / marketplace facilitator — **confirm (likely not wired)**
Most US states have **marketplace-facilitator laws**: as the **merchant of record** (destination
charges through our central POS), **we may owe collection + remittance of sales tax** on creators'
sales. **Stripe Tax / `automatic_tax` is NOT in the checkout route today** (audit). Confirm nexus +
position with a CPA; the usual fix is enabling **Stripe Tax** on the platform checkout.

### 6. The relationship / Terms (owner + counsel)
Have counsel confirm the Terms cover: marketplace-facilitator status, independent-contractor framing
(creators aren't employees), INFORM disclosures, minimum age, indemnification (present), merchant-of-
record + refund/chargeback handling. See [[commerce-pricing-flow]], [[plan-tiers]].

### 7. Merchant of Record + the return window — **confirm (return feature)**
The returns feature switches storefront checkout to **separate charges and transfers** (the platform
captures 100% and holds the brand's net for the return window — see
[RETURNS_REFUNDS.md](RETURNS_REFUNDS.md) + [BILLING_CREDITS.md](BILLING_CREDITS.md)). Under separate
charges the **platform may be the Merchant of Record** and thus legally own the refund/return
obligation to the buyer (this is the same MoR question as the sales-tax item §5 — they share a root).
Putting that obligation on the *creator* in the Terms while the *platform* is MoR is a mismatch to
resolve.

- **Policy floor:** because POD is made-to-order, the shipped return policy is scoped to
  **defect / wrong-item / damaged / not-received** claims only — **no buyer's-remorse** ship-backs
  (the [POD_POLICY.md](POD_POLICY.md) constraint). The `RETURN_WINDOW_DAYS` knob (default 7, anchored
  on ship date) is the claim window. Confirm this floor is **defensible** for the states/jurisdictions
  we sell into (some require a minimum acceptance/return right) and that the policy copy on every
  storefront matches.
- **Counsel sign-off needed before launch:** who is MoR, whether the defect-only window is sufficient,
  and the Terms wording reconciling MoR with the creator-indemnification framing. *Not legal advice* —
  flag, don't assume.

## Current-state audit (code, 2026-06-20)
- **Signup** (`src/app/account.tsx`, `src/db/schema.ts` `creators`): collects `name`, `phone`,
  `termsAcceptedAt`, `termsVersion`. **No `date_of_birth`, no age gate.**
- **Payments:** Stripe **Connect** path in `platform-api/app/api/public/checkout/route.ts`
  (destination charges); Express onboarding via `/api/creator/connect`. Stripe does KYC + tax-ID.
- **Sales tax:** no `automatic_tax` / Stripe Tax found in checkout.
- **Content/IP at publish:** `src/lib/pod-policy.ts` (`checkProviderPolicy`) screens listings.

---

## Build plan

Phased; each phase is independently shippable. **Engineering builds Phases 1–3; Phase 4 is owner +
counsel/CPA and gates the others' final wording.** Per the [[supabase-rls]] rule, every new migration
must `ENABLE ROW LEVEL SECURITY`; per [[reuse-dont-rebuild]], lean on Stripe for KYC/tax.

### Phase 1 — Age gate (selling requires 18+ / guardian)  ·  app + platform-api
1. **Capture DOB at signup** — add a date-of-birth field (or an explicit "I am 18 or older" +
   guardian path) to the signup form in `src/app/account.tsx`; block submit under 13.
2. **Persist it** — migration: `creators += date_of_birth` (or `age_verified_at` + `is_guardian`);
   sync `platform-api/db/schema.ts`; persist via `/api/me` like `termsVersion`.
3. **Gate selling** — `/api/store` (create brand) and `/api/creator/connect` (payouts) return a clear
   error if the creator is under 18 without a recorded guardian. (Stripe also enforces 18 at Connect,
   but gate earlier so the UX is clean.)
4. **Terms** — state the 13 floor + 18-to-sell + guardian rule (counsel wording).
   *Files:* `src/app/account.tsx`, `src/db/schema.ts` + migration, `platform-api/db/schema.ts`,
   `src/app/api/me+api.ts`, `src/app/api/store+api.ts`, `src/app/api/creator/connect+api.ts`.

### Phase 2 — INFORM Consumers Act  ·  platform-api + templates
1. **High-volume detection** — a helper that computes per-seller **200+ txns AND $5k+/12mo** from
   `orders`; cache a `stores.high_volume_at` flag (migration, RLS).
2. **Seller disclosure** — surface the connected account's name + business address + contact (held by
   Stripe Connect) via a public endpoint; render it on storefront product pages for high-volume
   sellers. Update `docs/storefront/STOREFRONT_DATA_CONTRACT.md` + the templates.
3. **Report mechanism** — `POST /api/public/report` (listing/seller + reason) + a "Report this
   listing" link on storefronts and `nanocrew.app`; route reports to ops.
4. **Suspension** — auto-suspend sellers whose Stripe verification is incomplete or who fail to
   provide info; admin control in `platform-admin`.
   *Files:* `platform-api/app/api/public/**`, templates (`_shared` + the 5), `STOREFRONT_DATA_CONTRACT.md`,
   `src/components/platform-admin.tsx`.

### Phase 3 — Tax  ·  Stripe config + platform-api
1. **Enable the Stripe 1099-K tax-reporting capability** on the Connect platform (dashboard +
   ensure required info collected) so Stripe files, not us.
2. **Stripe Tax on checkout** — add `automatic_tax: { enabled: true }` (+ tax codes / `tax_behavior`)
   to the platform checkout in `platform-api/app/api/public/checkout/route.ts`, pending the CPA's
   marketplace-facilitator determination. Update `docs/accounts/ORDERS.md` / `BILLING_CREDITS.md`.
3. **W-9 / 1099-NEC** — only when off-Stripe payouts ship (affiliate program): collect a W-9, file
   1099-NEC.

### Phase 4 — Legal + records (owner; gates final wording above)
- **Counsel:** Terms review for marketplace-facilitator status, INFORM disclosures, independent-
  contractor framing, minimum age, indemnification, MoR/refunds.
- **CPA:** sales-tax nexus + remittance, 1099 filing responsibility, who is MoR.
- **Records retention** for INFORM + KYC data (and a documented data-protection posture; ties to the
  [[supabase-rls]] lockdown).

## Sources
- [IRS 1099-K threshold (OBBBA) — RSM](https://rsmus.com/insights/services/business-tax/irs-updates-obbba-new-reporting-thresholds.html)
- [FTC — INFORM Consumers Act](https://www.ftc.gov/business-guidance/resources/INFORMAct)
- [Stripe — Connect age requirement (18; 13–17 w/ guardian)](https://support.stripe.com/questions/age-requirement-to-create-a-stripe-account)
- [Stripe — KYC for connected accounts](https://support.stripe.com/questions/know-your-customer-(kyc)-requirements-for-connected-accounts)
- [Stripe — required verification / 1099 filing capability](https://docs.stripe.com/connect/required-verification-information)
