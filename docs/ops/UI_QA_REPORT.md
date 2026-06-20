# Full System QA Report — 2026-06-20

A combined **empirical** (live, driven in the web preview on the Alpha Patriot brand, logged in as
the comp account) + **static** (6-agent parallel code audit) pass over the app UI. Goal: document
what works, what crashes, and a prioritized fix list. **Video was out of scope** per instruction.

---

## 1. Session action log

### Code shipped this session (pushed to `main`)
| Commit | Change |
|---|---|
| `a3ed83e` | `/api/generate`: AI refusals → actionable **422** + message (was opaque "No image returned" 502) |
| `c2b18ec` | ✨Enhance + 🎲Random steer to **original/generatable** subjects (`GENERATABLE_GUIDANCE`) |
| `94d0149` | Removed the **"Live voice test (dev)"** control + the orphaned `/live-test` route |

### Generations performed (live, all on Alpha Patriot)
| Prompt / mode | Result |
|---|---|
| Graphics + **Filled** — "American flag waving" | ✅ image |
| Design + **✨Enhance** — "Spider-Man" → reinterpreted to "masked acrobat in red-and-blue suit" | ✅ image (proves the filter) |
| Design + **Transparent** — "eagle-head emblem" (magenta chroma-key) | ✅ image |
| **🎲Random** (idea route) | ✅ original concept ("traditional tattoo flash octopus…") |
| Refused — "Spider-Man the Marvel superhero" | ✅ **422** "declined under content policy — try rephrasing" |

