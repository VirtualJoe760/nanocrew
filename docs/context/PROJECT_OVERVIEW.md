# Project Overview

## What it is
**Nano Crew** is AI-native creator commerce (Expo / React Native, iOS + Android). A creator talks to
**Eve** — a voice or typed AI brand consultant — to define a clothing brand. Nano Crew then
auto-generates a Printful-backed shop **and** a per-brand storefront website, and lets the creator
design products, post, sell, and edit their site by chatting. It's built on the proven
`stephen-lawyer` create → design → Printful loop.

## Who it's for
Social / YouTube creators who want to launch a brand without a designer, a developer, or a Shopify
build. The wedge is **all-in-one**: an AI voice product-generator + an instant site builder, behind
one Supabase identity.

## The core user flow
1. **Talk to Eve** (Studio tab) → she interviews the creator and authors a build brief.
2. **Build** → a conditioned forge robot turns a template into a presentable brand site (instant).
3. **Design** (Design tab) → the AI designer generates products/logos/model-shots → publish to Printful.
4. **Refine** → the design generator swaps the forge's placeholders for real assets; edit the site by chatting.
5. **Publish** → list in the in-app **Market** + on `nanocrew.app/b/<slug>` (active plan + a published product).
6. **Go live** → a custom domain / dedicated website is a separate Pro upgrade.

How the pieces fit: [`../architecture/ARCHITECTURE.md`](../architecture/ARCHITECTURE.md). The build →
refine → publish arc: [`../studio/BUILD_FLOW.md`](../studio/BUILD_FLOW.md).

## Status
The app lands on **Studio**; the social feed is hidden for v1 (preserved at `/feed`, returns in v2),
so the tab bar is **Studio · Design · Market · Account**. Live on TestFlight (iPhone-only), submitted
to the App Store; Android in Play internal testing. Granular shipped-vs-open status is the
progress-tracker: [`../roadmap/REMAINING_FEATURES.md`](../roadmap/REMAINING_FEATURES.md).

## Scope — what we're focused on (the anti-creep guardrail)
"Out of scope" here means **not the current focus**, not abandoned. Three buckets:

| Bucket | Meaning | Items |
|---|---|---|
| **🟢 In flight** | Active focus now | App Store + Play launch and owner-config gates (Stripe live, Connect, domains, `PRINTFUL_CONFIRM_ORDERS`) · the **context system** (this layer) · the **UI component system** (reuse refactor) · the **forge build-quality** epic (robot eyes + a real quality gate) |
| **🟡 Deferred backlog** | Will build, just later | The **affiliate / referral program** · **manufacturer-connect** (POD-provider onboarding) |
| **⚪ Parked / not now** | Not building this pass | **Social feed v2** (built, hidden at `/feed`) · **native Metal-shader avatar port** · **new sales channels** (e.g. TikTok Shop) |

Don't start work in the deferred or parked buckets without an explicit go — surface it and ask
instead. Anything can move back to **in flight** the moment Joe says so.
