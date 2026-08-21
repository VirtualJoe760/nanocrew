// KREA API client (docs/architecture/KREA_LORA.md) — LoRA training + inference for on-model
// shots of the actual garment. Endpoints verified against krea.ai docs 2026-08-15:
//   POST /styles/train      — train a LoRA ("style"): name, urls[], model, type, trigger_word,
//                             max_train_steps (min 100 charged, ≤2000). $0.003/step.
//   GET  /jobs/{id}         — poll any async job (training or generation).
//   POST /generate/image/krea/krea-2/{medium|large} — generation; accepts `styles` (trained
//                             LoRA refs). $0.030/img medium, $0.060 large.
// Billing: PREPAID USD API balance, separate from app credits — failed jobs are not charged,
// but an empty balance silently kills the feature (watchdog alerts on auth/402-class errors).

const BASE = 'https://api.krea.ai';

function key(): string {
  const k = process.env.KREA_API_KEY;
  if (!k) throw new Error('KREA_API_KEY not configured');
  return k;
}

async function kreaFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key()}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => null)) as T & { error?: unknown };
  if (!res.ok) {
    throw new Error(`krea ${path} ${res.status}: ${JSON.stringify(body?.error ?? body).slice(0, 300)}`);
  }
  return body;
}

export type KreaJobStatus =
  | 'backlogged' | 'queued' | 'scheduled' | 'processing' | 'sampling'
  | 'intermediate-complete' | 'completed' | 'failed' | 'cancelled';

export type KreaJob = {
  job_id: string;
  status: KreaJobStatus;
  created_at: string;
  completed_at: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
};

/** Train a garment LoRA. `type: 'Object'` teaches the SUBJECT (our product) rather than a style.
 *  Cost: steps × $0.003 (min 100 charged) — the standard 1000-step run is $3.00. */
export async function kreaTrainStyle(input: {
  name: string;
  imageUrls: string[];
  triggerWord: string;
  steps?: number;
  model?: 'k2' | 'k2-large' | 'flux_dev';
}): Promise<KreaJob> {
  return kreaFetch<KreaJob>('/styles/train', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      urls: input.imageUrls,
      model: input.model ?? 'k2',
      type: 'Object',
      trigger_word: input.triggerWord,
      max_train_steps: Math.min(Math.max(input.steps ?? 1000, 100), 2000),
    }),
  });
}

export async function kreaGetJob(jobId: string): Promise<KreaJob> {
  return kreaFetch<KreaJob>(`/jobs/${encodeURIComponent(jobId)}`);
}

/** Poll a job to a terminal state. Training runs take minutes — callers on serverless paths
 *  should persist the job id and let the watchdog/cron poll instead of holding a request open. */
export async function kreaAwaitJob(jobId: string, timeoutMs = 15 * 60_000, everyMs = 10_000): Promise<KreaJob> {
  const t0 = Date.now();
  for (;;) {
    const job = await kreaGetJob(jobId);
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return job;
    if (Date.now() - t0 > timeoutMs) throw new Error(`krea job ${jobId} timed out in status ${job.status}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

/** Generate an image, optionally with a trained LoRA (style). The trigger word must appear in the
 *  prompt for the subject to activate. $0.030 medium / $0.060 large. */
export async function kreaGenerate(input: {
  prompt: string;
  styleId?: string;
  size?: 'medium' | 'large';
  aspectRatio?: '1:1' | '4:3' | '3:2' | '16:9' | '4:5' | '2:3' | '9:16';
}): Promise<KreaJob> {
  return kreaFetch<KreaJob>(`/generate/image/krea/krea-2/${input.size ?? 'medium'}`, {
    method: 'POST',
    body: JSON.stringify({
      prompt: input.prompt,
      aspect_ratio: input.aspectRatio ?? '4:5',
      resolution: '1K',
      ...(input.styleId ? { styles: [{ id: input.styleId }] } : {}),
    }),
  });
}
