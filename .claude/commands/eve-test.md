---
description: Talk to Eve out loud through the ElevenLabs rig and report what actually happens — preflight, probes, scenarios, evidence.
argument-hint: [probes | s1 | s2 | s3 | s4 | "a thing to check"]
---

You are testing **Eve by voice** in the Nano Crew repo. Requested run: **$ARGUMENTS**
(no argument → preflight, then ask which run).

Her character can only be judged by hearing her answer real speech, and prompt changes are not
verifiable by reading them. So this is a loop: **speak → watch the wire → prove the cause → report**.

Read [`src/eve/testing/README.md`](../../src/eve/testing/README.md) (the rig, the ten probes, the
rubric), [`ui-driving.md`](../../src/eve/testing/ui-driving.md) (taps, deep links, screenshots) and
[`scenarios.md`](../../src/eve/testing/scenarios.md) (S1–S4). Don't restate them here — run them.

## 1. Preflight — never start on a stale bundle

```bash
lsof -nP -iTCP:8081 -sTCP:LISTEN                  # Metro up?
lsof -p <metro-pid> | awk '$4 ~ /^1w/ {print $9}' # ← WHERE ITS LOG IS. Metro's stdout is usually
                                                   #   redirected to a file, often another session's
                                                   #   scratchpad. Without this you are blind.
xcrun simctl list devices booted
xcrun simctl get_app_container booted com.nanocrew.app
npm run eve:persona -- --check                    # bundle vs src/eve/*.md
```

Then start a session and match the hash on the wire:

```
[live] persona files=<hash> sent=<fingerprint> chars=<n> voice=<name> outRate=<ctx>/<expected>
```

`files=` must equal `eve:persona --check`. If it doesn't, the bundle is stale — regenerate and
relaunch, or you are testing yesterday's character. `voice=`/`outRate=` settle any "she sounded
different" question before it becomes an argument.

Also confirm: `ELEVENLABS_API_KEY` loads (`set -a; . ./.env.local 2>/dev/null; set +a` — the file has
unquoted values, so suppress its noise), Mac output volume up, input = the Mac mic.

## 2. Rules of engagement

- **Never complete a purchase.** No checkout, no card, no real order on any storefront — that is the
  one hard line. Generation, publishing, model shots and site builds are all fair game; this is a
  test loop and those costs don't matter.
- **Use a throwaway brand you invent this session.** Never Night Circuit, Stephen Lawyer, Aether Run
  or Lemon Light Merch — those are real. Prefix any published product with `TEST-`.
- Say what you're about to do before an action that writes to a real brand.

## 3. Drive her

```bash
npm run eve:talk -- "Hey Eve, what's life like for you?"     # speak; waits for her reply
npm run eve:talk -- --listen --wait 30                        # just watch
xcrun simctl openurl booted "nanocrew://studio?talk=1"        # DEV: open a voice session, no tap
```

Modals (picker, enhance-or-as-is, placement, publish) need a real tap. `idb ui tap X Y` is best;
computer-use works but **fronts the Simulator and takes the screen — ask first**. Typing into the
Simulator drops characters: send keys individually with ~1s gaps, or paste.

## 4. Watch the wire, not the screen

- **Her words and yours:** the newest `local-logs/conversation_*.json`.
- **The plumbing:** the Metro log from preflight — `[live]` for the socket, greeting hold, persona
  hash, cue queueing; `[eve:route]` for intent classification; `[critique]` for circled regions.
- **The truth:** Postgres. Verify what a flow *claims* against what it *wrote* — that is what caught
  a product publishing into the wrong brand while the UI said success.

## 5. Score the character

Run the ten probes from `testing/README.md` and score the rubric: redirect rate (target **0** on
1–4 and 10), net-new rate, statement:question (never two questions running), turn length (~30 words
unless she asked for room), opener diversity (no repeat in 5 cold starts).

## 6. Report — and file it

Every finding needs the transcript excerpt, the `[live]`/`[eve:route]` lines, and a screenshot where
it's visual. Then **file it in [`docs/ops/BUG_AUDIT_2026-08-20.md`](../../docs/ops/BUG_AUDIT_2026-08-20.md)**
(status · where · what · evidence). A finding that lives only in a chat or a session record gets
lost — that has already happened once.

If you changed code, the documentation rides the same commit ([`CLAUDE.md`](../../CLAUDE.md)).

## Gotchas that will cost you an afternoon

- **Her persona is read once, at connect.** Editing `src/eve/*.md` mid-session does nothing —
  `npm run eve:persona`, then start a NEW session.
- **She is half-duplex.** The mic is gated until ~250 ms after her audio ends; a line played over her
  reply is discarded by design. Wait for her to finish.
- **A line spoken into a dead socket vanishes silently.** If she doesn't answer, check for a `ws
  close` before assuming she ignored you.
- **`screencapture` returns the wallpaper** on this Mac. Use `xcrun simctl io booted screenshot`.
- **The phone writes no transcripts** — `/api/dev/log-conversation` is dev-server only. Simulator only.
- **Other sessions commit to this checkout.** Check `git log` before diagnosing an "old version".
