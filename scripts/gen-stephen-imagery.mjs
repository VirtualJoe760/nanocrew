import postgres from 'postgres';
import { GoogleGenAI, Modality } from '@google/genai';
import { createHash } from 'node:crypto';

// One-off owner backfill: generate real on-model lifestyle imagery for the stephen-lawyer catalogue
// via Nano Banana (gemini-2.5-flash-image), host on Cloudinary, and write products.model_shots +
// the Summer 2026 collection cover. NOT credit-charged (admin backfill). Idempotent-ish: only fills
// products that have no model_shots yet (re-run safe). Run: node --env-file=.env.local scripts/gen-stephen-imagery.mjs
const SLUG = 'stephen-lawyer';
const SHOTS_PER_PRODUCT = 2;
const POSES = [
  'a candid lifestyle photo, model in an urban setting at golden hour, shallow depth of field',
  'a clean full-body studio fashion photo, model facing forward, neutral seamless background, soft even lighting',
];

const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
const CLOUD = process.env.CLOUDINARY_CLOUD_NAME, CK = process.env.CLOUDINARY_API_KEY, CS = process.env.CLOUDINARY_API_SECRET;
const ai = new GoogleGenAI({ apiKey });
const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });

async function uploadImage(buffer, folder) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const extra = { folder, overwrite: 'true' };
  const toSign = Object.keys({ ...extra, timestamp }).sort().map((k) => `${k}=${{ ...extra, timestamp }[k]}`).join('&');
  const signature = createHash('sha1').update(toSign + CS).digest('hex');
  const body = new URLSearchParams();
  body.append('file', `data:application/octet-stream;base64,${buffer.toString('base64')}`);
  body.append('api_key', CK); body.append('timestamp', timestamp);
  for (const [k, v] of Object.entries(extra)) body.append(k, v);
  body.append('signature', signature);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, { method: 'POST', body });
  if (!res.ok) throw new Error(`Cloudinary ${res.status}`);
  return (await res.json()).secure_url;
}

async function genShot(garment, pose) {
  const prompt =
    'Using the provided image as the EXACT garment (keep its print, graphic, colour and cut faithful), render ' +
    `${pose}. The model wears this garment. Photorealistic, high-resolution fashion photography. No text or watermark.`;
  const res = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: [{ role: 'user', parts: [{ text: prompt }, garment] }],
    config: { responseModalities: [Modality.IMAGE] },
  });
  for (const part of res.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) return uploadImage(Buffer.from(part.inlineData.data, 'base64'), 'nanocrew/model-shots');
  }
  return null;
}

const [store] = await sql`select id from stores where slug = ${SLUG}`;
const products = await sql`select id, name, image_url, model_shots from products where store_id = ${store.id} and is_published = true order by created_at`;
console.log(`${products.length} published products`);

let firstShot = null;
for (const p of products) {
  const existing = Array.isArray(p.model_shots) ? p.model_shots : [];
  if (existing.length > 0) { console.log(`skip (has shots): ${p.name}`); if (!firstShot) firstShot = existing[0]; continue; }
  if (!p.image_url) { console.log(`skip (no image): ${p.name}`); continue; }
  try {
    const img = await fetch(p.image_url);
    const garment = { inlineData: { mimeType: img.headers.get('content-type') ?? 'image/jpeg', data: Buffer.from(await img.arrayBuffer()).toString('base64') } };
    const urls = [];
    for (let i = 0; i < SHOTS_PER_PRODUCT; i++) {
      try { const u = await genShot(garment, POSES[i]); if (u) urls.push(u); } catch (e) { console.log(`  pose ${i} failed: ${e.message}`); }
    }
    if (urls.length) {
      await sql`update products set model_shots = ${sql.json(urls)} where id = ${p.id}`;
      if (!firstShot) firstShot = urls[0];
      console.log(`✓ ${p.name} — ${urls.length} shots`);
    } else {
      console.log(`✗ ${p.name} — no shots produced`);
    }
  } catch (e) {
    console.log(`✗ ${p.name} — ${e.message}`);
  }
}

// Collection cover for the lookbook hero.
if (firstShot) {
  await sql`update catalogues set cover_image_url = ${firstShot} where store_id = ${store.id} and slug = 'summer-2026'`;
  console.log(`cover set → ${firstShot}`);
}
await sql.end();
console.log('done');
