// Resync the per-site config baked into each brand repo's brand.json — the only payment-relevant
// bits that live on the site itself: `apiBase` (which platform API it calls) and `commerce` (the
// fee terms the cart shows). Everything else about payment + manufacturing is centralized in
// platform-api, so this is all that can drift. Non-destructive: only those two keys are rewritten,
// all branding is preserved, no Claude/forge involved. Pushing to main triggers a Vercel redeploy.
//
// Usage:
//   node scripts/resync-brand-config.mjs            # every store that has a repo
//   node scripts/resync-brand-config.mjs <slug>     # one store
import fs from 'node:fs';
import postgres from 'postgres';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const grab = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim();

const TOKEN = grab('GITHUB_TOKEN');
const OWNER = grab('GITHUB_OWNER');
const DATABASE_URL = grab('DATABASE_URL');
if (!TOKEN || !OWNER) throw new Error('GITHUB_TOKEN / GITHUB_OWNER missing in .env.local');

// The config we want every site to carry — mirror of provision.ts.
const CONFIG = {
  apiBase: grab('PLATFORM_API_BASE') ?? '',
  commerce: {
    feeWaiveCents: Number(grab('PROCESSING_FEE_WAIVE_CENTS') ?? 20000),
    feePct: Number(grab('PROCESSING_FEE_PCT') ?? 0.029),
  },
};

const GH = 'https://api.github.com';
const ghHeaders = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'nanocrew-resync',
  'X-GitHub-Api-Version': '2022-11-28',
};

async function resyncStore(slug) {
  const path = `${GH}/repos/${OWNER}/store-${slug}/contents/brand.json`;
  const get = await fetch(path, { headers: ghHeaders });
  if (get.status === 404) return { slug, skipped: 'no repo (app-only store)' };
  if (!get.ok) return { slug, error: `read ${get.status}` };
  const file = await get.json();
  const current = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));

  const updated = { ...current, apiBase: CONFIG.apiBase, commerce: CONFIG.commerce };
  if (JSON.stringify(updated) === JSON.stringify(current)) return { slug, skipped: 'already current' };

  const put = await fetch(path, {
    method: 'PUT',
    headers: { ...ghHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'chore: resync brand.json payment config (apiBase + commerce)',
      content: Buffer.from(JSON.stringify(updated, null, 2)).toString('base64'),
      sha: file.sha,
    }),
  });
  if (!put.ok) return { slug, error: `write ${put.status} ${(await put.text()).slice(0, 160)}` };
  return { slug, updated: true };
}

const sql = postgres(DATABASE_URL, { max: 1 });
const only = process.argv[2];
const stores = only
  ? [{ slug: only }]
  : await sql`select slug from stores order by created_at`;
await sql.end();

console.log(`Resyncing brand.json config for ${stores.length} store(s)…\n  apiBase=${CONFIG.apiBase}  feeWaive=$${(CONFIG.commerce.feeWaiveCents / 100).toFixed(0)}  feePct=${CONFIG.commerce.feePct}\n`);
for (const s of stores) {
  const r = await resyncStore(s.slug);
  console.log(`  ${s.slug.padEnd(22)} ${r.updated ? '✓ updated (redeploying)' : r.skipped ? `– ${r.skipped}` : `✗ ${r.error}`}`);
}
console.log('\nUpdated sites redeploy automatically on the push to main.');
