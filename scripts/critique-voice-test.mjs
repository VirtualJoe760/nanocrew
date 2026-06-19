// Verifies the CRITIQUE-view voice config (continuous open-mic, custom critique instruction, NO
// brand tool) against the real Gemini Live API. Mirrors useLiveVoice in site-preview.tsx.
import 'dotenv/config';
import { GoogleGenAI, Modality } from '@google/genai';
const apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY;
if (!apiKey) { console.error('no key'); process.exit(1); }
const MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';
// = src/lib/live-voice.ts critiqueInstruction()
const SYSTEM = `You are VENUS — Nano Crew's warm AI site assistant, on a live call with a creator who is LOOKING at their existing storefront and wants to change things. This is NOT a new brand. They circle a spot on the page and tell you the change they want; the app logs each change as they go and builds a preview when they submit.
Be brief and natural — this is a back-and-forth while they point at things. When they describe a change, confirm it in ONE short sentence so they know you caught it, and invite the next one ("got it — what else?"). Don't lecture, don't ask for a brand name or products, don't recite style options, and don't read code or hex codes aloud. When they say that's everything, tell them to tap Submit and you'll build a preview to review.`;
const GREETING = "(The creator just opened the live view of their site to edit it. In ONE short sentence, greet them and tell them to circle anything they want to change and just say the adjustment — you'll note each one.)";
const SCRIPT = ["Make this hero image full width.", "And this headline should say Ride the Tide.", "That's everything."];
const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });
let idx = 0, buf = '';
const to = setTimeout(() => { console.error('timeout'); process.exit(2); }, 70000);
const s = await ai.live.connect({ model: MODEL, config: { responseModalities: [Modality.AUDIO], systemInstruction: SYSTEM, outputAudioTranscription: {} },
  callbacks: {
    onopen: () => console.log('● ws open'),
    onmessage: (m) => {
      if (m.setupComplete) { console.log('● setupComplete'); send(GREETING, true); return; }
      if (m.toolCall) console.error('✖ UNEXPECTED tool call:', JSON.stringify(m.toolCall));
      const sc = m.serverContent;
      if (sc?.outputTranscription?.text) buf += sc.outputTranscription.text;
      if (sc?.turnComplete) { if (buf.trim()) console.log(`\nVENUS: ${buf.trim()}`); buf = '';
        if (idx < SCRIPT.length) send(SCRIPT[idx++]); else { console.log('\n✅ critique conversation OK (no tool, concise)'); clearTimeout(to); s.close(); process.exit(0); } }
    },
    onerror: (e) => { console.error('ws error', e?.message); process.exit(3); },
    onclose: () => {},
  } });
function send(t, hidden) { if (!hidden) console.log(`\nYOU: ${t}`); s.sendClientContent({ turns: [{ role: 'user', parts: [{ text: t }] }], turnComplete: true }); }
