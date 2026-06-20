# POD provider content policy (the registry)

**Two different filters, deliberately separate:**

| Layer | File | Governs | Stance |
|---|---|---|---|
| **Generation safety** | `src/lib/content-safety.ts` | what we'll *generate* | **Permissive** — creators own their designs (nudity, edgy, action all fine; block only CSAM, porn, high-gore) |
| **Fulfillment policy** | `src/lib/pod-policy.ts` | what a manufacturer will *print + ship* | **Provider's rules** — stricter; e.g. Printful refuses hate, IP infringement, etc. |

The gap between them is the whole point: we happily generate a design the **print provider** would refuse. Without a check, the creator only finds out *after* a customer pays and Printful rejects the order. The registry closes that gap by screening **before** a product goes live.

## The registry — `src/lib/pod-policy.ts`

`POD_PROVIDERS` holds the **built-in** POD providers (`printful`, `printify` today; `gooten`/`gelato`/… later). Each `ProviderPolicy` is `{ id, name, policyUrl, rules: { category, severity, test, reason }[] }`, transcribed from that provider's published Acceptable-Content guidelines.

- **`checkProviderPolicy(providerOrPolicy, text)`** → `{ provider, ok, blocks[], warnings[] }`. Pass a **built-in id** (looked up in the registry) **or a `ProviderPolicy` object directly** — the latter is how a connected manufacturer's DB-loaded policy is screened without touching the registry (see roadmap). `blocks` (severity `block`) should stop a publish; `warnings` are surfaced to the creator but don't block. Unknown id → permissive (`ok:true`) so a config gap never silently blocks legit sales.
- **`resolvePodProvider({ storeId, productId })`** → which provider a store/product fulfills through. Returns `'printful'` today; when products carry a provider (a built-in id **or** a connected-manufacturer id), resolve it here and **every call site stays unchanged.**
- **`listProviderPolicies()`** → all built-in policies (e.g. a settings/policy-links screen).
- It's a best-effort **heuristic** over the text we have (product name + description + each design's generation prompt) — fulfillers offer no real-time validation API. Not a substitute for their own review.

**`PodProvider`** is `BuiltinProvider | (string & {})` — open to arbitrary connected-manufacturer ids at runtime while keeping autocomplete for the built-ins.

**Rules today:**
- **Printful** — `block`: pornographic, hate/extremist, violence/terrorism, self-harm. `warn`: hard-drugs, third-party IP/trademark.
- **Printify** — same hard blocks, **plus** a `warn` on **regulated-goods promotion** (firearms/ammo/tobacco/vape *sales* — imagery is fine). This divergence is the point: a design clean for Printful can still draw a Printify warning, which is exactly why the gate is **per-provider, not global** (and never baked into generation).

**Adding a built-in provider:** add a `ProviderPolicy` to `POD_PROVIDERS`. The `PodProvider` type already accepts the new id; every call site reads the registry unchanged.

## Roadmap — manufacturer connect (white-label API)

Soon manufacturers will connect via an API to list their **white-label** products on our storefronts. A connected manufacturer is just another **fulfiller** in this model:

1. **At connect time** the manufacturer provides their AcceptableContent policy → stored in the DB as a `ProviderPolicy` (rules as JSON), keyed by a manufacturer id.
2. **`resolvePodProvider`** returns that manufacturer id for products they fulfill.
3. **At launch / fulfillment** we load their policy from the DB and call `checkProviderPolicy(policy, text)` — passing the **policy object**, no registry edit, no per-manufacturer code. Built-in POD providers and connected manufacturers run the identical gate.

So the registry stays the home of built-ins; connected manufacturers are DB-backed and screened by the same function. Generation never changes — it stays the universal floor (CSAM/porn/gore), and each fulfiller enforces its own line at launch.

## Where it's enforced

- **Publish (primary gate):** `POST /api/publish` ([publish+api.ts](../../src/app/api/publish+api.ts)) screens name + description + design prompts before `createSyncProduct`. A `block` returns **HTTP 422 `{ error:'provider_policy', message, blocks }`** and the product is never created on Printful or mirrored locally. `warnings` ride along in the success response for the UI to show.
- **Fulfillment (safety-net):** `submitOrderToPrintful` (`platform-api/lib/fulfill.ts`) re-screens a paid order's products (name + description + design prompts, joined order→variant→product→composition→design) **before** sending to Printful. A block sets the order to **`on_hold`** and skips submission — the order is **never auto-refunded** (money stays put; a human reviews/refunds). The publish gate already screens new products, so this only catches *legacy* products published before the gate. Uses `platform-api/lib/pod-policy.ts` — a **copy** of `src/lib/pod-policy.ts` that must be kept in sync (same as the schema copy).

## Returns constraint — POD is made-to-order (no buyer's remorse)

A second consequence of fulfilling through a POD provider: every item is **printed on demand for that
order**, so there is **no buyer's-remorse / change-of-mind return** to give. A returned blank tee can
be restocked; a one-off printed garment can't. The platform's returns policy therefore accepts only
**defect / wrong-item / damaged / not-received** claims — the cases where the *fulfiller* (not the
buyer) is at fault — and on a genuine defect Printful reprints at no cost to us. This isn't a separate
content rule; it's the same made-to-order reality the registry exists for, applied to the post-sale
side. The returns model, window, and refund mechanics are in
[RETURNS_REFUNDS.md](RETURNS_REFUNDS.md), and the Merchant-of-Record question it raises is in
[COMPLIANCE.md](COMPLIANCE.md).

## Verified
- `checkProviderPolicy('printful', …)` — flags / tasteful nudity / "Trump + guns like Terminator" → allow; porn / hate / terror / self-harm → block; Disney / cocaine → warn.
- `checkProviderPolicy('printify', …)` — same hard blocks; **"buy guns and ammo" / "sell cigarettes shop" → regulated-goods warn**, while "vintage rifle illustration" / "mountain trail runner" → allow (imagery isn't sale promotion); Marvel → IP warn. Confirms the per-provider divergence and the registry's multi-provider path.
