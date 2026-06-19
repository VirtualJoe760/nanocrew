// Drives a full TEXT brand interview against the Gemini Live API (same model + system prompt +
// save_brand tool as the app) to verify the conversation → save_brand → BrandResult flow works,
// decoupled from device audio/connection. Run: node scripts/live-flow-test.mjs
import 'dotenv/config';
import { GoogleGenAI, Modality, Type } from '@google/genai';

const apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY;
if (!apiKey) { console.error('no GEMINI key'); process.exit(1); }

const MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';

const SYSTEM = `You are VENUS — Nano Crew's warm AI brand consultant talking with a creator starting a clothing brand. Speak in short natural sentences. Have a real conversation: react, then ask ONE question that flows from what they said. Gather: brand name (or coin one), logo direction, colors, design style (minimalist|bold|elegant|extravagant|street), how the site should feel, and the products. Don't drag it out.
CRITICAL: the ONLY way the brand is created is by CALLING the save_brand function. The moment you have a name, a design style, and the products, say one warm sentence that the brand is ready AND in that same turn CALL save_brand. Just saying "it's ready" does nothing — you MUST invoke the tool. Fill every field you can (5-color palette + fonts), guess sensible defaults for the rest.`;

const SAVE_BRAND = {
  name: 'save_brand',
  description: 'Call ONCE when you have enough, to finalize the brand and end the interview.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING }, tagline: { type: Type.STRING }, mission: { type: Type.STRING },
      audience: { type: Type.STRING }, voice: { type: Type.STRING }, story: { type: Type.STRING },
      vibeKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
      designStyle: { type: Type.STRING }, products: { type: Type.ARRAY, items: { type: Type.STRING } },
      palette: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { role: { type: Type.STRING }, hex: { type: Type.STRING } } } },
      displayFont: { type: Type.STRING }, bodyFont: { type: Type.STRING },
    },
    required: ['name', 'designStyle', 'products'],
  },
};

const SCRIPT = [
  "Hey! I want to start a streetwear brand called Riptide.",
  "It's skate-inspired, kind of a faded California coast vibe. Ocean blues and sun-bleached sand colors.",
  "Bold and street — big logo, editorial feel. I don't have a logo yet, maybe a wave glyph.",
  "I want to sell heavyweight tees, a hoodie, and a soft tote to start.",
  "On the site I'd love a big full-screen photo at the top and a scrolling ticker. That's everything — let's build it!",
];

const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });
let idx = 0;
let venusBuf = '';
let done = false;

const timeout = setTimeout(() => { console.error('\n⏱  TIMEOUT — no save_brand after the full script'); process.exit(2); }, 90000);

const session = await ai.live.connect({
  model: MODEL,
  config: {
    responseModalities: [Modality.AUDIO],
    systemInstruction: SYSTEM,
    outputAudioTranscription: {},
    tools: [{ functionDeclarations: [SAVE_BRAND] }],
  },
  callbacks: {
    onopen: () => console.log('● ws open'),
    onmessage: (m) => {
      const sc = m.serverContent;
      if (m.setupComplete) { console.log('● setupComplete → sending first turn'); send(); return; }
      if (sc?.outputTranscription?.text) venusBuf += sc.outputTranscription.text;
      const calls = m.toolCall?.functionCalls ?? [];
      for (const c of calls) {
        if (c.name === 'save_brand') {
          done = true;
          console.log('\n✅ save_brand CALLED. args:\n', JSON.stringify(c.args, null, 2));
          clearTimeout(timeout);
          session.close();
          process.exit(0);
        }
      }
      if (sc?.turnComplete) {
        if (venusBuf.trim()) console.log(`\nVENUS: ${venusBuf.trim()}`);
        venusBuf = '';
        if (!done) send();
      }
    },
    onerror: (e) => { console.error('● ws error', e?.message); process.exit(3); },
    onclose: (e) => console.log('● ws close', e?.code, e?.reason || ''),
  },
});

function send() {
  if (idx >= SCRIPT.length) {
    console.log('\n(script exhausted; waiting to see if she calls save_brand…)');
    return;
  }
  const text = SCRIPT[idx++];
  console.log(`\nYOU: ${text}`);
  session.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true });
}
