# POD provider content policy (the registry)

**Two different filters, deliberately separate:**

| Layer | File | Governs | Stance |
|---|---|---|---|
| **Generation safety** | `src/lib/content-safety.ts` | what we'll *generate* | **Permissive** — creators own their designs (nudity, edgy, action all fine; block only CSAM, porn, high-gore) |
| **Fulfillment policy** | `src/lib/pod-policy.ts` | what a manufacturer will *print + ship* | **Provider's rules** — stricter; e.g. Printful refuses hate, IP infringement, etc. |

The gap between them is the whole point: we happily generate a design the **print provider** would refuse. Without a check, the creator only finds out *after* a customer pays and Printful rejects the order. The registry closes that gap by screening **before** a product goes live.

## The registry — `src/lib/pod-policy.ts`

`POD_PROVIDERS` is keyed by provider id (`printful` today; `printify`/`gooten`/`gelato`/… later). Each `ProviderPolicy` has `rules: { category, severity, test, reason }[]`, transcribed from that provider's published Acceptable-Content guidelines.

- **`checkProviderPolicy(provider, text)`** → `{ ok, blocks[], warnings[] }`. `blocks` (severity `block`) should stop a publish; `warnings` are surfaced to the creator but don't block.
- **`resolvePodProvider({ storeId })`** → which provider a store fulfills through. Returns `'printful'` today; when multi-provider lands, resolve from the store/product record here and **every call site stays unchanged.**
- It's a best-effort **heuristic** over the text we have (product name + description + each design's generation prompt) — providers offer no real-time validation API. Not a substitute for the provider's own review.

**Printful rules today:** `block` — pornographic, hate/extremist, violence/terrorism, self-harm. `warn` — hard-drugs, third-party IP/trademark (the #1 real rejection, but unreliable to detect from text, so a warning not a block).

**Adding a provider:** add a `ProviderPolicy` entry to `POD_PROVIDERS` + extend the `PodProvider` union. Done.

## Where it's enforced

- **Publish (primary gate):** `POST /api/publish` ([publish+api.ts](../../src/app/api/publish+api.ts)) screens name + description + design prompts before `createSyncProduct`. A `block` returns **HTTP 422 `{ error:'provider_policy', message, blocks }`** and the product is never created on Printful or mirrored locally. `warnings` ride along in the success response for the UI to show.
- **Fulfillment (safety-net):** `submitOrderToPrintful` (`platform-api/lib/fulfill.ts`) re-screens a paid order's products (name + description + design prompts, joined order→variant→product→composition→design) **before** sending to Printful. A block sets the order to **`on_hold`** and skips submission — the order is **never auto-refunded** (money stays put; a human reviews/refunds). The publish gate already screens new products, so this only catches *legacy* products published before the gate. Uses `platform-api/lib/pod-policy.ts` — a **copy** of `src/lib/pod-policy.ts` that must be kept in sync (same as the schema copy).

## Verified
`checkProviderPolicy('printful', …)` — 9/9 example cases: flags / tasteful nudity / "Trump + guns like Terminator" → allow; porn / hate / terror / self-harm → block; Disney / cocaine → warn.
