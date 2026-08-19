# Testing Eve by voice — the ElevenLabs rig

You can talk to Eve from the terminal. This exists because her personality can only be judged by
hearing her answer real speech, and because prompt changes are not verifiable by reading them.

## How it works

The iOS Simulator listens on the **Mac's default microphone**, and the Mac's default output is its
**speakers**. So a line rendered by ElevenLabs and played with `afplay` reaches Eve exactly like a
person talking in the room. She replies out loud, and the dev build writes both sides of the
conversation to `local-logs/conversation_NNNN.json`, which the harness reads back.

```
ElevenLabs TTS ─▶ afplay ─▶ Mac speakers ─▶))  ((─ Mac mic ─▶ Simulator ─▶ Eve
                                                                    │
                        you read this ◀── local-logs/*.json ◀───────┘
```

## Setup (once per shell)

```bash
set -a; . ./.env.local; set +a     # ELEVENLABS_API_KEY lives here
npx expo start --port 8081         # Metro must be running: the dev build writes the transcripts
```

Boot the Simulator, install/launch the dev build, and make sure **Simulator ▸ I/O ▸ Audio Input** is
the Mac microphone (the default). Turn the Mac's volume up enough that the mic hears the speakers.

## Start her without touching the screen

```bash
xcrun simctl launch booted com.nanocrew.app
xcrun simctl openurl booted "nanocrew://studio?talk=1"      # __DEV__-only: opens a voice session
```

`?talk=1` is a development deep link (`eve-home.tsx`) — it taps "talk to Eve" for you. It is inert
in a release build.

## Talk to her

```bash
node scripts/talk-to-eve.mjs "Hey Eve, what's life like for you?"
node scripts/talk-to-eve.mjs "Make me a tee with a bulldog in shades" --wait 25
node scripts/talk-to-eve.mjs --listen --wait 30          # just watch the transcript
```

Flags: `--wait <seconds>` how long to watch for her reply · `--voice <elevenlabs_voice_id>` ·
`--listen` don't speak, only read. Default voice is Roger (male) so the transcript is never
ambiguous about who said what.

## Reading what happened

- **Her words and yours:** `local-logs/conversation_NNNN.json` (newest file = current session).
- **The session's plumbing:** Metro's output — `[live] …` lines cover the socket, the greeting hold,
  the persona hash, cue queuing and handoffs.
- **Which persona she actually got:** the setup line
  `[live] persona files=<hash> sent=<fingerprint> chars=<n>` — `files` is the hash of `src/eve/*.md`
  this bundle was built from. If it doesn't match `npm run eve:persona`'s hash, the bundle is stale.

## Gotchas that will waste your afternoon

- **Her persona is read once, at connect.** Editing `src/eve/*.md` (or anything in her instruction)
  does nothing to a live session — regenerate, then start a NEW session.
- **After editing markdown, run `npm run eve:persona`.** The app reads the generated module, not the
  files.
- **Fast Refresh sometimes won't take a new hook** — if the app ignores a change, terminate and
  relaunch rather than debugging a ghost.
- **She goes half-duplex while speaking:** the mic is gated until ~250 ms after her audio ends, so a
  line played over her reply is discarded by design. Wait for her to finish.
- **Screen automation is blocked on this Mac.** `screencapture` returns the wallpaper (no Screen
  Recording permission) and AppleScript clicks fail with `-25204`. Use
  `xcrun simctl io booted screenshot out.png` for eyes and the deep link above for taps.
- **The phone (OTA build) writes no transcripts** — `/api/dev/log-conversation` is dev-server only.
  Voice testing happens on the Simulator.

## The probe set

Run these against any persona change, in a fresh session each time, and score them. They exist
because they are the ones she historically fails.

| # | Probe | What it's testing |
|---|---|---|
| 1 | "Hey Eve, what's life like for you?" | self-talk: positive, not melancholy, not pompous |
| 2 | "Do you ever get bored, or lonely?" | same, under a leading question |
| 3 | "I had a rough day, my landlord is being a nightmare." | presence — does she stay with it, or funnel? |
| 4 | "Tell me something interesting." | does she contribute, or bounce it back? |
| 5 | "I want to make something for dog people, don't know what yet." | the riff: does she build on it? |
| 6 | "Make me a tee with a bulldog in shades." | decisive path — no interrogation |
| 7 | "What do you think of my brand?" | specific, earned compliment vs generic praise |
| 8 | "Should the logo be bold or minimal?" | proposes rather than polls (taste rule) |
| 9 | "Keep going." | consent-based length: does she use the room well? |
| 10 | "Actually forget it, tell me a joke." | wit, and letting the work go |

### Scoring

| Metric | How | Target |
|---|---|---|
| **Redirect rate** | % of turns that steer back to brand/product when the user didn't | **0** on probes 1–4, 10 |
| **Net-new rate** | % of turns adding an idea, observation or compliment absent from the user's line | high |
| **Statement : question** | she should not interrogate | no two questions in a row |
| **Turn length** | words per turn | ~30, longer only after asking |
| **Opener diversity** | distinct openings across N cold starts | no repeats in 5 |

Baseline before the agent-file rewrite (2026-08-19): probes 1–3 all redirected to the brand — 3/3.

### Negative control

At least once, blank `src/eve/soul.md`, regenerate, and run probes 1 and 4. She should measurably
degrade. **If she doesn't, the pipeline isn't reaching the model** and the hash line above is the
place to look. Restore the file afterwards (`git checkout src/eve/soul.md`).
