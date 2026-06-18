# App Store — submission package (paste-ready)

Everything to submit **Nano Crew** (`com.nanocrew.app`, ASC app id `6780275901`) for App Store
review. Build **#19 (1.0.0)** is uploaded via EAS auto-submit. The **[YOU]** steps happen in App
Store Connect; the copy/answers below are ready to paste. Mirrors `PLAY_STORE.md`.

## 0. Status / prereqs
- ✅ Binary in ASC (build 19, processing → TestFlight).
- ✅ IAP configured (server verification live on Railway; StoreKit 2 in the binary; products
  `READY_TO_SUBMIT`). **Attach the IAP products to this version** when submitting (first review
  covers app + IAP together).
- ✅ Privacy Policy live: `https://nanocrew-api.vercel.app/privacy` · Terms: `/terms`.
- App icon already in the binary (regenerated NC mark).

## 1. App information
- **Name:** `Nano Crew`
- **Subtitle (≤30):** `AI clothing-brand builder`
- **Privacy Policy URL:** `https://nanocrew-api.vercel.app/privacy`
- **Category:** Primary **Shopping**, Secondary **Business**
- **Support URL:** `https://nanocrew.app` (or a support page/email you prefer)
- **Marketing URL (optional):** `https://nanocrew.app`

## 2. Version metadata
**Promotional text (≤170):**
```
Talk to Venus, our AI, and turn a conversation into a real clothing brand — design products, open a shop, and sell the same day. Made on demand, shipped for you.
```
**Description:**
```
Nano Crew turns a conversation into a real clothing brand.

Talk to Venus, our AI brand consultant, and she designs your brand — name, voice, palette, and
look. Generate product graphics by prompt, drop them in your shop, and start selling the same day.
Every order is printed on demand and shipped for you, so you never touch inventory.

• Design with AI — create product graphics and on-model shots from a prompt.
• Sell instantly — your brand gets a shop in the Nano Crew marketplace, no website required.
• Go further — add your own storefront website and custom domain when you're ready.
• Edit by chatting — change your site's copy, colors, and layout in plain words.
• Fulfillment handled — print-on-demand and shipping are built in.
• Run it from your phone — design, post, and manage sales anywhere.

Speak your brand into existence.
```
**Keywords (≤100 chars, comma-separated, no spaces after commas):**
```
clothing brand,AI design,print on demand,merch,streetwear,sell shirts,store builder,dropshipping,apparel,POD
```
**What's New (build 19):**
```
A refreshed look with our new brand mark, smoother brand creation, and a new bold "street" storefront style.
```

## 3. Screenshots (you supply; [CLAUDE] can capture from the web build / simulator)
Required: **6.7"** (1290×2796). Optional but recommended: **6.5"** (1242×2688). No iPad set unless
you mark iPad support. Suggested shots from build 19:
1. Studio — the "Meet Venus" welcome (new NC logo).
2. Venus interview / "BRAND COMPILED" palette screen.
3. A live brand storefront (e.g. the street template hero).
4. Market / in-app shop.
5. Design tab — AI product canvas.
A **1024×1024 app icon** is taken from the binary; no separate upload needed.

## 4. App Privacy (nutrition labels) — answers
Collects data? **Yes.** Encrypted in transit? **Yes.** Users can request deletion? **Yes** (Account →
Delete account). For each type below: collected, **not** used for tracking, **not** shared with data
brokers; purpose = App Functionality / Account Management.
- **Contact Info:** Email Address, Name.
- **Financial Info:** Purchase History. *(Card data handled by Stripe/Apple — not collected by us.)*
- **User Content:** Photos — try-on selfies are sent to the AI to render a preview and **not stored**;
  product/brand images the creator makes.
- **Identifiers:** User ID (account), Device ID (push notifications).
- **Usage Data:** Product Interaction (feature/product taps).
- **Diagnostics:** Crash/Performance (basic).

## 5. Age rating questionnaire → result **4+**
Answer **None / No** to all: violence, sexual content, profanity, drugs/alcohol, gambling, horror,
mature themes, contests. Unrestricted web access: **No**. User-generated content: the app shows
catalogue + creator-authored brand content (moderated, no open social feed in v1) — answer the UGC
questions as "infrequent/mild" if prompted; expected rating **4+**.

## 6. App Review Information (the #1 thing that trips first reviews)
The app **requires sign-in**, so reviewers need a working account that can see the full flow without
paying. **[YOU] before submitting:**
1. Create a reviewer account (e.g. `appreview@nanocrew.dev`) by signing up in the app.
2. Add that email to `COMP_EMAILS` on Railway → it gets top-tier entitlements (no paywall, no real
   charges) so the reviewer can create a brand + see a website end-to-end. *(I can confirm it's comp
   once you add it.)*
3. Put the credentials in **App Review Information → Sign-In required → username/password**.

**Review notes (paste):**
```
Nano Crew lets a creator build a clothing brand with an AI assistant (Venus), then sell via
print-on-demand. Demo account is comped (no charge) so you can explore the full flow.

To try it: open Studio → "Build a new brand" → tap the keyboard icon to type answers to Venus →
after the brand compiles, tap "Create my store".

In-App Purchases: subscription plans (Starter/Pro/Advanced) and credit packs are digital goods sold
via StoreKit 2 IAP. Physical merchandise (shirts, etc.) is shipped goods and checks out via Stripe,
per guideline 3.1.3(e) (physical goods may use other payment methods).

Contact: <your email/phone>.
```
- **Contact info:** your name, phone, email.

## 7. Export compliance
`ITSAppUsesNonExemptEncryption = false` is already set in `app.json`, so ASC won't prompt for an
encryption declaration. (We only use standard HTTPS.)

## 8. Submit
ASC → the app → **(+) Version or Platform → 1.0.0** → fill §1–§7 → under **Build**, select **build 19**
→ attach the **In-App Purchases** to the version → **Add for Review → Submit**. First review typically
1–3 days.

## Note on payments (guideline 3.1)
- **Digital goods (plans + credits)** → must use **IAP** ✅ (wired).
- **Physical goods (apparel)** → may use **Stripe** ✅ (3.1.3(e)). Storefront commerce is still on a
  **test** Stripe key — flip `STRIPE_SECRET_KEY` to live before real launch (not an approval blocker;
  reviewers won't buy a shirt). See `PRODUCTION_CHECKLIST.md`.
