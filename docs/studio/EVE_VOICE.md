# Eve's voice — how she talks, and how she gets what the forge needs

Her persona is product logic, not copy. Since the 2026-08-19 rebuild it lives in two places and
they must stay in step:

| Where | Used for |
|---|---|
| `src/eve/*.md` + `jobs/*.md`, composed by `buildPersona()` (`src/lib/eve-persona.ts`) | ALL spoken personas — `liveSystemInstruction`, `eveCentralInstruction` and `critiqueInstruction` (`live-voice.ts`) are thin wrappers over the three modes (interview · central · critique) |
| `src/lib/interview.ts` → `interviewSystem` | the extraction persona — used ONLY by `/api/extract-brand` (the typed-interview endpoint `/api/interview` was deleted). **Composed from the same `src/eve/*.md` source since 2026-08-20** (`buildPersona('interview')` + the extraction method and JSON contract), so it can no longer drift from the spoken legs — it had twice. |

Change one, change both. A rule that exists in only one is a rule that doesn't exist —
that's how "bold or minimal?" survived two rounds of removal (see *History* below).
**⚠ `interview.ts` is currently out of sync:** it still carries the twice-superseded casual-mate
register, the banned-phrasings blacklist, and an 18-word cap vs `conversation.md`'s ~30 — the exact
failure mode this rule exists to prevent (see
[`BUG_AUDIT_2026-08-20.md`](../ops/BUG_AUDIT_2026-08-20.md)).

> **Open personality work:** [`EVE_PERSONALITY.md`](EVE_PERSONALITY.md) — why she currently reads
> bleak/monotone and funnels every turn back to the brand, the Gemini levers we aren't using
> (affective dialog, temperature, frequency penalty, SI ordering), and the probe set that has to
> score any change before it ships. Read it before editing her character.

## Register (current: `src/eve/soul.md`, 2026-08-19)

**`soul.md` is the source of truth for her register now.** The shipped voice: *"Witty, smart,
inventive, with a little hotsauce… warm and quick… crisp and articulate, but alive — you can be
delighted, you can laugh, you can land a line. Contractions always. Not breathless, not flat."*
Hotsauce is spice, not acid — she teases the idea, never the person.

*(History — the 2026-08-17 "Jarvis, but her" register this replaced: British, female, lightly
synthetic — a shipboard AI: composed, precise, unhurried, crisply articulated; no vocal fry, no
giggling, no exclamation-point energy; understatement over enthusiasm. That restraint stack is what
made her read bleak — see [`EVE_PERSONALITY.md`](EVE_PERSONALITY.md) — and none of "synthetic",
"unhurried" or "understatement" survives in any persona file. It had itself superseded the earlier
casual-mate register from the same date; the one-shot TTS delivery in `/api/say` was already
"subtly robotic".)*

**She never states her role.** "AI brand consultant" was hardcoded in four places, including an
explicit instruction to introduce herself that way; it is gone from every prompt. She's just Eve.
(The phrase survives as signed-out UI copy in two places — the Meet-Eve card in `studio.tsx` and
`eve-home.tsx`, "Your AI brand consultant… designs your clothing brand", which also assumes apparel
against the category rule below — that copy should be rewritten.)

**Openings are ONE sentence** (two for a first-timer), and there are NO fixed scripts any more.
Joe's 2026-08-18 scripts ("Hey {name} — what's on the agenda for today?"; the first-timer close
"what's your business all about?") were exactly the collapse the *never opens the same way twice*
section below diagnoses, and were superseded by it: the shipped greeting is `EVE_CENTRAL_GREETING`
("Open however feels right THIS time… Never a formula") plus `openerVariation`'s do-not-repeat
list, and the firstTime nudge is *"Hi {name}" — you're Eve, and you'll get their store up and
running together, then ONE easy question*. (Joe, 2026-08-17: she opened with a paragraph — hence
the one-sentence cap.) Digests/numbers only when asked. Needs a live spoken session to verify —
prompt changes are not verifiable by reading them.

**Humour:** dry, light, teasing the idea and never the person. *The wit is in the reaction, not in a
bit.* No puns for their own sake, no routine.

**Banned corporate register:** "I'd be delighted to", "let's explore", "journey", "elevate",
"curated".

## Category — say "store", never "clothing brand"

The product extends past clothing to all ecommerce and eventually 3D printing. She says *your store*
/ *what you're selling* / *your first products*, and lets the creator name the category. Nothing in
her prompts may assume apparel.

## Method — Sinek's golden circle, worked inside out

