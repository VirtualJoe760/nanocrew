# Eve on Gemini Live — realtime voice

**Status: SHIPPED — migration complete; the legacy turn-based system is fully removed.** Eve runs on
**Gemini Live** realtime speech-to-speech (`lib/live-voice.ts` + `hooks/use-live-voice.ts`,
ephemeral token from `/api/voice-live-token`). The old turn-based pipeline (`/api/voice` → Gemini
multimodal → ElevenLabs TTS) and its text fallback (`/api/interview`) have been **deleted**, along with
all the client push-to-talk machinery in `studio.tsx` (`turn`/`beginHold`/`endHold`/`sendRecording`,
the expo-audio recorder + metering, the word-timed karaoke, the `voiceId` picker, the `USE_LIVE` flag).
The only post-interview voice line — the "your store is online" launch fanfare — is now her actual
Live voice via `announce()` (see "Launch announcement" below), so ElevenLabs is gone from the interview path entirely. The
brand brain (`lib/interview.ts` `interviewSystem`/`parseTurn`) survives, reused by `/api/extract-brand`
to turn the spoken transcript into a `BrandResult`. The migration plan below is kept as history.

Grounded in the Live API docs (live-guide, live-session, ephemeral-tokens) + our shipped code.

## Why we're moving

The turn-based pipeline does **two sequential blocking AI calls per turn** (Gemini understands+writes,
*then* ElevenLabs renders the whole reply), so the user waits ~4–8s before hearing anything, and it
dead-ends on Gemini overload waves. Live is purpose-built for flowing conversation: open-mic, native
VAD, sub-second response, built-in interruption — and it **replaces both** the Gemini call and
ElevenLabs (likely cheaper too).

## Cost (computed from current pricing)

`gemini-2.5-flash-native-audio`: audio **in $3/1M**, **out $12/1M** (32 tok/s in, 25 tok/s out). A
~3-min interview ≈ **$0.05–0.10**, replacing the Gemini-multimodal + ElevenLabs spend (ElevenLabs is
the current cost driver) — so **net same-or-cheaper**, far lower latency. Caveat: preview pricing +
tighter rate limits; uses **Gemini's voices** (not ElevenLabs).

## Architecture — client-direct via ephemeral token

```
app ──(authed)──► /api/voice-live-token (Cloud Run)  ── mints ephemeral token (unlocked — locking is the open TODO) ──►
app ──(WebSocket, token as apiKey, v1alpha)──► Gemini Live  ◄── 16k PCM mic up / 24k PCM down ──►
```

**Client-direct, NOT server-proxy.** Cloud Run runs `expo serve` with **per-request isolation** (no
persistent process — see the `production-shipping` memory), so it can't hold a relay WebSocket. The
app connects straight to Gemini Live; the real key never leaves the server (only a short-lived token
does). This is Google's recommended client-to-server pattern.

## The pieces (built vs. to-do)

| Piece | File | Status |
|---|---|---|
| Ephemeral-token endpoint | `src/app/api/voice-live-token+api.ts` | ✅ built — **TODO: lock to model+config** |
| Audio↔Live bridge | `src/lib/live-voice.ts` | ✅ built — **TODO: compression + resumption** |
| React hook | `src/hooks/use-live-voice.ts` | ✅ built |
| Isolation spike | `src/app/live-test.tsx` (`/live-test`) | ✅ built — validate on-device next |
| Studio integration | `src/app/studio.tsx` | ⬜ to-do |
| Native audio lib | `react-native-audio-api` (+ nitro-modules, app.json plugin) | ✅ installed; dev build rebuilt |

## Live session config (the contract)

- **Model:** `gemini-2.5-flash-native-audio-latest` (native audio; 2026-08-18 — the pinned `-preview-12-2025` began dropping sockets 1006 after setup while still listed in /models; pin to the alias). Alt: `gemini-3.1-flash-live-preview`.
- **Audio:** input raw **16kHz** LE PCM16 mono (`audio/pcm;rate=16000`); output **24kHz** PCM16.
- **VAD:** automatic (open-mic), on **API defaults — deliberately no `realtimeInputConfig`** (Joe,
  2026-08-18). The custom block's history: wind → LOW/LOW + 1000ms → never settled → 650ms → too
  jumpy in a quiet room → 850ms → `START_SENSITIVITY_LOW` stopped hearing him at all. Defaults heard
  fine in every normal room; a per-session "windy mode" toggle is the right future lever, not a
  hardcoded compromise.
