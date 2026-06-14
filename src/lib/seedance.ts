// Seedance 2 — image-to-video generation. Async: create a task, poll until it's done, return
// the rendered clip bytes. We feed it a Nano Banana on-model scene image (see scene-video.ts) so
// the person is actually wearing the garment, then Seedance brings the scene to life.
//
// ⚠️ The public Seedance page doesn't publish endpoint paths / field names. The request+response
// shapes below follow the documented pattern (Bearer auth, task id + poll) but MUST be verified
// against the real API reference in your Seedance dashboard — adjust the marked fields there.
// Env: SEEDANCE_API_KEY (required) · SEEDANCE_API_BASE (optional override).
const BASE = process.env.SEEDANCE_API_BASE || 'https://api.seedance2.so';

export type SceneAspect = '9:16' | '16:9';

export async function generateSeedanceVideo(opts: {
  imageUrl?: string; // hosted scene image (preferred)
  imageBase64?: string; // …or inline base64 (png)
  prompt: string; // the motion/action to animate
  aspectRatio: SceneAspect;
  durationSec?: number; // 4–10 per the docs
}): Promise<Buffer> {
  const key = process.env.SEEDANCE_API_KEY;
  if (!key) {
    throw new Error('SEEDANCE_API_KEY not configured — add it to .env.local (Seedance dashboard → API key).');
  }
  const auth = { Authorization: `Bearer ${key}` };

  // 1) Create the image-to-video task. ── VERIFY fields against the Seedance API reference ──
  const create = await fetch(`${BASE}/v1/tasks`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'seedance-2',
      mode: 'image-to-video',
      prompt: opts.prompt,
      image: opts.imageUrl ?? (opts.imageBase64 ? `data:image/png;base64,${opts.imageBase64}` : undefined),
      aspect_ratio: opts.aspectRatio,
      duration: opts.durationSec ?? 5,
      resolution: '1080p',
    }),
  });
  if (!create.ok) throw new Error(`seedance create failed: ${create.status} ${(await create.text()).slice(0, 300)}`);
  const created = (await create.json()) as { id?: string; task_id?: string };
  const taskId = created.id ?? created.task_id;
  if (!taskId) throw new Error('seedance returned no task id');

  // 2) Poll until the task succeeds (docs: ~under a minute for a 5s clip).
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const st = await fetch(`${BASE}/v1/tasks/${taskId}`, { headers: auth });
    if (!st.ok) continue;
    const d = (await st.json()) as { status?: string; video_url?: string; output?: { url?: string }; error?: string };
    const status = (d.status ?? '').toLowerCase();
    const url = d.video_url ?? d.output?.url;
    if ((status === 'succeeded' || status === 'completed') && url) {
      const dl = await fetch(url);
      if (!dl.ok) throw new Error(`seedance download failed: ${dl.status}`);
      return Buffer.from(await dl.arrayBuffer());
    }
    if (status === 'failed' || status === 'error') throw new Error(`seedance task failed: ${d.error ?? 'unknown'}`);
  }
  throw new Error('seedance task timed out');
}
