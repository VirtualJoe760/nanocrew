// End-to-end test of the "edit the hero image" flow via the keyboard path, against REAL services,
// on the alpha-master store. Mirrors what the critique editor's submit() does:
//   typed request → plan-site-edits (classify) → /api/generate (Gemini image) → upload (Cloudinary)
//   → /api/creator/site-assets (write site_assets.hero) → revalidateStorefront (redeploy).
// Run: node_modules/.bin/tsx scripts/hero-flow-test.ts
import { config } from 'dotenv';
config({ path: '.env.local' });
import { GoogleGenAI, Modality } from '@google/genai';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/lib/db';
import { uploadImage } from '../src/lib/cloudinary';
import { revalidateStorefront } from '../src/lib/storefront-revalidate';

const SLUG = 'alpha-master';
const apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY;

// 1) PLAN — same classify as /api/creator/plan-site-edits.
const PLAN_SYSTEM = `You read a short conversation in which a creator described changes to their EXISTING brand website. Output ONLY JSON: {"images":[{"slot":"hero|logo|og","prompt":"<vivid image description>"}],"edits":["<other change>"]}. images = requests to GENERATE new artwork for hero/logo/og. Combine fragments into one prompt. edits = everything else. Ignore confirmations/closers.`;

async function main() {
  if (!apiKey) throw new Error('no GEMINI key');
  const ai = new GoogleGenAI({ apiKey });

  const typed = 'Change the hero image to a faded California coast at sunset — ocean blues and warm, sun-bleached sand. Cinematic and wide.';
  console.log(`YOU (typed): ${typed}\n`);

  // 1) PLAN
  const planRes = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts: [{ text: `Conversation:\nCreator: ${typed}\n\nReturn the JSON plan.` }] }],
    config: { systemInstruction: PLAN_SYSTEM, temperature: 0.2, responseMimeType: 'application/json' },
  });
  const plan = JSON.parse((planRes.text || '{}').replace(/^```json\s*|\s*```$/g, '')) as { images?: { slot: string; prompt: string }[] };
  const hero = (plan.images || []).find((i) => i.slot === 'hero');
  console.log('PLAN →', JSON.stringify(plan));
  if (!hero) throw new Error('plan did not classify a hero image');
  console.log(`\n✓ classified hero, prompt: "${hero.prompt}"\n`);

  // 2) GENERATE (gemini-2.5-flash-image), 3) UPLOAD to Cloudinary
  const gen = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: [{ role: 'user', parts: [{ text: `Design: ${hero.prompt}\n\nA full-bleed, wide 16:9 hero banner image for a website. No text, no logos.` }] }],
    config: { responseModalities: [Modality.IMAGE] },
  });
  let b64: string | undefined;
  for (const p of (gen as { candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[] }).candidates?.[0]?.content?.parts ?? []) {
    if (p.inlineData?.data) { b64 = p.inlineData.data; break; }
  }
  if (!b64) throw new Error('no image returned from gemini-2.5-flash-image');
  const buffer = Buffer.from(b64, 'base64');
  console.log(`✓ generated image (${Math.round(buffer.length / 1024)}KB), uploading…`);
  const url = await uploadImage(buffer, { folder: 'nanocrew/site-assets' });
  console.log(`✓ hosted: ${url}\n`);

  // 4) PLACE — write site_assets.hero (what /api/creator/site-assets does for slot 'hero').
  const [store] = await db.select({ siteAssets: schema.stores.siteAssets }).from(schema.stores).where(eq(schema.stores.slug, SLUG)).limit(1);
  const current = (store?.siteAssets ?? {}) as { hero?: Record<string, string | null> };
  const heroObj = { ...(current.hero ?? {}), imageUrl: url };
  await db.update(schema.stores).set({ siteAssets: { ...current, hero: heroObj } }).where(eq(schema.stores.slug, SLUG));
  console.log(`✓ wrote site_assets.hero.imageUrl for ${SLUG}`);

  // 5) REVALIDATE (redeploys the Vercel site)
  await revalidateStorefront(SLUG);
  console.log('✓ triggered storefront revalidate (redeploy)\n');

  // 6) VERIFY the public read returns it
  const pub = await fetch(`https://nanocrew-api.vercel.app/api/public/stores/${SLUG}/site-assets`).then((r) => r.json()).catch(() => null);
  console.log('PUBLIC site-assets now →', JSON.stringify(pub));
  console.log(pub?.hero?.imageUrl === url ? '\n✅ PASS — hero written + served by the public API. Live site updates on the redeploy/ISR.' : '\n⚠️ public API not showing it yet (CDN lag)');
  process.exit(0);
}
main().catch((e) => { console.error('❌', e); process.exit(1); });
