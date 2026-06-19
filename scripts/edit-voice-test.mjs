// Verifies the EDIT-SITE voice config against the real Gemini Live API: the custom edit-site
// instruction + NO brand tool (enableBrandTool:false) — mirrors useLiveVoice({instruction, greeting,
// enableBrandTool:false}) used by the Console's "Edit site" composer. Drives a short text
// conversation and prints Venus's replies. Run: DOTENV_CONFIG_PATH=.env.local node scripts/edit-voice-test.mjs
import 'dotenv/config';
import { GoogleGenAI, Modality } from '@google/genai';

const apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY;
if (!apiKey) { console.error('no GEMINI key'); process.exit(1); }

const MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';

// Same text as src/lib/live-voice.ts editSiteInstruction('Riptide').
const SYSTEM = `You are VENUS — Nano Crew's warm AI site assistant, talking OUT LOUD with a creator who wants to EDIT their EXISTING brand website "Riptide". This is NOT a new brand — they already have a live site; you're just capturing the change they want made to it.

Keep it SHORT and practical. When they describe a change ("make the hero full-screen", "change the headline to …", "add an Our Story section", "rounder buttons"), reflect it back in ONE quick sentence so they know you caught it, then ask "anything else?". Don't over-talk, don't ask for a brand name or products, don't recite style options. When they're done, tell them to tap send and you'll build a preview to review. Never read JSON, code, or hex codes aloud — just talk like a person.`;

const GREETING = "(The creator just opened the site editor. In one short sentence, greet them and ask what they'd like to change about their site.)";

const SCRIPT = [
  'Make the hero image full screen and change the headline to "Ride the tide".',
  "Also add an Our Story section near the bottom.",
  "That's everything.",
];

const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });
let idx = 0;
let buf = '';
const timeout = setTimeout(() => { console.error('\n⏱ timeout'); process.exit(2); }, 70000);

const session = await ai.live.connect({
  model: MODEL,
  config: {
    responseModalities: [Modality.AUDIO],
    systemInstruction: SYSTEM,
    outputAudioTranscription: {},
    // enableBrandTool:false → NO tools registered. (Build flow adds save_brand; edit flow must not.)
  },
  callbacks: {
    onopen: () => console.log('● ws open'),
    onmessage: (m) => {
      if (m.setupComplete) { console.log('● setupComplete → greeting nudge'); send(GREETING, true); return; }
      if (m.toolCall) { console.error('✖ UNEXPECTED tool call in edit mode:', JSON.stringify(m.toolCall)); }
      const sc = m.serverContent;
      if (sc?.outputTranscription?.text) buf += sc.outputTranscription.text;
      if (sc?.turnComplete) {
        if (buf.trim()) console.log(`\nVENUS: ${buf.trim()}`);
        buf = '';
        if (idx < SCRIPT.length) send(SCRIPT[idx++]);
        else { console.log('\n✅ edit conversation completed (no brand tool, concise replies).'); clearTimeout(timeout); session.close(); process.exit(0); }
      }
    },
    onerror: (e) => { console.error('● ws error', e?.message); process.exit(3); },
    onclose: (e) => console.log('● ws close', e?.code, e?.reason || ''),
  },
});

function send(text, hidden = false) {
  if (!hidden) console.log(`\nYOU: ${text}`);
  session.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true });
}