- **Interruption:** on `serverContent.interrupted` → `queue.clearBuffers()` + flip to listening.
- **Transcription:** `inputAudioTranscription:{}` + `outputAudioTranscription:{}` → drive captions.
  ⚠️ Her transcript arrives **seconds ahead of her audio**, so painting it as it lands races her
  voice. The session reports the wall-clock window its queued audio occupies (`onSpeechWindow` →
  `speechWindow` on the hook) and `useSpokenText` in [`src/lib/caption.ts`](../../src/lib/caption.ts)
  reveals words across that window: 40% through the sound, 40% of the words. Shared by the site
  editor and her home surface — subtitles anywhere should use it, not `venusText` directly
  (Joe, 2026-08-19: "we want it to be word for word… across all subtitles").
- **Voice:** `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName` — **`Kore`** (picked in the
  Lab audition 2026-07-05: Kore × the "british robot" delivery). Set in TWO places that MUST match:
  `LIVE_VOICE` in `src/lib/live-voice.ts` (exported; `eve-home.tsx` imports it) and `VENUS_VOICE` in
  `src/app/api/say+api.ts`. The `LiveVoiceSession` constructor now defaults to `LIVE_VOICE` itself
  (the old `'Aoede'` fallback was removed in the 2026-08-17 fix — a session that forgets to pass a
  name must not sound like someone else).
  ⚠️ **TWO native-audio footguns (both broke the session → NO AUDIO, 2026-06-22):** (1) do **NOT** put
  `languageCode` in `speechConfig` — the native-audio model auto-detects language and rejects it;
  (2) not every prebuilt voice from the ~30-voice TTS roster is valid on the native-audio model — a
  switch to `Sulafat` silenced it. The fashionable/British TONE comes from the persona wording in
  `liveSystemInstruction`, not these fields. To change her actual voice, pick from the native-audio-
  supported set via the in-app voice sampler (which tests against the live model), not blindly.
- **System instruction:** `buildPersona(mode)` composing her agent files `src/eve/*.md` +
  `jobs/*.md` (modes interview · central · critique — see `src/eve/README.md`); `interviewSystem`
  survives only as the extraction brain behind `/api/extract-brand`.
- **Tools:** one `save_brand` function declaration → maps to `BrandResult` (`toBrandResult`).
- **Session longevity (TODO):** `contextWindowCompression:{ slidingWindow:{} }` (15-min audio cap →
  unlimited) + `sessionResumption:{}` (capture `SessionResumptionUpdate.handle`; on `GoAway`/close,
  reconnect with the handle — valid 2h).
  **Observed in the field 2026-08-19**, so this TODO has a cost now: four distinct server closes in
  one session — `1007 CONTENT_TYPE_AUDIO` **twice mid-utterance**, plus `1011` and `1001`. The
  client allows exactly ONE automatic reconnect (`live-voice.ts`, `reconnects < 1`) and never resets
  the counter, so a second drop leaves her idle with the mic dead. It cost a whole utterance (one
  sentence reached the router as the single word `club`) and a dropped enhance-or-as-is line.

**Setup log — what she actually got.** Every session prints
`[live] persona files=<hash> sent=<fingerprint> chars=<n> voice=<name> outRate=<ctx>/<expected>`.
`voice`/`outRate` were added 2026-08-19 after "she sounded like someone else for a second": they
prove a drift is NOT a wrong voice name or a resampled graph, which leaves the instruction as the
only suspect. Her accent is prompt-carried — native audio **rejects** `speechConfig.languageCode`
(it kills the session), so the model infers the accent, and the longest instruction is where it
wanders. See [`EVE_PERSONALITY.md`](EVE_PERSONALITY.md).

## Security (TODO on the token endpoint)

Mint with `liveConnectConstraints` locking **model + config** (responseModalities, speechConfig,
systemInstruction, tools) and `lockAdditionalFields`, so a leaked token can't change Eve's brain or
model. Shipped: `uses: 2` (initial connect + one reconnect), `expireTime` ~30 min,
`newSessionExpireTime` ~2 min. Session resumption is still TODO — until it lands, the second `use`
IS the reconnect path.

## Audio pipeline (`react-native-audio-api`)

- **Mic in:** `AudioRecorder.onAudioReady({ sampleRate:16000, bufferLength:1600, channelCount:1 })` →
  Float32 → PCM16 base64 → `session.sendRealtimeInput({ audio })`.
