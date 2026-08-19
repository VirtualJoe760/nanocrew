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

Sources for the content: Joe's interview, 2026-08-19 (recorded in that report).
