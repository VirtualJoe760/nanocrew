// fal.ai image-to-video. fal is a single gateway to every major video model, so we wire it ONCE
// and let the creator pick a model/tier. We feed a Nano Banana on-model scene still (a public
// Cloudinary https URL — fal needs a reachable URL, no data: URLs) and it animates the person.
// Async queue: submit → poll status → fetch result → download.  Env: FAL_KEY (required).
//
// The three tiers we expose (720p, prices = fal's 2026 per-second rates):
//   wan      — Wan 2.5,        ~$0.05/s · 5s ≈ $0.25  → best value
//   seedance — Seedance 2.0 fast, ~$0.242/s · 5s ≈ $1.21 → premium, cinematic + audio
//   veo3     — Veo 3,          ~$0.40/s · 8s ≈ $3.20 → top-tier realism + native audio
// Each model has a different request shape (duration encoding, aspect support), hence buildBody.
// credits = what we charge the creator; keep ≥ real cost. UI reads VIDEO_MODEL_OPTIONS via /api/creator/credits.

export type SceneAspect = '9:16' | '16:9';
export type VideoModelKey = 'wan' | 'seedance' | 'veo3';

interface BodyArgs {
  imageUrl: string;
  prompt: string;
  aspect: SceneAspect;
  audio: boolean;
}

interface VideoModelSpec {
  key: VideoModelKey;
  falModel: string; // fal queue model id
  label: string;
  blurb: string; // one-liner for the picker UI
  credits: number; // what we debit the creator
  durationSec: number; // clip length this tier renders (for display)
  buildBody: (a: BodyArgs) => Record<string, unknown>;
}

export const VIDEO_MODELS: Record<VideoModelKey, VideoModelSpec> = {
  wan: {
    key: 'wan',
    falModel: 'fal-ai/wan-25-preview/image-to-video',
    label: 'Wan 2.5',
    blurb: 'Best value · great motion',
    credits: 60, // ~$0.25 real → 60cr (~2.4×)
    durationSec: 5,
    // Wan has no aspect_ratio field — orientation is inherited from the still (Nano Banana already
    // rendered it at the chosen aspect). No generate_audio flag either.
    buildBody: ({ imageUrl, prompt }) => ({ prompt, image_url: imageUrl, duration: '5', resolution: '720p' }),
  },
  seedance: {
    key: 'seedance',
    falModel: 'bytedance/seedance-2.0/fast/image-to-video',
    label: 'Seedance 2.0',
    blurb: 'Premium · cinematic + audio',
    credits: 260, // ~$1.21 real → 260cr (~2× at the $0.01/cr floor)
    durationSec: 5,
    buildBody: ({ imageUrl, prompt, aspect, audio }) => ({
      prompt,
      image_url: imageUrl,
      duration: 5,
      resolution: '720p',
      aspect_ratio: aspect,
      generate_audio: audio,
    }),
  },
  veo3: {
    key: 'veo3',
    falModel: 'fal-ai/veo3/image-to-video',
    label: 'Veo 3',
    blurb: 'Top-tier realism + native audio',
    credits: 400, // ~$3.20 real (8s) → 400cr (~1.25×) — verify against live fal pricing
    durationSec: 8,
    buildBody: ({ imageUrl, prompt, aspect, audio }) => ({
      prompt,
      image_url: imageUrl,
      duration: '8s', // Veo encodes duration as a string
      resolution: '720p',
      aspect_ratio: aspect,
      generate_audio: audio,
    }),
  },
};

/** Lightweight catalog for the client picker (no buildBody fn). */
export const VIDEO_MODEL_OPTIONS = (Object.values(VIDEO_MODELS) as VideoModelSpec[]).map(
  ({ key, label, blurb, credits, durationSec }) => ({ key, label, blurb, credits, durationSec }),
);

export function resolveVideoModel(key?: string): VideoModelSpec {
  if (key && key in VIDEO_MODELS) return VIDEO_MODELS[key as VideoModelKey];
  const envKey = process.env.FAL_VIDEO_MODEL;
  if (envKey && envKey in VIDEO_MODELS) return VIDEO_MODELS[envKey as VideoModelKey];
  return VIDEO_MODELS.seedance; // default tier
}

interface FalSubmit {
  request_id?: string;
  status_url?: string;
  response_url?: string;
}

export async function generateFalVideo(opts: {
  imageUrl: string; // first frame — a public https URL (Cloudinary)
  prompt: string; // the motion/action to animate
  aspectRatio: SceneAspect;
  modelKey?: VideoModelKey; // default 'seedance' (or FAL_VIDEO_MODEL)
  audio?: boolean; // default true (ignored by models without audio)
}): Promise<Buffer> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY not configured — add it to .env.local (fal dashboard → Keys).');
  const spec = resolveVideoModel(opts.modelKey);
  const auth = { Authorization: `Key ${key}` };
  const body = spec.buildBody({
    imageUrl: opts.imageUrl,
    prompt: opts.prompt.slice(0, 2000),
    aspect: opts.aspectRatio,
    audio: opts.audio ?? true,
  });

  // 1) Submit to the queue → { request_id, status_url, response_url }. Use fal's returned URLs
  //    rather than reconstructing them, so model ids with sub-paths just work.
  const create = await fetch(`https://queue.fal.run/${spec.falModel}`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!create.ok) {
    const txt = (await create.text()).slice(0, 300);
    if (create.status === 401 || create.status === 403) throw new Error('fal: unauthorized — check FAL_KEY.');
    if (create.status === 402) throw new Error('fal: insufficient credits on the fal account.');
    throw new Error(`fal submit failed (${spec.label}): ${create.status} ${txt}`);
  }
  const sub = (await create.json()) as FalSubmit;
  const statusUrl = sub.status_url;
  const responseUrl = sub.response_url;
  if (!statusUrl || !responseUrl) throw new Error('fal returned no status/response url');

  // 2) Poll status until COMPLETED/FAILED. Renders ~1–4 min (Veo longer); give up at ~12.
  await new Promise((r) => setTimeout(r, 8_000)); // small head start before the first poll
  for (let i = 0; i < 90; i++) {
    const st = await fetch(statusUrl, { headers: auth });
    if (st.ok) {
      const d = (await st.json()) as { status?: string };
      if (d.status === 'COMPLETED') break;
      if (d.status === 'FAILED' || d.status === 'ERROR') throw new Error(`fal generation failed (${spec.label})`);
    }
    if (i === 89) throw new Error('fal task timed out');
    await new Promise((r) => setTimeout(r, 8000)); // ~12 min total budget
  }

  // 3) Fetch the result → { video: { url } }. The url is short-lived → download immediately.
  const res = await fetch(responseUrl, { headers: auth });
  if (!res.ok) throw new Error(`fal result fetch failed: ${res.status}`);
  const out = (await res.json()) as { video?: { url?: string } };
  const url = out.video?.url;
  if (!url) throw new Error('fal returned no video url');
  const dl = await fetch(url);
  if (!dl.ok) throw new Error(`fal video download failed: ${dl.status}`);
  return Buffer.from(await dl.arrayBuffer());
}