- **Speaker out:** one `AudioContext({ sampleRate:24000 })` + `AudioBufferQueueSourceNode`; each audio
  chunk → `createBuffer` → `enqueueBuffer` (gapless). Interruption → `clearBuffers`.
- **Permissions:** mic permission is requested on the creator's **first tap-to-talk** — `ensureMic()`
  runs from `toggleTalk()`/`startVoice()`, never on summon/arrival (post-P0 silent-by-default; see
  [`EVE_CONTROL.md`](EVE_CONTROL.md) P0) — falling back to keyboard mode on
  denial; `react-native-audio-api` plugin in app.json handles the iOS audio session.

## Mid-conversation channels (the session surface)

Beyond mic audio, the session (`live-voice.ts`, exposed on the `useLiveVoice` hook) has six channels:

- **`sendText`** — a typed turn (forces a reply); powers keyboard mode.
- **`prompt`** — a queued spoken stage-direction: sent as a completed turn so she replies OUT LOUD,
  with no trace in the visible transcript. It never barges in — it queues until the creator has
  actually stopped (a 700 ms settle window over server transcription + local mic RMS) and expires
  unspoken after 15 s (`CUE_TTL_MS`) if the screen has moved on, always releasing the waiting
  surface. One slot only (a newer cue describes the screen better). This is the wheel's ask-spokes'
  channel — `sendContext` can never voice anything, which is why both exist.
- **`sendContext`** — silent context injection (`turnComplete: false` — no reply, no transcript
  churn); used for the circled-section notes in the critique view and to brief Eve with the digest's
  real figures (`digestBriefing`) so she answers stats questions with actual numbers.
- **`sendImage`** — lets her SEE an image mid-conversation (same `sendClientContent` mechanism,
  `turnComplete: false`, ~1.3k tokens ≈ $0.004/image — settled images only); wired through
  `eve-vision-bus` so the design overlay publishes what it rendered and EveHome fetches + forwards
  it into the live session.
- **`mute`** — text-only mode (mutes the mic AND her audio, flushing in-flight playback).
- **`finalize`** — transcript → `POST /api/extract-brand`.

## Studio integration (the swap)

Live makes the UX **simpler** — open-mic + VAD means **no push-to-talk**:
1. Enter interview (focused, not keyboard, not paused) → `live.start()`; blur/pause → `live.stop()`.
2. Map `LiveState` → the orb's `EntityState` (listening/speaking/thinking/idle/error).
3. `venusText`/`userText` transcripts → the existing captions + heard line.
4. Finalize → `setBrand(...)` → the existing compiled-brand → **Create my store** screen (unchanged).
5. **Keyboard mode = a full-screen chat window** (`ChatInterview`), rendered as an overlay OVER the
   studio (outside the screen's KeyboardAvoidingView — nesting one dropped the composer under the tab
   bar). Message bubbles for Eve + the creator, a streaming reply bubble, a composer that manages
   its own inset off the live keyboard height (above the keyboard when open, above the native tab bar
   when closed). It routes typed turns into the SAME Live session (`live.sendText`) and renders
   `live.messages` (the committed transcript, emitted via `onTranscript`). It's a **text-only**
   experience: entering chat calls `live.mute(true)`, which mutes the mic AND her audio playback (and
   flushes any in-flight audio). Header: **‹ Back** exits the interview (→ the guide view), **🎙 Voice**
   switches to the orb, **✓ Build** appears once ready. **Pause is voice-only** — it does NOT gate text
   mode (the lifecycle rule runs the session when `keyboardMode || !paused`), and entering chat clears a
   stale pause, so a pause set in voice can't leave the chat dead ("not completing").
6. Pause pill stays (stops the mic + her audio). The primer's "hold to talk" copy reverts to "just talk."
7. **Rollout:** gate behind a flag; if Live (preview) misbehaves we flip back to turn-based. Remove
   turn-based once Live is proven in the wild.