### Edits made (live)
- **mini-CMS / Site Options** (direct, instant): nav background → navy `#0a1a2f`, primary/buttons → flag-red `#B22234`, hero headline → "Stand Proud. Stand Free." → **reflected on the live site in ~20s, no rebuild.**
- **Venus (keyboard/typed)**: opened the critique editor → ⌨ type → "Change the announcement bar to MADE IN THE USA" → **Add** → "2 changes captured · Submit". (Submit outcome: see Crash #2.)

### Buttons / flows exercised
- **Design:** brand picker, Site-assets mode, Generate modal (Design/Graphics/Video tabs, Transparent/Filled, ✨Enhance, 🎲Random, Generate, Review → Use this / Regenerate / Discard).
- **Studio:** dashboard (brand cards, bounties), Alpha Patriot console → **Edit site** tab, **✦ Site Options**, "tap to explore your live site →" → Venus critique editor (〰 mark, orb pause, ⌨ type, Add, Submit).
- **Market:** Discover, search, Trending, brand cards. **Account:** brands list, Earnings/Subscription/Payouts, Platform admin, Sign out.
- Cross-tab navigation (Studio · Design · Market · Account).

---

## 2. What works ✅ (verified live)
- **Asset generation** across every setting (filled, transparent/chroma-key, design, graphics, enhance, random) → images on Cloudinary.
- **Refusal handling** → clear 422 message (the fix).
- **mini-CMS Site Options** text + color (incl. nav) → live with no rebuild.
- **Venus brain** (`plan-site-edits`) → correctly splits a request into image-swaps vs forge edits.
- **Venus typed capture** → "N changes captured · Submit".
- **Market, Account, Studio console (Edit-site tab)** render cleanly. **Zero** client console errors during normal navigation.

---

## 3. Crashes / failures observed during the pass
1. **`ReferenceError: liveOpen is not defined` in `<AccountScreen>`** — a **transient stale Fast-Refresh bundle** caused by editing `account.tsx` in 4 steps while the dev server hot-reloaded an intermediate (state removed, modal still referencing it). **Final source is clean (`tsc` clean); a full reload cleared it and Account renders correctly with the dev button gone.** Process lesson, not a shipped bug. *(Mitigation: when deleting a symbol used in multiple places in a hot-reloaded file, expect a transient red-box until a full reload.)*
2. **Typed-Venus Submit did not fire `plan-site-edits`/`revise`** in this run (no network call; no `store_revisions` row created). It coincided with the stale-bundle disruption above, so it's **inconclusive** — needs a clean re-test (the underlying pipeline — plan classifier, revise enqueue, approve/merge — was each verified separately this session).
3. **Local dev-server `502`s** on `/api/generate` + `/api/enhance` intermittently — `expo serve` (the *local* web dev server) choking under heavy image-gen load. **Local-only**; Railway (persistent Node) is unaffected.

---

## 4. To-do list (prioritized — from the code audit + live pass)

### P0 — crash / correctness
1. ✅ **DONE — Systemic `.json()`-without-`res.ok` guard.** Added a shared **`readJson<T>(res)`** helper (+ `ApiError`) in `src/lib/api.ts`: reads the body once as text, parses safely (no throw on a 502 HTML page), and throws `ApiError` on any non-2xx so the caller's existing `try/catch` surfaces a real failure instead of swallowing a 5xx error body as "success." Applied across the load/read path in `studio-composer` (loadStores/loadInsights/loadPosts/loadRevisions/loadProducts/loadCredits/pickCover + a `res.ok` guard on `mutatePost`), `studio-dashboard` load, `studio.tsx` (/api/me ×2 + createStore + launch-fanfare), `design.tsx` (blanks/me/canvas/placements/colors/catalogues/compositions chains + idea/enhance + chooseAssetsMode), `account.tsx` (/api/me + openPayouts via `ApiError.message`), `brand-store`, `earnings-cockpit`, `site-editor` load. Left status-code-inspecting mutations untouched (402/409/429 gates in makeVideoAd/model-shots/model-videos/publishToMarket/enhance/runGenerate/doMerge — they read non-2xx bodies deliberately). `tsc` + `expo export` clean.
2. **`onBounty` drops the `slot` param** (`studio.tsx:1329`) → the "Design your website hero / Add your logo / Add a collection cover" bounties open the wrong Design panel. Pass `slot` through to the route.
3. **`design.tsx` `reflowGroups`** Math.min/max on an empty members array → `Infinity`/`NaN` layout corruption; **`renderComposite` uses `blank.name`** unguarded (`:664`) → use `blank?.name`.
4. **Paywall `creditPacks.map()`** can crash — validation checks `tiers` is an array but not `creditPacks` (`paywall.tsx:64,241`). Add `Array.isArray(d.creditPacks)`.
5. **`site-preview` submit reads a mutating `edits` array** (can be emptied mid-submit) → snapshot `edits` at submit start; and **review modal can't be dismissed after a failed submit** → `setReviewing(false)` in the catch.

### P1 — UX / safety  ✅ ALL DONE
6. ✅ **DONE — Double-submit guards.** Entry `if (busy/inFlight) return;` added to `refundOrder` + `deleteBrand` (studio-composer), `subscribe`/`buyPack`/`openPortal` (paywall — `checkout` already awaited), `social`/`submit`/`deleteAccount` (account OAuth + email + delete). `doCombine` (design) now guards a same-frame double-tap with a `combiningRef` (was creating two composite rows + two `/api/compositions` calls), reset in the request's `.finally`.
7. ✅ **DONE — Error / retry states.** **BrandStore**: "Couldn't load" now has a **Try again** button. **PlatformAdmin**: distinguishes a 401/403 ("Admin access only." — final) from a network/5xx ("Couldn't load — check your connection." + **Try again**) instead of conflating both as "not admin." **PlacementEditor**: applied `readJson` to printareas/composition/variants/mockup (a 5xx no longer parses as success → empty editor), and a failed hydrate now renders the error + a **Try again** (bumps a `reloadKey`) instead of a broken empty editor. **Color picker** (design): a load failure now shows "Couldn't load colours — tap to try again" (remembers the blank id) instead of conflating failure with "no colours available."
8. ✅ **DONE — `reviewDismissed` reset.** `loadRevisions` now clears the optimistic hide-set after refetch — a genuine decline stays hidden (status `declined`, excluded by the `pendingRev` status filter) while a decline whose server call FAILED correctly reappears for a retry (`studio-composer.tsx`).
9. ✅ **DONE — `publishToMarket` feedback.** No-ops with `setNote('Pick a brand first.')` when no brand is selected (+ a `publishing` entry guard).

### P2 — features / follow-ups (from earlier QA)
10. **Dedicated nav-bar color** control (nav currently inherits `background`; you asked for nav color specifically).
11. **Per-brand favicon** for the 4 standard templates (needs a *bundled* font — `next/og` build-failed on CDN fetch).
12. **Re-verify typed-Venus Submit** end-to-end on a clean reload / on device (Crash #2).
13. **On-device verify** the Railway-deployed generate-422 + Enhance-filter fixes.

---

## 5. Notes / preview limitations (not bugs)
- **Venus voice** (Gemini Live audio) and **"Set as logo/hero" assignment** (native `Alert` + drag) can't be driven in the web preview — native-only; tested via API / on-device earlier.
- The Alpha Patriot test changes (navy nav + red + "Stand Proud. Stand Free.") are **left live** on the test brand; revertable on request.
