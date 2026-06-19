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
4. `save_brand` → `setBrand(...)` → the existing compiled-brand → **Create my store** screen (unchanged).
5. Keep the **typed keyboard fallback** (`/api/interview`) for no-mic/noisy use.
6. Pause pill stays (stops the mic + her audio). The primer's "hold to talk" copy reverts to "just talk."
7. **Rollout:** gate behind a flag; if Live (preview) misbehaves we flip back to turn-based. Remove
   turn-based once Live is proven in the wild.

## Session lifecycle / failure modes

- **Cap:** compression makes 15-min effectively unlimited; still cap the interview by question count.
- **Reconnect:** on `GoAway`/`onclose`, if not user-stopped, re-mint isn't needed within the token
  window — reconnect with the resumption handle; outside it, re-mint + resume.
- **Overload:** native-audio preview has tighter rate limits — surface a calm retry, keep the
  turn-based fallback for hard outages.
- **Cleanup:** always `stop()` on unmount/blur (recorder + queue + context + session).

## Test plan

1. **Spike (`/live-test`):** Start → mic permission → talk → hear Venus → transcripts update →
   say "I'm done" → `save_brand` fires with a populated `BrandResult`. Watch Metro logs for the WS
   lifecycle. **This validates the audio bridge before touching Studio.**
2. **Studio:** full interview → brand compiles → Create my store → live storefront. Interruption,
   pause/resume, keyboard fallback, backgrounding mid-session.
3. Costs sanity-check against a real session in the Google console.

## Phases

- **P0 (done):** feasibility, deps, token endpoint, bridge, hook, spike — all typecheck, dev build rebuilt.
- **P1 (next):** validate the spike on-device; fix audio format/sample-rate as needed.
- **P2:** token locking + `contextWindowCompression` + `sessionResumption`.
- **P3:** Studio swap (open-mic, captions, save_brand → compiled screen), behind a flag.
- **P4:** harden (reconnect, rate-limit UX), ship build 25, then retire the turn-based path.
