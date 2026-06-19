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
- **Fulfillment:** only **published** (already-screened) products can be ordered, so the publish gate transitively protects fulfillment. For defense-in-depth against *legacy* products published before the gate, `submitOrderToPrintful` (`platform-api/lib/fulfill.ts`) can call the same `checkProviderPolicy` — this needs a `pod-policy.ts` copy in `platform-api` (like the schema copy). **Not yet wired** — tracked as a follow-up.

## Verified
`checkProviderPolicy('printful', …)` — 9/9 example cases: flags / tasteful nudity / "Trump + guns like Terminator" → allow; porn / hate / terror / self-harm → block; Disney / cocaine → warn.
