// One-off: generate the Studio entity face videos (idle + talking) with Veo.
import { GoogleGenAI } from '@google/genai';
import { readFileSync, writeFileSync } from 'fs';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const apiKey = env.match(/^GOOGLE_GENAI_API_KEY=(.+)$/m)[1].trim();
const ai = new GoogleGenAI({ apiKey });

const BASE = `A stunning human face made entirely of fine glowing white wireframe mesh lines,
plexus network style with tiny particles and sparkling points of light, facing directly
toward the camera, perfectly centered, on a pure black background. The face floats in
darkness — elegant, serene, feminine, eyes softly open looking at the viewer. Fine
interconnected triangular network lines form the contours, with clusters of luminous
particles around the forehead and cheekbones. Dark sci-fi aesthetic, extremely high detail,
monochrome white-on-black. No text, no watermark, no color.`;

const CLIPS = [
  {
    name: 'entity-idle',
    prompt: `${BASE} The face is still and calm, mouth closed, with subtle ambient drift of
particles and a gentle shimmer flowing through the network lines. Slow, seamless,
meditative loop.`,
  },
  {
    name: 'entity-talking',
    prompt: `${BASE} The face is speaking warmly to the viewer — the mouth moves naturally
and expressively as if explaining something fascinating, slight head and eyebrow movement,
the network lines and particles pulse softly in rhythm with the speech.`,
  },
];

for (const clip of CLIPS) {
  console.log(`[veo] rendering ${clip.name}…`);
  let op = await ai.models.generateVideos({
    model: 'veo-3.0-fast-generate-001',
    prompt: clip.prompt,
    config: { aspectRatio: '9:16' },
  });
  for (let i = 0; i < 40 && !op.done; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    op = await ai.operations.getVideosOperation({ operation: op });
    process.stdout.write('.');
  }
  if (!op.done) throw new Error(`${clip.name} timed out`);
  const video = op.response?.generatedVideos?.[0]?.video;
  if (!video?.uri) throw new Error(`${clip.name}: no video returned`);
  const dl = await fetch(`${video.uri}${video.uri.includes('?') ? '&' : '?'}key=${apiKey}`);
  const buf = Buffer.from(await dl.arrayBuffer());
  const out = new URL(`../assets/videos/${clip.name}.mp4`, import.meta.url).pathname;
  writeFileSync(out, buf);
  console.log(`\n[veo] saved ${out} (${(buf.length / 1e6).toFixed(1)} MB)`);
}
console.log('[veo] all clips done');
