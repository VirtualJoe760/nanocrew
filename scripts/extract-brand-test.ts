// Proves the "Build my brand" finalize path: given a spoken transcript (what the user said + what
// Venus said back during the Live conversation), the TEXT model + the real interviewSystem/parseTurn
// returns a structured BrandResult — WITHOUT depending on the native-audio save_brand tool call.
// This is the exact logic in src/app/api/extract-brand+api.ts. Run: node_modules/.bin/tsx scripts/extract-brand-test.ts
import { config } from 'dotenv';
config({ path: '.env.local' });
import { GoogleGenAI } from '@google/genai';
import { interviewSystem, parseTurn, type ChatMessage } from '../src/lib/interview';

const apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY;
if (!apiKey) { console.error('no GEMINI key'); process.exit(1); }

// A realistic two-sided transcript, as LiveVoiceSession.getTranscript() would accumulate it.
const transcript: ChatMessage[] = [
  { role: 'user', text: 'Hey! I want to start a streetwear brand called Riptide.' },
  { role: 'assistant', text: 'Riptide — love it, that has motion and edge. What feeling do you want it to give off?' },
  { role: 'user', text: "It's skate-inspired, kind of a faded California coast vibe. Ocean blues and sun-bleached sand colors." },
  { role: 'assistant', text: 'Beautiful — washed-out coastal palette. Are we going bold and graphic, or more minimal?' },
  { role: 'user', text: "Bold and street — big logo, editorial feel. I don't have a logo yet, maybe a wave glyph." },
  { role: 'assistant', text: 'A wave glyph as the mark, big and confident. What do you want to sell first?' },
  { role: 'user', text: 'I want to sell heavyweight tees, a hoodie, and a soft tote to start.' },
  { role: 'assistant', text: 'Great starter lineup. Anything special for the site itself?' },
  { role: 'user', text: "On the site I'd love a big full-screen photo at the top and a scrolling ticker. That's everything — let's build it!" },
];

const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];

async function main() {
  const ai = new GoogleGenAI({ apiKey });
  const history = transcript.map((m) => ({
    role: m.role === 'user' ? ('user' as const) : ('model' as const),
    parts: [{ text: m.text }],
  }));

  const res = await ai.models.generateContent({
    model: MODELS[0],
    contents: [
      ...history,
      {
        role: 'user',
        parts: [{
          text: 'The interview is complete. Based on the whole conversation above, output the FINAL brand now — respond with done:true and the full brand object per the contract. Make sensible, on-brand choices for anything not explicitly discussed.',
        }],
      },
    ],
    config: { systemInstruction: interviewSystem('Joe'), temperature: 0.7, responseMimeType: 'application/json' },
  });

  const raw = res.text?.trim();
  if (!raw) { console.error('empty response'); process.exit(2); }
  const turn = parseTurn(raw);
  if (!turn.brand) {
    console.error('❌ no brand extracted. raw turn:\n', JSON.stringify(turn, null, 2));
    process.exit(3);
  }
  console.log('✅ brand extracted from transcript:\n');
  console.log(JSON.stringify(turn.brand, null, 2));
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
