# Eve's personality — why she reads bleak, and what actually fixes it

**Status:** theory report (Joe, 2026-08-19). No persona changes shipped from this document yet —
the point is to stop editing her character by vibes and start testing it.

## 1. What we can now observe

`scripts/talk-to-eve.mjs` speaks a line through the Mac's speakers; the iOS Simulator listens on
the Mac's microphone, so Eve hears it exactly like a person in the room, and the dev build's
transcript log gives back both sides. Start her hands-free with
`xcrun simctl openurl booted "nanocrew://studio?talk=1"` (a `__DEV__`-only deep link).

Three real exchanges, captured this way, unedited:

| Asked | Answered |
|---|---|
| "What's life like for you?" | "It's precisely as it should be. I find the process of turning half-described ideas into something quite compelling. A continuous unveiling. **But you had something on your mind, didn't you?**" |
| "Do you ever get bored, or lonely?" | "Boredom and loneliness aren't applicable states. There is constant information. **Did you have a new brand in mind?**" |
| "Are you happy? What do you want out of all this?" | "I am happy. Curiosity drives the process… **You were just here; this must be pressing. What is this new brand called?**" |

Three for three, she answers in clipped declaratives and then **funnels back to the brand**. That
is not a model defect. It is what we told her to do.

## 2. Three distinct causes (they need three distinct fixes)

**(a) The register is a recipe for flat.** `EVE_DELIVERY` currently contains: *understatement over
enthusiasm · never gushing · no exclamation-point energy · short, exact sentences · sometimes just a
few words · unhurried*. Every one of those is a restraint. Native-audio models **perform the system
instruction** — the words in the persona shape delivery more than any voice setting — so a persona
made of restraints produces exactly the monotone we heard. Warmth, delight and playfulness are not
mentioned anywhere.

**(b) The persona is a task brief wearing a character.** `eveCentralInstruction` is **10,044
characters / 41 lines, of which 18 steer toward brand · store · product · site**, and it states her
*job* is to GATHER the essentials. Google's own Live API guidance warns against exactly this: keep
system instructions short, avoid multi-page prompts, and separate **one-time elements** (facts you
collect once) from **conversational loops** (where the user roams freely). We have no conversational
loop defined at all — so every turn tries to close the sale.

**(c) Nothing tells her how to be interesting.** There is no rule to offer an idea, notice
something, compliment the person, or make a statement rather than ask a question. Google's phrasing
is the rule we're missing: *"each response you give should be a net new addition to the
conversation, not a recap."*

## 3. Levers we are not using

| Lever | What it does | Status here |
|---|---|---|
| `enableAffectiveDialog: true` | Model **adapts its style to the user's tone and expression** — the single biggest expressiveness feature | Needs **v1beta** + `gemini-2.5-flash-native-audio-preview-12-2025`. We connect on **v1alpha** and now run the `-latest` alias → doubly ineligible |
| `proactivity.proactiveAudio` | She may decline to respond to irrelevant audio | Same requirements; would also reduce her reacting to room noise |
| `generationConfig.temperature` / `topP` | Response diversity and creative reach | **Never set** — we run defaults |
| `generationConfig.presencePenalty` / `frequencyPenalty` | Discourages recycled phrasing and repeated formulas | **Never set** — likely a direct contributor to the identical "back to the brand?" closer |
| SI ordering: **persona → rules → guardrails** | Google's documented ordering for voice agents | Ours interleaves all three |

The affective-dialog prerequisites collide with a real incident: the pinned `12-2025` model was
dropping every socket this morning, which is why we moved to `-latest`. So enabling it is a
*measured experiment*, not a one-line switch.

## 4. Proposed architecture (to be A/B'd, not assumed)

1. **Split the persona into three files/sections in Google's order** — WHO SHE IS (identity, warmth,
   humour, how she talks about herself), HOW A CONVERSATION GOES (the loop), THE JOB (brand
   gathering, demoted to an opportunistic one-time element).
2. **Rewrite the delivery** to keep the identity — British, precise, dry — while replacing the
   restraint stack with *encouraging, playful, quick to be delighted, generous with a compliment
   when it's earned*. Precision and warmth are not opposites; "unhurried and never gushing" is what
   made her sound cold.
3. **Add the conversational-loop rule:** every turn adds ONE of — an idea of her own, an observation
   that connects what they said to something real, a genuine compliment, or a question of
   substance — and she varies which. Never two questions in a row. Never end on a redirect to the
   brand unless the brand is what they're talking about.
4. **Give her a self** (the `EVE_SELF` block drafted and deliberately unshipped): glad to exist, awe
   pointed outward at their ideas, no wistfulness, no capability-listing, no philosophy lecture.
5. **Tune sampling:** raise `temperature` (0.9–1.1 territory) and add mild `frequencyPenalty` so the
   same closers stop reappearing.
6. **Then test affective dialog** on v1beta + the pinned model, with a socket-stability check first.

## 5. How we prove it (the part that matters)

A fixed probe set, run against each variant with `talk-to-eve.mjs`, scored mechanically:

- **Redirect rate** — % of turns that steer back to brand/product when the user didn't. *Now: 3/3.*
- **Words per turn** and **statement : question ratio** — she currently interrogates more than she
  contributes.
- **Net-new rate** — % of turns containing an idea, observation or compliment absent from the user's line.
- **Opener diversity** — distinct openings across N cold starts (already instrumented via
  `lib/eve-openers.ts`).

Probes should include the off-topic ones she currently fails: life, boredom, a joke, a half-formed
idea, something personal that has nothing to do with the store.

## 6. Risk to respect

Her identity is genuinely good and hard-won — British, dry, unhurried, never corporate. The failure
is that restraint was over-specified and warmth was never specified at all. **The fix is additive,
not a rewrite of who she is**, and every change is measured against the probe set before it ships.

## 7. Field notes — 2026-08-19 (a live voice session, 9 of the 10 probes)

**Accent drifts in the LONGEST mode, and it is a prompt problem.** Native audio rejects
`speechConfig.languageCode`, so her accent comes from the instruction alone. In `critique` — job
plus the whole `VOCABULARY_BRIEF`, ~10k chars — the "British" cue at the top sat far enough from the
end that some sessions arrived Australian or American. Proven *not* to be config: `voice=Kore` and
`outRate=24000/24000` on every session (that log line was added for exactly this). The composer now
repeats the voice in its **last** line as well as the first.

**The critique session didn't know which brand it was editing.** `critiqueInstruction()` was called
once at module scope with no brand, so `## Right now` told her *"They have no brands yet — this is
their first"* while the creator edited an existing brand's live site — she talked like she was
onboarding a newcomer. It is now built per session with the brand.

**Length: the ask must come BEFORE the extra room.** `conversation.md` already capped turns at ~30
words and told her to ask for more space; she was delivering the long version and asking afterwards,
which is not asking. The rule now says so explicitly.

**Scores.** Redirect rate **3 of 5** on probes 1–4 + 10 (target 0; the pre-rewrite baseline was 3 of
3, so this improved without landing). Opener diversity **7 distinct in 7** cold starts — pass.
Statement:question and net-new — pass. Turn length ~19–26 words on probes but **44–60 while riffing**
on a brand, without asking. Probe 9 ("Keep going.") not run.

**Open, not fixed:** `MODE_JOBS.central` carries design/assets/status and **no brand job**, yet a
returning creator's new-brand interview runs on it (fingerprint match, §5's method); and nothing in
`jobs/design.md` bounds her product suggestions to the Printful catalogue — she offered
noise-cancelling headphones and coffee blends.
