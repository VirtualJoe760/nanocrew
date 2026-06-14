// Seedance 2 — image-to-video generation. We feed it a Nano Banana on-model scene still (a
// public Cloudinary URL — Seedance requires an https URL on a public IP, no data URLs) and it
// animates the person doing the thing, with an audio track. Async: submit → poll → download.
// API reference: https://seedance2.so/docs/api/generate
// Env: SEEDANCE_API_KEY (required) · SEEDANCE_API_BASE (optional override).
const BASE = process.env.SEEDANCE_API_BASE || 'https://seedance2.so';

export type SceneAspect = '9:16' | '16:9';

export async function generateSeedanceVideo(opts: {
  imageUrl: string; // first frame — a public https URL (Cloudinary)
  prompt: string; // the motion/action to animate
  aspectRatio: SceneAspect;
  durationSec?: number; // 4–15, default 5
  resolution?: '480p' | '720p'; // default 720p
  model?: 'seedance-2.0' | 'seedance-2.0-fast'; // default fast (cheaper, good)
  audio?: boolean; // default true
}): Promise<Buffer> {
  const key = process.env.SEEDANCE_API_KEY;
  if (!key) throw new Error('SEEDANCE_API_KEY not configured — add it to .env.local (Seedance dashboard → API Keys).');
  const auth = { Authorization: `Bearer ${key}` };

  // 1) Submit the image-to-video task → 201 { id: "task_…", status, credits_charged }.
  const create = await fetch(`${BASE}/api/v1/video/generate`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model ?? 'seedance-2.0-fast',
      type: 'image-to-video',
      prompt: opts.prompt.slice(0, 2000),
      image_url: opts.imageUrl,
      duration: opts.durationSec ?? 5,
      resolution: opts.resolution ?? '720p',
      aspect_ratio: opts.aspectRatio,
      enable_audio: opts.audio ?? true,
    }),
  });
  if (!create.ok) {
    const txt = (await create.text()).slice(0, 300);
    if (create.status === 402) throw new Error('Seedance: insufficient credits on the Seedance account.');
    if (create.status === 401) throw new Error('Seedance: unauthorized — check SEEDANCE_API_KEY.');
    throw new Error(`seedance generate failed: ${create.status} ${txt}`);
  }
  const { id } = (await create.json()) as { id?: string };
  if (!id) throw new Error('seedance returned no task id');

  // 2) Poll GET /api/v1/video/task/{id} until succeeded. video_url expires in 24h → download now.
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 6000)); // ~5 min budget
    const st = await fetch(`${BASE}/api/v1/video/task/${id}`, { headers: auth });
    if (!st.ok) continue;
    const d = (await st.json()) as { status?: string; video_url?: string; error?: string };
    if (d.status === 'succeeded' && d.video_url) {
      const dl = await fetch(d.video_url);
      if (!dl.ok) throw new Error(`seedance download failed: ${dl.status}`);
      return Buffer.from(await dl.arrayBuffer());
    }
    if (d.status === 'failed') throw new Error(`seedance task failed: ${d.error ?? 'unknown'}`);
  }
  throw new Error('seedance task timed out');
}