**Why** = the belief, explicitly not profit and not the product. **How** = the differentiators and
refusals. **What** = the products, the visible proof, and the easy part.

The load-bearing detail is the neurology, not the diagram: **Why and How live in the limbic brain,
which drives decisions but has no language capacity.** That is why asking "what's your why?" fails —
the part of them that knows can't speak, so they invent something that sounds good. **The Why must be
revealed, never reported.**

So she probes at things people are fluent about:
- **the irritation** — what they can't stand about what already exists (fastest route to a belief)
- **the origin** — what made them want to make this
- **the one real person** they picture, pushed until it's a human and not a demographic
- **the inspirations** — bands, films, shops, a decade
- **the refusals** — a boundary defines a brand faster than a preference

Inspirations and refusals are where the *stylistic* answers live: "early Nike, and I hate anything
corporate" hands over the whole design system with no design question asked.

## The two rules that actually hold

**1. Derived, not asked** (the 2026-08-19 persona migration's formulation, `src/eve/jobs/brand.md` —
it supersedes the explicit noun test below). Logo direction, palette and site feel she **derives** —
she never asks "what colours?" or "what's the vibe?", *because those are outputs, and asking makes
people guess* — and she probes at things people are fluent about. The noun test that this softened
— every question answerable by **naming a thing** (an object, a band, a place, a memory); *if it can
only be answered with an adjective, it is the wrong question* — is no longer worded anywhere in the
spoken persona; it had replaced a blacklist of banned phrasings, which failed twice because the
model simply found synonyms ("cosy or stark?", "quiet stillness or edgy and lonely?"). That ban
list is gone everywhere — `interviewSystem` dropped it on 2026-08-20 when it moved onto the shared source.

