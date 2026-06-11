import { GoogleGenAI } from '@google/genai';

// Veo 3 product videos for the feed. COST CONTROL: this is the most expensive call in
// the platform (dollars per clip) — only invoked explicitly (seeding/curation), cached
// on the product row, never on-demand per viewer. veo-3 "fast" keeps the price down.
const MODEL = 'veo-3.0-fast-generate-001';

export async function generateProductVideo(opts: {
  prompt: string;
  imageUrl?: string; // product mockup → image-to-video
}): Promise<Buffer> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_GENAI_API_KEY not configured');
  const ai = new GoogleGenAI({ apiKey });

  let image: { imageBytes: string; mimeType: string } | undefined;
  if (opts.imageUrl) {
    const res = await fetch(opts.imageUrl);
    if (!res.ok) throw new Error(`Failed to fetch product image (${res.status})`);
    image = {
      imageBytes: Buffer.from(await res.arrayBuffer()).toString('base64'),
      mimeType: res.headers.get('content-type') ?? 'image/png',
    };
  }

  let operation = await ai.models.generateVideos({
    model: MODEL,
    prompt: opts.prompt,
    ...(image ? { image } : {}),
    config: { aspectRatio: '9:16' },
  });

  // Veo renders take 1–4 minutes.
  for (let i = 0; i < 40 && !operation.done; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    operation = await ai.operations.getVideosOperation({ operation });
  }
  if (!operation.done) throw new Error('Veo render timed out');

  const video = operation.response?.generatedVideos?.[0]?.video;
  if (!video?.uri) throw new Error('Veo returned no video');

  const dl = await fetch(`${video.uri}${video.uri.includes('?') ? '&' : '?'}key=${apiKey}`);
  if (!dl.ok) throw new Error(`Video download failed (${dl.status})`);
  return Buffer.from(await dl.arrayBuffer());
}
