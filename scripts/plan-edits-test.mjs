// Verifies /api/creator/plan-site-edits classify: a fragmented image request + a text edit + closers
// → {images:[{slot:'hero',prompt}], edits:['change the headline...']}. Mirrors the endpoint's SYSTEM.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { GoogleGenAI } from '@google/genai';
const apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY;
if (!apiKey) { console.error('no key'); process.exit(1); }
const SYSTEM = `You read a short conversation in which a creator described changes to their EXISTING brand website (they were circling parts of the page and talking). Output ONLY JSON of the shape:
{"images":[{"slot":"hero|logo|og","prompt":"<vivid description of the image to generate>"}],"edits":["<other change as a short imperative>"]}
Rules:
- "images" = ONLY requests to GENERATE brand-NEW artwork for a known slot: the hero image (slot "hero"), the logo (slot "logo"), or the social/share card (slot "og"). The prompt must be a clear, vivid image description (combine the whole conversation so a fragmented ask like "change the hero" + "a beach at sunset" becomes one prompt). Only include an image when the creator clearly wants it generated.
- "edits" = EVERY other change in plain imperative words.
- IGNORE greetings, acknowledgements, confirmations ("yes","do it","that's it"), and anything that isn't an actual change.
- If unsure whether something is a new-image generation, put it in "edits".`;
const convo = [
  ['user',"Let's change the hero image."],
  ['model',"Want me to generate that for you, or you might get better results in the Design center? What should it look like?"],
  ['user',"You generate it — a faded California beach at sunset, ocean blues and warm sand."],
  ['user',"Also change the headline to Ride the Tide."],
  ['user',"Make the buttons rounder too."],
  ['user',"That's everything."],
];
const transcript = convo.map(([r,t]) => `${r==='user'?'Creator':'Venus'}: ${t}`).join('\n');
const ai = new GoogleGenAI({ apiKey });
const res = await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: [{ role:'user', parts:[{ text:`Conversation:\n${transcript}\n\nReturn the JSON plan.` }] }],
  config: { systemInstruction: SYSTEM, temperature: 0.2, responseMimeType: 'application/json' },
});
const raw = (res.text||'').trim().replace(/^```json\s*|\s*```$/g,'');
console.log('RAW:', raw);
const p = JSON.parse(raw);
const heroImg = (p.images||[]).find(i => i.slot==='hero');
const hasHeadline = (p.edits||[]).some(e => /headline|ride the tide/i.test(e));
const hasButtons = (p.edits||[]).some(e => /button|round/i.test(e));
console.log('\n✓ hero image w/ prompt:', !!heroImg && !!heroImg.prompt, heroImg?.prompt ? `("${heroImg.prompt.slice(0,60)}…")` : '');
console.log('✓ headline edit captured:', hasHeadline);
console.log('✓ buttons edit captured:', hasButtons);
console.log((heroImg && hasHeadline && hasButtons) ? '\nPASS' : '\nCHECK OUTPUT');