**Greeting.** On `setupComplete` the session nudges Eve to open — and since 2026-08-18 the nudges
are variety-first, never scripts (see [`EVE_VOICE.md`](EVE_VOICE.md) → "She never opens the same way
twice"). **First-brand creators** (no store) get `liveSystemInstruction`, and the `firstTime` nudge
is *one sentence naming her ("Hi {name}" — you're Eve, you'll get their store up and running
together) plus ONE easy question*. **Returning creators**
get the CENTRAL persona instead — `eveCentralInstruction(userName, storeNames)` +
`EVE_CENTRAL_GREETING` ("Open however feels right THIS time… Never a formula"), riding with
`openerVariation`'s do-not-repeat memory. The nudge also waits `GREET_HOLD_MS` and is dropped
entirely if the creator spoke first.
EveHome passes `userName` (from `user_metadata.name`/`full_name`) and `firstTime` (`!hasStore`) into
`useLiveVoice`. There is **no AI/voice picker** — Eve on Gemini is the only consultant, so a new
creator lands in EveHome's interview view.

**She's only vocal when the creator asked her to be.** The session lives in EveHome
(`src/components/eve/eve-home.tsx`), and one declarative rule drives its lifecycle — rewritten by
P0 (silent by default, see [`EVE_CONTROL.md`](EVE_CONTROL.md)): **`talking` — a creator's tap — is
the precondition.** The rule: `wants = talking && !brand && personaReady && (keyboardMode ||
!paused)` and `reachable = open && appActive && !covered`. Not wanted → the session **stops** (she's
done, release it now); wanted but not reachable (a covering surface, or backgrounded via the
`AppState` listener) → it **suspends** — muted both ways, socket held for a 45 s grace
(`SUSPEND_GRACE_MS`) so a glance at the console doesn't cost a reconnect — instead of stopping.
`personaReady` waits on `/api/me` (`meResolved`) in the guide view only — the interview
deliberately never waits on it, so a stalled `/api/me` can't dead-end typed turns. Keyboard mode
keeps the session but mutes it. So Eve never speaks unbidden, on another tab, in the background,
under a covering surface, or once a brand is compiled.

## Finalize: extract from the transcript, NOT the `save_brand` tool call

**The native-audio Live model does not reliably emit function calls.** The `scripts/live-flow-test.mjs`
harness drove the full scripted interview against the real model + `save_brand` tool and proved it:
Eve says *"I'm creating the brand now"* but **never invokes the tool** — no `toolCall` ever
arrives. Forcing it in the system prompt ("you MUST call save_brand") didn't fix it; native-audio
models are simply unreliable at tool use.

So we finalize **deterministically** instead of waiting on the tool:
- `LiveVoiceSession` accumulates the spoken conversation (`transcript[]`, `getTranscript()`) from the
  input/output transcription events.
- **Build is gated — Eve leads first.** Building is locked until she's gathered the essentials.
  `eve-home.tsx` latches `buildReady` off a broad cue-regex family on her committed turns ("ready to
  build" / "got everything" / "let's build" and kin — no persona file instructs a verbatim phrase
  any more, so her ready-signal must stay inside that regex family; see
  [`BUG_AUDIT_2026-08-20.md`](../ops/BUG_AUDIT_2026-08-20.md)), floored at 3 creator answers, with a
  6-answer safety net that applies in the interview VIEW only. This stops a creator from building
  from an empty/thin conversation.
- **The voice interview has NO button — it's voice-pure (2026-08-18).** When `buildReady` latches
  she is cued to hand them the phrase, and a spoken *"okay, build it"* (and kin) triggers
  `useLiveVoice.finalize()`. Only the typed chat header keeps "✓ Build". Finalize POSTs the
  transcript to **`POST /api/extract-brand`** — a **text** model (`gemini-2.5-flash`) running the same
  `interviewSystem` + `parseTurn` as the old `/api/interview`, which reliably returns the structured
  `BrandResult`. Proven by `scripts/extract-brand-test.ts` (full brand from a transcript).
- `onBrand(brand, transcript)` → `setBrand(...)` **and** stashes the transcript in `messages.current`
  so **Create my store** sends `{ brand, transcript }` to `/api/store` (provisioning/forge context),
  exactly like the old turn-based path.
- The `save_brand` tool declaration + `toBrandResult` are kept as a no-cost bonus path: if the model
  ever *does* call the tool, `onBrand` still fires. We just no longer depend on it.

## Audio arbitration & failure modes (shipped)

(`contextWindowCompression` + `sessionResumption` remain the open TODO above — the shipped machinery
in `live-voice.ts` is:)

- **One live session, module-wide** — `activeLiveSession` + `isVenusLive()`; `start()` kills any
  OTHER live session, and every `await` inside `start()` re-checks `this.closed` so an in-flight
  start can't build a second audio graph.
- **Half-duplex mic gating** — the mic doesn't stream while her queued audio is playing
  (`playEndsAt` + a 250ms tail) — why she doesn't interrupt herself.
- **`AudioSessionBusyError`** — iOS `InsufficientPriority` (561017449 — an active phone/FaceTime
  call) is detected across the activation retry backoff (0/150/400/900ms) and surfaces a dedicated
  `audioBusy` modal with a retry, distinct from the generic error.
- **Connect watchdog** — 15s; fails to a tap-to-retry instead of hanging on "thinking".
- **iOS audio session** — `playAndRecord` + `voiceChat` echo cancellation + `defaultToSpeaker`,
  configured on start and released on `stop()`.
- **Cleanup:** always `stop()` on unmount/blur (recorder + queue + context + session).

## Test plan

1. **Spike (`/live-test`):** Start → mic permission → talk → hear Eve → transcripts update →
   tap **Build my brand** → `/api/extract-brand` returns a populated `BrandResult`. Watch Metro logs
   for the WS lifecycle. **This validates the audio bridge before touching Studio.**
2. **Studio:** full interview → brand compiles → Create my store → live storefront. Interruption,
   pause/resume, keyboard fallback, backgrounding mid-session.
3. Costs sanity-check against a real session in the Google console.

## Phases

- **P0 (done):** feasibility, deps, token endpoint, bridge, hook, spike — all typecheck, dev build rebuilt.
- **P1 (done ✅):** spike validated on-device — fluid voice, echo loop fixed (half-duplex), input/output transcription working.
- **P2:** token locking + `contextWindowCompression` + `sessionResumption`.
- **P3 (now):** Studio swap — see the detailed map below.
- **P4:** harden (reconnect, rate-limit UX), ship build 25, then retire the turn-based path.

## P3 — Studio migration: current → new (detailed, audited)

Audited `src/app/studio.tsx` (StudioScreen). The migration is gated behind a `USE_LIVE` const so we
can flip back instantly if the preview model misbehaves.

### KEEP unchanged (the shell + non-voice flow)
- The `mode` machine (`loading → cta → primer → interview → dashboard`) + landing logic
  (`voiceResolved`/`hasStore`).
- The **CTA voice picker** + **primer** screens (copy edit: "hold the mark" → "just talk").
- `brand` state → the **compiled-brand screen** → `createStore()` → `/api/store`. **Untouched** — Live's
  `save_brand` tool sets `brand` exactly like the old `done` turn did.
- Dashboard, `StudioComposer`, paywall, **brand-limit free-a-slot** + staged banner, header icons,
  `onNewBrand`/`onFinishedBrand`, the error banner, mic-permission request on the primer.

### REPLACE (turn-based voice machine → `useLiveVoice`)
Remove from the interview path: `turn()` (`/api/voice`), `playSpeech`, `beginHold`/`endHold`,
`sendRecording`, the expo-audio `recorder`/`player`/`playerStatus`/`recState` + their metering
effects, the `didJustFinish` effect, the greeting `turn({init})` effects, `busyRef`/`playGenRef`/
`lastTurnEmptyRef`, and the word-timed karaoke (`timedWords`/`wordIdx`).

Drive the orb + captions from the hook instead:
- `live.state` → the orb's `EntityState` (map `connecting/thinking`→thinking, `listening`→listening,
  `speaking`→speaking, `idle/error`→idle).
