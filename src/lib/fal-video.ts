// fal.ai image-to-video. fal is a single gateway to every major video model, so we wire it ONCE
// and pick the model with an env var. We feed a Nano Banana on-model scene still (a public
// Cloudinary https URL — fal needs a reachable URL, no data: URLs) and it animates the person,
// with synchronized audio. Async queue: submit → poll status → fetch result → download.
//
//   FAL_KEY           (required)  — fal dashboard → Keys
//   FAL_VIDEO_MODEL   (optional)  — defaults to Seedance 2.0 fast (the quality we like).
//                                   Flip to 'fal-ai/wan-25/image-to-video' for ~5× cheaper clips.
//
// Per-second pricing (fal, 2026): Seedance 2.0 fast 720p ≈ $0.242/s (≈$1.21/5s); Wan 2.5 ≈ $0.05/s
// (≈$0.25/5s). Keep CREDIT_COSTS.scene_video aligned with whichever model is the default here.
// API: https://fal.ai/models/bytedance/seedance-2.0/fast/image-to-video

const DEFAULT_MODEL = 'bytedance/seedance-2.0/fast/image-to-video';

export type SceneAspect = '9:16' | '16:9';

interface FalSubmit {
  request_id?: string;
  status_url?: string;
  response_url?: string;
}

export async function generateFalVideo(opts: {
  imageUrl: string; // first frame — a public https URL (Cloudinary)
  prompt: string; // the motion/action to animate
  aspectRatio: SceneAspect;
  durationSec?: number; // 4–15, default 5
  resolution?: '480p' | '720p'; // default 720p
  model?: string; // fal model id; default Seedance 2.0 fast (or FAL_VIDEO_MODEL)
  audio?: boolean; // default true
}): Promise<Buffer> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY not configured — add it to .env.local (fal dashboard → Keys).');
  const model = opts.model ?? process.env.FAL_VIDEO_MODEL ?? DEFAULT_MODEL;
  const auth = { Authorization: `Key ${key}` };

  // 1) Submit to the queue → { request_id, status_url, response_url }. We use fal's returned URLs
  //    rather than reconstructing them, so model ids with sub-paths just work.
  const create = await fetch(`https://queue.fal.run/${model}`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: opts.prompt.slice(0, 2000),
      image_url: opts.imageUrl,
      duration: opts.durationSec ?? 5,
      resolution: opts.resolution ?? '720p',
      aspect_ratio: opts.aspectRatio,
      generate_audio: opts.audio ?? true,
    }),
  });
  if (!create.ok) {
    const txt = (await create.text()).slice(0, 300);
    if (create.status === 401 || create.status === 403) throw new Error('fal: unauthorized — check FAL_KEY.');
    if (create.status === 402) throw new Error('fal: insufficient credits on the fal account.');
    throw new Error(`fal submit failed: ${create.status} ${txt}`);
  }
  const sub = (await create.json()) as FalSubmit;
  const statusUrl = sub.status_url;
  const responseUrl = sub.response_url;
  if (!statusUrl || !responseUrl) throw new Error('fal returned no status/response url');

  // 2) Poll status until COMPLETED/FAILED. Seedance renders ~1–4 min; give up at ~12.
  await new Promise((r) => setTimeout(r, 8_000)); // small head start before the first poll
  for (let i = 0; i < 90; i++) {
    const st = await fetch(statusUrl, { headers: auth });
    if (st.ok) {
      const d = (await st.json()) as { status?: string };
      if (d.status === 'COMPLETED') break;
      if (d.status === 'FAILED' || d.status === 'ERROR') throw new Error('fal video generation failed');
    }
    if (i === 89) throw new Error('fal task timed out');
    await new Promise((r) => setTimeout(r, 8000)); // ~12 min total budget
  }

  // 3) Fetch the result → { video: { url }, seed }. The url is short-lived → download immediately.
  const res = await fetch(responseUrl, { headers: auth });
  if (!res.ok) throw new Error(`fal result fetch failed: ${res.status}`);
  const out = (await res.json()) as { video?: { url?: string } };
  const url = out.video?.url;
  if (!url) throw new Error('fal returned no video url');
  const dl = await fetch(url);
  if (!dl.ok) throw new Error(`fal video download failed: ${dl.status}`);
  return Buffer.from(await dl.arrayBuffer());
}
