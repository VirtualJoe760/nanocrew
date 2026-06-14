// Push platform config to ALL partner brand sites. The brand sites are thin clients — every secret
// (Stripe, Printful) lives in platform-api, NOT on the sites — but each site does bake the shared
// PUBLIC config into its brand.json: `apiBase` (which platform API it calls), `platform` (Supabase
// URL + anon key, used by the site's /admin login), and `commerce` (fee terms the cart shows). If
// any of those change (e.g. you rotate the Supabase anon key or move the API), run this to update
// every site at once. Non-destructive: only these shared keys are rewritten — branding is preserved,
// missing env values never blank an existing one, no Claude/forge. Pushing to main → Vercel redeploys.
//
// Secrets are never touched here (they aren't on the sites). To rotate a Stripe/Printful key, change
// the platform-api env — every site picks it up automatically with no push needed.
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

// The shared config every site should carry — mirror of provision.ts. Empty values are ignored on
// merge (they never overwrite a site's existing value), so a missing env can't wipe a live key.
const CONFIG = {
  apiBase: grab('PLATFORM_API_BASE') ?? '',
  platform: {
    supabaseUrl: grab('EXPO_PUBLIC_SUPABASE_URL') ?? '',
    supabaseAnonKey: grab('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY') ?? '',
  },
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

  // Merge shared config, but never blank an existing value with an empty env.
  const updated = { ...current, commerce: CONFIG.commerce };
  if (CONFIG.apiBase) updated.apiBase = CONFIG.apiBase;
  updated.platform = {
    supabaseUrl: CONFIG.platform.supabaseUrl || current.platform?.supabaseUrl,
    supabaseAnonKey: CONFIG.platform.supabaseAnonKey || current.platform?.supabaseAnonKey,
  };
  if (JSON.stringify(updated) === JSON.stringify(current)) return { slug, skipped: 'already current' };

  const put = await fetch(path, {
    method: 'PUT',
    headers: { ...ghHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'chore: push platform config to brand.json (apiBase + platform keys + commerce)',
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

const maskedKey = CONFIG.platform.supabaseAnonKey ? `${CONFIG.platform.supabaseAnonKey.slice(0, 8)}…` : '(unchanged)';
console.log(`Pushing platform config to ${stores.length} store(s)…\n  apiBase=${CONFIG.apiBase}\n  supabaseUrl=${CONFIG.platform.supabaseUrl}\n  supabaseAnonKey=${maskedKey}\n  feeWaive=$${(CONFIG.commerce.feeWaiveCents / 100).toFixed(0)}  feePct=${CONFIG.commerce.feePct}\n`);
for (const s of stores) {
  const r = await resyncStore(s.slug);
  console.log(`  ${s.slug.padEnd(22)} ${r.updated ? '✓ updated (redeploying)' : r.skipped ? `– ${r.skipped}` : `✗ ${r.error}`}`);
}
console.log('\nUpdated sites redeploy automatically on the push to main.');
