# Google Play — first-time launch playbook

Everything to ship Nano Crew (`com.nanocrew.app`) to Google Play. Code/build/assets are driven by
Claude; the **[YOU]** steps are inside your Google account (account, payment, agreements, final
submit) and only you can do them. Paste the prepared copy/answers straight into the Console.

## 0. Prereqs
- **No Firebase needed** for v1 — that's only Android push; we ship without push on Android.
- App icon (512): `assets/brand/play-store-icon-512.png` (ready).
- Privacy policy: `https://nanocrew-api.vercel.app/privacy` (live).

## 1. [YOU] Create the Play Console account
[play.google.com/console](https://play.google.com/console) → sign in with the owning Google account
→ **Create account** (Personal) → pay the **$25 one-time** fee → complete **identity verification**
(name, address, phone; possibly a photo ID). Approval can take a few hours to ~2 days — **start this
first**; you can build the listing while it's pending but can't publish until verified.

## 2. [YOU] Create the app
Console → **Create app**: Name `Nano Crew` · Default language `English (United States)` · **App** ·
**Free** · accept the declarations. Category (in store listing): **Shopping**.

## 3. The "Set up your app" checklist (Console gates release behind these)
Fill these under **Policy and programs → App content** + **Store listing**:

- **Privacy policy:** `https://nanocrew-api.vercel.app/privacy`
- **App access:** "All functionality is available without special access" is FALSE — it needs a
  login. Provide a **test login** (a demo Nano Crew account email + password) so reviewers can get in.
- **Ads:** No (the app shows no third-party ads).
- **Content rating:** start the questionnaire → category **Utility/Other or Shopping** → answer **No**
  to violence/sexual/profanity/drugs/gambling → result will be **Everyone / PEGI 3**.
- **Target audience:** 18+ (creators running a business) — avoids child-privacy obligations.
- **Data safety:** see §4.
- **Government apps / Financial features:** No / No (we sell apparel; payments via Stripe — not a
  financial product).

## 4. Data safety answers (maps to the privacy policy)
Does the app collect or share user data? **Yes, collect.** Encrypted in transit? **Yes.** Can users
request deletion? **Yes** (Account → Delete account). Declare these data types, all "collected, not
shared with third parties for ads," purpose = App functionality / Account management:
- **Personal info:** Email, Name.
- **Financial info:** Purchase history. (Card data is handled by Stripe — not collected by the app.)
- **Photos:** "User photos" — try-on selfies are sent to the AI to render a preview and **not
  stored**; disclose as collected for app functionality, ephemeral.
- **App activity:** product/feature interactions.
- **Device/other IDs:** for notifications (iOS) / basic diagnostics.

## 5. Store listing copy (paste these)
**App name:** `Nano Crew`
**Short description (≤80):**
`Build a clothing brand with AI — design products, sell, and ship from your phone.`
**Full description:**
```
Nano Crew turns a conversation into a real clothing brand.

Talk to Venus, our AI, and she designs your brand — name, voice, and look. Generate products by
prompt, drop them in your shop, and start selling the same day. Every order is printed on demand
and shipped for you, so you never touch inventory.

• Design with AI — create product graphics and on-model shots from a prompt.
• Sell instantly — your brand gets a shop in the Nano Crew marketplace, no website required.
• Go further — add your own storefront website and custom domain when you're ready.
• Fulfillment handled — print-on-demand and shipping are built in.
• Run it from your phone — design, post, and manage sales anywhere.

Speak your brand into existence.
```
**Graphics needed (you supply):** at least **2 phone screenshots** (use the new build's Studio +
Market screens) and a **1024×500 feature graphic**. Icon (512) is ready in `assets/brand/`.

## 6. Upload the build → Internal testing (fastest first ship)
Console → **Testing → Internal testing → Create new release**.
- **App signing:** accept **Play App Signing** (Google-managed) — recommended.
- **Upload the `.aab`** Claude provides (the EAS Android build artifact).
- Release name/notes → **Save → Review release → Start rollout to Internal testing**.
- **Testers:** add your email under Internal testing → Testers → install via the opt-in link.

## 7. Submit config (Claude drives, once the app exists)
For automated future submits: Console → **Setup → API access** → create/link a Google Cloud
**service account** → grant **Release manager** → download its JSON key → Claude wires
`eas.json submit.android.serviceAccountKeyPath`, then `eas submit -p android`. (First release can be
a manual `.aab` upload instead — simpler.)

## What Claude has ready
- The `.aab` (EAS build), the 512 icon, the privacy URL, all the copy + answers above. As you reach
  each Console step, Claude fills/explains it.