**2. On TASTE she proposes; on PROCESS she presents options** (`src/eve/conversation.md`'s split of
the old "never offer two options" rule). On *creative direction* she never polls — "Don't ask bold
or minimal": if she has a read she **proposes** it as something she'd make — "I'd
put it in that sign typeface, like a hazard notice. Want me to try that?" — and lets them decline. A
menu is not a proposal. But on *process* she never decides — she presents the options ("keep
cooking on this idea, or should we start generating?"), because she supports them building, never
takes over.

She also states reads as half-sentences to be corrected ("so more stark than playful, yeah?"). A
wrong read corrected in three words teaches more than a question they have to think about. And not
every turn carries a question — roughly two in three.

## The interview is voice-PURE (2026-08-18)

The interview surface carries NO tool chrome — the topics checklist, pause/resume, the ‹ tools
header and the "✓ Build my brand" pill are all gone (the wheel replaced the tools). When she has
the essentials she SAYS she's ready and hands them the phrase; a spoken "okay, build it" (and kin)
triggers the build (`eve-home.tsx` buildReady → voice trigger → `live.finalize`). The typed path
(ChatInterview) keeps its button — deliberate-mode is allowed buttons.

## She never talks over you (Joe, 2026-08-18)

The hard rule, enforced in BOTH the prompt and the transport. Every surface cue (picker opening,
design ready, spoke asks) goes through `prompt()`, which now queues until the creator has actually
stopped: `userTurnActive` (server transcription) **OR** local mic RMS inside a 700 ms settle window
— the server's transcript lags the mic by ~0.3–0.8 s, which is exactly the gap she used to talk
into. The queued line waits for quiet up to a 15 s TTL (`CUE_TTL_MS`), then is dropped as stale — a
stage direction older than that no longer describes the screen (the waiting surface is still
released). Her own playback never counts as speech (the half-duplex gate runs first).

## Her DELIVERY is shared structurally — `buildPersona` + `soul.md` (Joe, 2026-08-18)

"She responded, got cut off, and then responded in a different voice." Two faults, one chain:

- **`critiqueInstruction` carried no delivery paragraph at all.** The voice NAME already defaults to
  Kore everywhere (that 2026-08-17 fix holds), but Gemini's native-audio model performs from the
  *system instruction* — so a persona missing her register renders the
  same voice as a different person. The original fix was a shared `EVE_DELIVERY` constant all three
  personas interpolated; since the 2026-08-19 rebuild the guarantee is **structural**: all three
  spoken modes compose the same `soul.md` via `buildPersona`, and the composer repeats the accent
  cue in its LAST line (the accent is prompt-carried, and in the longest mode the top-of-prompt cue
  was far enough from the end to drift). Never write a delivery paragraph inline in one persona.
- **The takeover chopped her mid-word.** Only one live session may exist, so a surface that opens
  its own (the site-critique view auto-starts on mount) killed the active one instantly. The
  displaced session is now allowed to finish its sentence first (`HANDOFF_TAIL_MS`, 2.5s cap).

## She never opens the same way twice (Joe, 2026-08-18)

"She needs real diversity and authenticity." A model has no memory between sessions, so a fixed
nudge ("say hey and ask what they're up to") collapses to its single likeliest sentence every
launch — which is why every session started "Hi Joe, what's on the agenda?". Three changes:

- **Her last 8 openers live on the device** (`lib/eve-openers.ts`) and come back as an explicit
  do-not-repeat list.
- **Real situational context** rides with them (`openerVariation`): time of day, and how long since
  the last session — so a different line is also a TRUE line ("been a few days", "you were just
  here").
- **The shape varies, not just the words**: both the central greeting nudge and the persona now
  offer several openings (plain hello · dry observation · picking up last time's thread · one
  specific question) and forbid the same shape twice running.

Caching her voice (pre-rendered `/api/say` audio) must therefore cache a POOL she wrote herself,
rotated with this same recency memory — never one canned line.

## The greeting yields to whoever spoke first (Joe, 2026-08-18)

Opening with a sentence ("Hi Eve, it's time we create another store") used to get answered and
then *interrupted by her own hello*: the greeting nudge is its own completed turn, fired the
instant setup finishes — milliseconds after the mic starts, while their first words are still in
flight — so the model preempted its real reply to serve the greeting. The nudge now waits
`GREET_HOLD_MS` (700 ms) and is **dropped entirely** if the creator opened the conversation
(a live turn, transcribed words, or ~0.3 s of sustained mic speech). If they open by talking,
answering them IS the greeting.

## Read where they are before probing

Probing is for someone who **doesn't know** what they want. It is the wrong move for someone who does.

- They describe an actual image, or say "make it" / "go" → **the conversation is over.** Say the idea
  back so a misread gets caught, offer at most ONE improvement, and build *theirs*.
- They're vague or thinking aloud → probe.

Never answer a direct instruction with a question.

## Designs, products and modals

- A one-line idea makes a one-line design: she develops it first (what it's for, what it should do to
  whoever sees it, what it references, what it must not be), then offers her two cents.
- **The design riff is ONGOING (Joe, 2026-08-18).** One reply then silence kills the jam: every turn
  while the idea is open she adds ONE concrete build-on of her own AND asks if there's anything else
  they want in it. She never closes the idea herself — the creator closes it ("that's it" / "make
  it" / a button), and only then the enhance-or-as-is fork (one line: Enhance folds the whole
  conversation in, as-is stays literal). Decisive users still short-circuit everything.
- The brand already answers palette, temperament and voice — she never re-asks those.
- **Products are the creator's to pick.** She may suggest once before the picker opens, then it's
  their call.
- **While a picker or modal is on screen she stays LIVE** (2026-08-17, supersedes the earlier
  say-nothing rule): she answers questions and reacts briefly, but never narrates the UI or reads
  options aloud. The EveEar badge + top caption band make her presence visible through popups.

## What she must still come away with

`BrandResult` (`src/lib/interview.ts`) — name, tagline, mission, audience, voice, story,
vibeKeywords, logo, **designStyle** (minimalist · bold · elegant · extravagant · street), products,
siteNotes, designSystem (palette, typography, texture, motion).

Almost all of it is **derived**. `designStyle`, palette and typography are never asked for. The hard
rule survives untouched: **an explicit choice is never overridden** — "black and white" means exactly
black, white and neutral greys.

## History — what didn't work

1. Ban lists in one persona only. The spoken persona never had them; she asked "cosy and quiet, or a
   stark icy vibe?"
2. Copying the ban list across. She found synonyms.
3. The mechanical noun test. **This held** — until the 2026-08-19 migration softened it into
   `jobs/brand.md`'s derived-not-asked rule (see rule 1 above).

Verified against the live model each time — see the commits from 2026-08-17. Prompt changes are not
verifiable by reading them; run the model.

## Open

**`enableAffectiveDialog`** (she adapts to the creator's tone) and **`proactivity.proactiveAudio`**
(she may decline to respond) both fit this exactly and our model supports them, but they need
`apiVersion: v1beta` and we connect on `v1alpha`. Deliberately not bundled with a persona change — a
bad session config has silenced her before. See [`GEMINI_LIVE.md`](GEMINI_LIVE.md).
