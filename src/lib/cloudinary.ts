// Server-side Cloudinary uploads via the signed REST API (NOT the `cloudinary` SDK).
// The SDK's upload_stream silently fails inside `expo serve`'s per-request realm
// (Railway), which broke design image hosting and the TTS cache. A plain signed
// `fetch` works in any runtime. Uses the API secret — server-only.

const CLOUD = process.env.CLOUDINARY_CLOUD_NAME ?? '';
const API_KEY = process.env.CLOUDINARY_API_KEY ?? '';
const API_SECRET = process.env.CLOUDINARY_API_SECRET ?? '';

async function cloudinaryUpload(
  buffer: Buffer,
  resourceType: 'image' | 'video' | 'raw',
  extra: Record<string, string>,
): Promise<string> {
  if (!CLOUD || !API_KEY || !API_SECRET) throw new Error('Cloudinary is not configured');
  const timestamp = Math.floor(Date.now() / 1000).toString();

  // Cloudinary signature: SHA1 of the sorted "key=value&…" params (everything except
  // file/api_key/resource_type/cloud_name/signature) with the API secret appended.
  const signParams: Record<string, string> = { ...extra, timestamp };
  const toSign = Object.keys(signParams)
    .sort()
    .map((k) => `${k}=${signParams[k]}`)
    .join('&');
  const { createHash } = await import('node:crypto');
  const signature = createHash('sha1').update(toSign + API_SECRET).digest('hex');

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)]));
  form.append('api_key', API_KEY);
  form.append('timestamp', timestamp);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  form.append('signature', signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/${resourceType}/upload`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`Cloudinary ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { secure_url: string }).secure_url;
}

// Host a generated video (Veo/scene output) — returns the secure delivery URL.
export function uploadVideo(buffer: Buffer, opts?: { folder?: string }): Promise<string> {
  return cloudinaryUpload(buffer, 'video', { folder: opts?.folder ?? 'nanocrew/videos' });
}

export function uploadImage(buffer: Buffer, opts: { folder: string; publicId?: string }): Promise<string> {
  return cloudinaryUpload(buffer, 'image', {
    folder: opts.folder,
    ...(opts.publicId ? { public_id: opts.publicId } : {}),
    overwrite: 'true',
  });
}

// Host an arbitrary blob (e.g. a cached TTS JSON) at a deterministic public id, so it
// can be fetched back by URL on later requests — a cross-request cache that survives
// expo serve's per-request isolation.
export function uploadRaw(buffer: Buffer, publicId: string): Promise<string> {
  return cloudinaryUpload(buffer, 'raw', { public_id: publicId, overwrite: 'true' });
}
