# Venus on Gemini Live — realtime voice migration plan

**Status: in progress (branch `gemini-live`).** This replaces the turn-based voice interview
(`/api/voice` → Gemini multimodal → ElevenLabs TTS) with **Gemini Live** realtime speech-to-speech.
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
app ──(authed)──► /api/voice-live-token (Railway)  ── mints ephemeral token (locked) ──►
app ──(WebSocket, token as apiKey, v1alpha)──► Gemini Live  ◄── 16k PCM mic up / 24k PCM down ──►
```

**Client-direct, NOT server-proxy.** Railway runs `expo serve` with **per-request isolation** (no
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

- **Model:** `gemini-2.5-flash-native-audio-preview-12-2025` (native audio). Alt: `gemini-3.1-flash-live-preview`.
- **Audio:** input raw **16kHz** LE PCM16 mono (`audio/pcm;rate=16000`); output **24kHz** PCM16.
- **VAD:** automatic (open-mic). Tune `realtimeInputConfig.automaticActivityDetection.silenceDurationMs`
  ≈ 600–800ms so Venus doesn't cut the creator off mid-thought.
- **Interruption:** on `serverContent.interrupted` → `queue.clearBuffers()` + flip to listening.
- **Transcription:** `inputAudioTranscription:{}` + `outputAudioTranscription:{}` → drive captions.
- **Voice:** `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName` (e.g. `Aoede` — warm/calm; audition in AI Studio).
- **System instruction:** our `interviewSystem()` — but it must drop the JSON-output contract (Live is
  speech), and instruct Venus to **call the `save_brand` tool** when done.
- **Tools:** one `save_brand` function declaration → maps to `BrandResult` (`toBrandResult`).
- **Session longevity (TODO):** `contextWindowCompression:{ slidingWindow:{} }` (15-min audio cap →
  unlimited) + `sessionResumption:{}` (capture `SessionResumptionUpdate.handle`; on `GoAway`/close,
  reconnect with the handle — valid 2h).

## Security (TODO on the token endpoint)

Mint with `liveConnectConstraints` locking **model + config** (responseModalities, speechConfig,
systemInstruction, tools) and `lockAdditionalFields`, so a leaked token can't change Venus's brain or
model. Keep `uses: 1` + short `expireTime` (~30 min) + `newSessionExpireTime` (~1 min); rely on
**session resumption** (not extra `uses`) for reconnects within the window.

## Audio pipeline (`react-native-audio-api`)

- **Mic in:** `AudioRecorder.onAudioReady({ sampleRate:16000, bufferLength:1600, channelCount:1 })` →
  Float32 → PCM16 base64 → `session.sendRealtimeInput({ audio })`.
- **Speaker out:** one `AudioContext({ sampleRate:24000 })` + `AudioBufferQueueSourceNode`; each audio
  chunk → `createBuffer` → `enqueueBuffer` (gapless). Interruption → `clearBuffers`.
- **Permissions:** mic permission already requested on the primer; `react-native-audio-api` plugin in
  app.json handles the iOS audio session.

## Studio integration (the swap)

Live makes the UX **simpler** — open-mic + VAD means **no push-to-talk**:
1. Enter interview (focused, not keyboard, not paused) → `live.start()`; blur/pause → `live.stop()`.
2. Map `LiveState` → the orb's `EntityState` (listening/speaking/thinking/idle/error).
3. `venusText`/`userText` transcripts → the existing captions + heard line.
4. Finalize → `setBrand(...)` → the existing compiled-brand → **Create my store** screen (unchanged).
5. **Keyboard mode = a full-screen chat window** (`ChatInterview`), rendered as an overlay OVER the
   studio (outside the screen's KeyboardAvoidingView — nesting one dropped the composer under the tab
   bar). Message bubbles for Venus + the creator, a streaming reply bubble, a composer that manages
   its own inset off the live keyboard height (above the keyboard when open, above the native tab bar
   when closed). It routes typed turns into the SAME Live session (`live.sendText`) and renders
   `live.messages` (the committed transcript, emitted via `onTranscript`). It's a **text-only**
   experience: entering chat calls `live.mute(true)`, which mutes the mic AND her audio playback (and
   flushes any in-flight audio). Header: **‹ Back** exits the interview (→ dashboard / primer), **🎙 Voice**
   switches to the orb, **✓ Build** appears once ready. **Pause is voice-only** — it does NOT gate text
   mode (the lifecycle rule runs the session when `keyboardMode || !paused`), and entering chat clears a
   stale pause, so a pause set in voice can't leave the chat dead ("not completing"). (The
   `/api/interview` text path remains only for the dormant non-Live fallback.)
6. Pause pill stays (stops the mic + her audio). The primer's "hold to talk" copy reverts to "just talk."
7. **Rollout:** gate behind a flag; if Live (preview) misbehaves we flip back to turn-based. Remove
   turn-based once Live is proven in the wild.

**Greeting.** On `setupComplete` the session nudges Venus to open. Her first line is a casual
*"Hi {first name}, how's your day going? Want to talk branding your store?"* (no name → just "Hi").
The studio passes `userName` (from `user_metadata.name`/`full_name`) and `firstTime` (`!hasStore`) into
`useLiveVoice` → `liveSystemInstruction`. When `firstTime`, she first introduces herself in one sentence
(who she is + that she'll build their brand and store). There is **no AI/voice picker** — Venus on
Gemini is the only consultant, so a new creator lands straight on the interview primer.

**She's only vocal in her view.** One declarative rule drives the session lifecycle: it runs *iff*
`mode === 'interview' && !brand && !paused && focused && appActive`. `focused` comes from
`useFocusEffect` (nav focus — leaving the Studio tab stops her) and `appActive` from an `AppState`
listener (backgrounding via home button / app switcher stops her, even though nav focus hasn't
changed). Keyboard mode keeps the session but mutes it. So Venus never speaks on another tab, in the
background, on the dashboard, or once a brand is compiled.

## Finalize: extract from the transcript, NOT the `save_brand` tool call

**The native-audio Live model does not reliably emit function calls.** The `scripts/live-flow-test.mjs`
harness drove the full scripted interview against the real model + `save_brand` tool and proved it:
Venus says *"I'm creating the brand now"* but **never invokes the tool** — no `toolCall` ever
arrives. Forcing it in the system prompt ("you MUST call save_brand") didn't fix it; native-audio
models are simply unreliable at tool use.

So we finalize **deterministically** instead of waiting on the tool:
- `LiveVoiceSession` accumulates the spoken conversation (`transcript[]`, `getTranscript()`) from the
  input/output transcription events.
- **Build is gated — Venus leads first.** The button is hidden until she's gathered the essentials
  (name + products + design style). The prompt tells her not to wrap early and to say "ready to build
  your brand" only once she has them; the studio latches `buildReady` when that cue lands (regex on her
  committed turns, floored at 3 creator answers, with a 6-answer safety net so it always eventually
  appears). Both the orb's finalize pill and the chat header's "✓ Build" respect `buildReady` /
  `canBuild`. This stops a creator from building from an empty/thin conversation.
- A **"✓ Build my brand"** button in the interview calls `useLiveVoice.finalize()`, which POSTs the
  transcript to **`POST /api/extract-brand`** — a **text** model (`gemini-2.5-flash`) running the same
  `interviewSystem` + `parseTurn` as `/api/interview`, which reliably returns the structured
  `BrandResult`. Proven by `scripts/extract-brand-test.ts` (full brand from a transcript).
- `onBrand(brand, transcript)` → `setBrand(...)` **and** stashes the transcript in `messages.current`
  so **Create my store** sends `{ brand, transcript }` to `/api/store` (provisioning/forge context),
  exactly like the old turn-based path.
- The `save_brand` tool declaration + `toBrandResult` are kept as a no-cost bonus path: if the model
  ever *does* call the tool, `onBrand` still fires. We just no longer depend on it.

## Session lifecycle / failure modes

- **Cap:** compression makes 15-min effectively unlimited; still cap the interview by question count.
- **Reconnect:** on `GoAway`/`onclose`, if not user-stopped, re-mint isn't needed within the token
  window — reconnect with the resumption handle; outside it, re-mint + resume.
- **Overload:** native-audio preview has tighter rate limits — surface a calm retry, keep the
  turn-based fallback for hard outages.
- **Cleanup:** always `stop()` on unmount/blur (recorder + queue + context + session).

## Test plan

1. **Spike (`/live-test`):** Start → mic permission → talk → hear Venus → transcripts update →
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