- `live.venusText` → `line` (her caption), `live.userText` → `heard` (your caption). Captions become
  the streaming transcript (drop the per-word animation; show the rolling text).
- `live.onBrand` → `setBrand(...)`.
- **Orb interaction:** open-mic, so tap = pause/resume (no hold-to-talk). `NCNucleus onPress`.
- **Lifecycle:** start the session when `mode==='interview' && focused && !paused`; `live.stop()` on
  blur/pause/unmount. Pause pill → `live.stop()`/`live.start()`.
- **`level`** (orb amplitude): no expo-audio metering now — drive a gentle state-based pulse
  (speaking/listening), refine later with an analyser node.

### Keyboard fallback
Route typed answers to the SAME Live session via `session.sendClientContent({ turns:[text] })` (she
replies with audio, matching today's behavior). Keep `/api/interview` only as a dead fallback.
*(First cut may keep keyboard on the turn-based path if Live text-in needs tuning — flag it.)*

### Voice picker / preview
The interview voice is now a **Gemini** voice. Map the chosen `AI_VOICES` id → a Gemini voice name
(default `Aoede`) for the Live session. The ElevenLabs-based `previewVoice` mismatches the real voice
now — either repoint preview to a Gemini sample or drop it (follow-up; not blocking).

### Launch announcement (post-build) — `announce()`, an announcement-mode Live session
After the brand is built, `createStore` plays a one-line "your store is online" fanfare.

**This used to go through `/api/say` and it sounded wrong** (Joe, on device, 2026-08-16). Matching
voice *names* is not enough: `/api/say` runs `gemini-2.5-flash-preview-tts` while the conversation
runs on the **native-audio** Live model, and the same `Kore` renders as a different person across the
two engines — so seconds after a long conversation with Eve, a stranger announced the launch.

The fanfare now goes through the **Live model**, which is the only way to match her, via
[`announce()`](../../src/lib/live-voice.ts) — a `LiveVoiceSession` with `speakOnly: true`:
- **the microphone is never started** (`onopen` skips `startMic`), so this is an announcement, not a
  conversation, and nothing is listening;
- it **closes itself** on `turnComplete`, waiting out `playEndsAt` first so she isn't cut off
  mid-word, with a hard `ANNOUNCE_MAX_MS` (25s) backstop if that signal is ever lost;
- it is **fire-and-forget** — a failed fanfare never blocks or breaks store creation.

`/api/say` remains for the **Eve Lab voice audition** (`venus-lab-screen.tsx`), which is exactly what
a one-shot TTS route is good for. The old `playSpeech`/`useAudioPlayer` path in `eve-home.tsx` had no
remaining callers and was deleted with this change.

**Web speaks and hears now (2026-08-18).** `react-native-audio-api`'s web build has no buffer-queue
source (B4 in the 2026-08-14 bug report), so web used to be captions-only — but her PCM now plays
through the `WebAudioQueue` shim (standard Web Audio API) and the browser mic streams in via
`getUserMedia` → ScriptProcessor (`startWebMic`). Device checks remain the standard for
audio-session behaviour.

### Transcript for `createStore`
Live has no `messages.current`. Accumulate completed turns in the hook (push `userText`/`venusText`
on `turnComplete`) and pass that as the `transcript`. `brand` is the primary input; transcript is
supplementary context for provisioning.

### Execution order
1. Add `USE_LIVE` flag + the `useLiveVoice` hook wiring in the interview branch; map state/captions/brand.
2. Gate the turn-based effects/handlers behind `!USE_LIVE`.
3. Orb → pause/resume; pause pill → stop/start; primer copy.
4. Keyboard → `sendClientContent`. Transcript accumulation for `createStore`.
5. Voice mapping (AI_VOICES → Gemini). tsc + on-device verify a full interview → Build my brand → store.
6. Once solid: remove the dead turn-based code + `/api/voice` client calls, drop the `USE_LIVE` flag.

## Reused for live-site editing (the critique view)

The same Live session powers live-site editing in `site-preview.tsx` (the critique view). The session
is parameterized — `useLiveVoice({ instruction, greeting, enableBrandTool })` — so it drops the
`save_brand` tool (`enableBrandTool: false`) and swaps in `critiqueInstruction(brandName)` +
`CRITIQUE_GREETING` (live-voice.ts; the old `editSiteInstruction`/`EDIT_SITE_GREETING` pair was
deleted). Eve is continuously open-mic while the live view is open (tap the orb to pause). The
creator **circles** elements on the site — each hit is pushed silently via
`venus.sendContext(venusContextForHit(...))` with the site-vocabulary brief, so Eve can name and
explain the section — changes are logged as they go, and **Submit** builds the revision via the
existing `POST /api/creator/revise` (forge revision) — no API change. The old record→transcribe
pipeline is gone, which leaves `POST /api/transcribe` (`src/app/api/transcribe+api.ts`) with zero
callers — retired dead code (its header comment still claims the critique flow uses it).


## Available and unused (researched 2026-08-17)

| Feature | Field | Status |
|---|---|---|
| Affective dialog — she adapts her style to the creator's tone | `enableAffectiveDialog` | supported by our model; **needs `apiVersion: v1beta`**, we connect on `v1alpha` |
| Proactive audio — she may decline to respond when nothing needs saying | `proactivity.proactiveAudio` | same |

Both fit the casual persona directly. Deliberately NOT bundled with a prompt change: a bad session
config has silenced her before (see the `speechConfig` note above), and shipping both together would
make it impossible to tell which one broke her. Ship as its own testable change.
Source: https://ai.google.dev/gemini-api/docs/live-guide
