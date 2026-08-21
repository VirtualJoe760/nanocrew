# Eve's agent files

Her character, written as prose instead of buried in template literals. Modelled on the OpenClaw
agent anatomy Joe uses on his other project (IDENTITY / SOUL / USER / AGENTS / TOOLS), translated
for a **single agent with modes** and for Google's documented ordering for voice agents:
**persona → conversational rules → guardrails**.

| File | What it is | OpenClaw equivalent |
|---|---|---|
| `identity.md` | Who she is, the five reference characters | `IDENTITY.md` |
| `soul.md` | Voice, temperament, how she talks about herself | `SOUL.md` |
| `user.md` | Who she works for + what she remembers | `USER.md` |
| `conversation.md` | The loop: turn length, consent, net-new turns | `AGENTS.md` (rules half) |
| `guardrails.md` | The narrow refusals + failure behaviour | (end of the SI, per Google) |
| `jobs/*.md` | One per mode: brand · design · assets · critique | `AGENTS.md` (job half) |

**No `TOOLS.md`.** In OpenClaw an agent won't call a tool that isn't listed in prose. Gemini takes
tools **structurally** — `tools: [{ functionDeclarations: [...] }]` in the session setup — so prose
neither grants nor withholds them. Her one tool (`save_brand`) is wired in `lib/live-voice.ts`.

## The files

| File | Carries | Changed by |
|---|---|---|
| `identity.md` | Who she is; the five references (Bulma · Shuri · Janet · Jarvis · Stark) | rarely — this is bedrock |
| `soul.md` | Voice, temperament, self-talk. Witty, hotsauce, never rude, complimentary and specific | when she sounds wrong |
| `user.md` | Who she works for; what she remembers (the PROCESS that earned praise, not the artifact) | when the creator model changes |
| `conversation.md` | Turn length (~30 words), consent for more room, options-not-decisions, net-new every turn, follow don't funnel, how she opens | when the rhythm is off |
| `guardrails.md` | Never calls an idea bad; the narrow refusals; what is explicitly fine; failure behaviour | with `lib/content-safety.ts`, together |
| `jobs/brand.md` | The brand interview | |
| `jobs/design.md` | The design riff | |
| `jobs/assets.md` | Website graphics | |
| `jobs/critique.md` | Editing a live site | |
| `jobs/status.md` | How their business is doing | |

## Modes — one agent, several jobs

`buildPersona(mode, ctx)` in `lib/eve-persona.ts` picks which job files ride along:

| Mode | Jobs | Used by |
|---|---|---|
| `interview` | brand | a creator with no brands yet |
| `central` | design · assets · status | a returning creator (her home surface) |
| `critique` | critique | the live-site editing view (+ `VOCABULARY_BRIEF` as reference) |

Runtime context — their name, their brands, site status, opener memory (`lib/eve-openers.ts`) — is
injected as a **## Right now** section between the rules and the guardrails. It is never written
into the markdown.

## How these reach the model

A composer assembles `identity + soul + user + conversation + job(mode) + guardrails` into ONE
string, sent as `systemInstruction` in the Live API setup message. Three consequences:

1. **Order matters** — persona first, guardrails last (Google's guidance).
2. **Size matters** — Google warns against multi-page instructions; the composer enforces a budget.
3. **It is read ONCE, at connect.** Editing a file mid-session changes nothing; the socket has to
   reconnect. (Same shape as OpenClaw's "restart the gateway" gotcha.)

React Native can't import `.md`, so a codegen step compiles these into a typed string module.
Verification of that pipeline — build assertion, wire-hash log, probe scores, and a deliberate
negative control — is specified in [`../../docs/studio/EVE_PERSONALITY.md`](../../docs/studio/EVE_PERSONALITY.md).

## Editing her

1. Edit the markdown.
2. `npm run eve:persona` — regenerates `persona.generated.ts` (never edit that file by hand;
   `npm run eve:persona -- --check` fails if it's stale).
3. **Start a new session** — the instruction is read at connect, so a live session keeps the old
   character.
4. Score it: [`testing/README.md`](testing/README.md) — the ElevenLabs voice rig, the ten probes and
   the negative control.

Sources for the content: Joe's interview, 2026-08-19 (recorded in
[`../../docs/studio/EVE_PERSONALITY.md`](../../docs/studio/EVE_PERSONALITY.md)).
