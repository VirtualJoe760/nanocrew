import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { uploadImage } from '@/lib/cloudinary';
import { CREDIT_COSTS, debit, grant, InsufficientCreditsError } from '@/lib/credits';
import { db, schema } from '@/lib/db';
import { kreaGetJob, kreaTrainStyle } from '@/lib/krea';
import { guardRate } from '@/lib/rate-limit';

// AVATAR LoRAs (docs/architecture/KREA_LORA.md — the K2 phase, shipped 2026-08-20).
//
//   GET  /api/creator/avatars  → { avatars } — the creator's own models + the house library
//                                (creator_id NULL + store_id NULL). Non-terminal rows are
//                                refreshed lazily against Krea here (the forge-watchdog cron
//                                that will own polling is still unbuilt).
//   POST /api/creator/avatars  → { name?, photos: (dataURL|https)[], consent: true }
//                                Uploads the training set, debits `lora_train`, submits the
//                                Krea fine-tune and records the row. The avatar is PRIVATE to
//                                the account — never shared, never listed for others.
//
// Gated by KREA_ENABLED=1 (the Krea balance is PREPAID USD, separate from app credits —
// running it dry silently kills the feature, so ops flips this on deliberately).
// Consent: training photos must be the creator or a model who consented — the client shows the
// affirmation and this route refuses without it. Selfies arrive via lib/pick-photo (Eve's
// camera door or the library).

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const MIN_PHOTOS = 5;
const MAX_PHOTOS = 20;

function enabled(): boolean {
  return process.env.KREA_ENABLED === '1';
}

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!enabled()) return Response.json({ error: 'avatars are not enabled yet' }, { status: 503 });

  const rows = await db
    .select({
      id: schema.loras.id,
      name: schema.loras.name,
      creatorId: schema.loras.creatorId,
      status: schema.loras.status,
      styleId: schema.loras.styleId,
      kreaJobId: schema.loras.kreaJobId,
      errorMsg: schema.loras.errorMsg,
      createdAt: schema.loras.createdAt,
    })
    .from(schema.loras)
    .where(eq(schema.loras.creatorId, user.id))
    .orderBy(desc(schema.loras.createdAt));

  // Lazy refresh (≤3 per call): the watchdog cron is unbuilt, so the list is the poller.
  const pending = rows.filter((r) => !TERMINAL.has(r.status)).slice(0, 3);
  for (const row of pending) {
    try {
      const job = await kreaGetJob(row.kreaJobId);
      const result = (job.result ?? {}) as { style_id?: string; id?: string };
      const styleId = job.status === 'completed' ? (result.style_id ?? result.id ?? row.kreaJobId) : row.styleId;
      await db
        .update(schema.loras)
        .set({
          status: job.status,
          styleId,
          errorMsg: job.error,
          ...(TERMINAL.has(job.status) ? { completedAt: new Date() } : {}),
        })
        .where(eq(schema.loras.id, row.id));
      row.status = job.status;
      row.styleId = styleId ?? null;
      row.errorMsg = job.error;
    } catch {
      // Krea blip — the stale status stands until the next list call.
    }
  }

  const house = await db
    .select({ id: schema.loras.id, name: schema.loras.name, status: schema.loras.status })
    .from(schema.loras)
    .where(and(isNull(schema.loras.creatorId), isNull(schema.loras.storeId), inArray(schema.loras.status, ['completed'])))
    .orderBy(desc(schema.loras.createdAt));

  return Response.json({
    avatars: rows.map((r) => ({ id: r.id, name: r.name, status: r.status, ready: r.status === 'completed', error: r.errorMsg })),
    house: house.map((r) => ({ id: r.id, name: r.name, ready: true })),
  });
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!enabled()) return Response.json({ error: 'avatars are not enabled yet' }, { status: 503 });
  const limited = await guardRate(`avatar-train:${user.id}`, 3, 60 * 10);
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    photos?: string[];
    consent?: boolean;
  } | null;
  if (body?.consent !== true) {
    return Response.json(
      { error: 'consent required — the photos must be you, or a model who agreed to this' },
      { status: 400 },
    );
  }
  const photos = (body.photos ?? []).filter((p) => typeof p === 'string').slice(0, MAX_PHOTOS);
  if (photos.length < MIN_PHOTOS) {
    return Response.json({ error: `need at least ${MIN_PHOTOS} photos (got ${photos.length})` }, { status: 400 });
  }
  const name = (body.name?.trim() || 'My model').slice(0, 60);

  // Host the training set: data URLs → Cloudinary; already-hosted https URLs pass through.
  const imageUrls: string[] = [];
  for (const p of photos) {
    if (p.startsWith('data:')) {
      const comma = p.indexOf(',');
      if (comma < 0) continue;
      try {
        const buf = Buffer.from(p.slice(comma + 1), 'base64');
        if (buf.length > 15 * 1024 * 1024) continue; // one absurd frame must not kill the set
        imageUrls.push(await uploadImage(buf, { folder: 'nanocrew/avatars' }));
      } catch {
        // skip the frame — the count check below decides if enough survived
      }
    } else if (/^https:\/\//.test(p)) {
      imageUrls.push(p);
    }
  }
  if (imageUrls.length < MIN_PHOTOS) {
    return Response.json({ error: 'not enough usable photos after upload' }, { status: 422 });
  }

  // One-time training fee (comp accounts no-op inside debit). Refund on any failure below.
  try {
    await debit(user.id, 'lora_train');
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return Response.json({ error: 'insufficient_credits', needed: e.needed, balance: e.balance }, { status: 402 });
    }
    throw e;
  }

  try {
    const triggerWord = `nc_avatar_${crypto.randomUUID().slice(0, 8)}`;
    const steps = 1000;
    const job = await kreaTrainStyle({ name, imageUrls, triggerWord, steps });
    const [row] = await db
      .insert(schema.loras)
      .values({
        creatorId: user.id,
        name,
        photoUrls: imageUrls,
        kreaJobId: job.job_id,
        triggerWord,
        status: job.status,
        steps,
        costCents: Math.round(steps * 0.3),
      })
      .returning({ id: schema.loras.id, status: schema.loras.status });
    console.log(`[avatars] training "${name}" for ${user.id} — job ${job.job_id}`);
    return Response.json({ avatar: { id: row.id, name, status: row.status } });
  } catch (e) {
    void grant(user.id, CREDIT_COSTS.lora_train, 'refund').catch(() => {});
    return Response.json({ error: e instanceof Error ? e.message : 'training failed' }, { status: 502 });
  }
}
