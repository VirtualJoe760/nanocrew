// Nanocrew forge worker — drains the revision queue ONE JOB AT A TIME on the droplet.
//
// The app API only ENQUEUES (inserts a store_revisions row, status='building', with the
// circled annotations in `screenshots`). This worker — a single persistent process on the
// forge — polls that queue and runs each revision LOCALLY (no SSH; it's already on the box),
// then resolves the Vercel preview and writes the result back. Single worker + the global
// ~/stores/.forge.lock ⇒ never two forge jobs at once (RAM-safe), and the 30-min build no
// longer depends on the app server staying alive (serverless-safe).
//
// ⚠️ The bash pipeline below MUST stay in sync with src/lib/revise.ts (same persistent-clone +
// pnpm + render + global-lock recipe). It's duplicated here so the worker stays dependency-light.
//
// Run as the `forge` user via systemd (see nanocrew-forge-worker.service). Env required:
//   DATABASE_URL, GITHUB_TOKEN, GITHUB_OWNER, VERCEL_TOKEN
import { execFile } from 'node:child_process';
import postgres from 'postgres';

const { DATABASE_URL, GITHUB_TOKEN, GITHUB_OWNER, VERCEL_TOKEN } = process.env;
if (!DATABASE_URL || !GITHUB_TOKEN || !GITHUB_OWNER) {
  console.error('[worker] missing env (need DATABASE_URL, GITHUB_TOKEN, GITHUB_OWNER)');
  process.exit(1);
}
const sql = postgres(DATABASE_URL, { prepare: false, max: 2 });
const POLL_MS = 5000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout: opts.timeoutMs ?? 120000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(`${cmd} failed: ${stderr || err.message}`)) : resolve(stdout),
    );
    if (opts.input) {
      child.stdin?.write(opts.input);
      child.stdin?.end();
    }
  });
}

/** Poll Vercel for the branch's preview deployment URL (READY). Null if not found. */
async function resolvePreviewUrl(slug, branch) {
  if (!VERCEL_TOKEN) return null;
  const app = `store-${slug}`;
  for (let i = 0; i < 18; i++) {
    try {
      const res = await fetch(`https://api.vercel.com/v6/deployments?app=${app}&limit=20`, {
        headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
      });
      const data = await res.json();
      const match = (data.deployments ?? []).find((d) => d.meta?.githubCommitRef === branch);
      if (match?.readyState === 'READY') return `https://${match.url}`;
      if (match && (match.readyState === 'ERROR' || match.readyState === 'CANCELED')) return null;
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return null;
}

/** The local forge pipeline for one revision (mirror of src/lib/revise.ts). */
function buildScript({ repo, fullRepo, branch, requestMd, annotations }) {
  const anns = (annotations ?? []).filter((a) => a?.url && Array.isArray(a.strokes) && a.strokes.length > 0).slice(0, 8);
  const annB64 = anns.length ? Buffer.from(JSON.stringify(anns)).toString('base64') : '';
  const renderShots = annB64
    ? `ANN=$(mktemp); printf '%s' '${annB64}' | base64 -d > "$ANN"; node ~/critique-shot/render.mjs "$ANN" briefs/screenshots > /tmp/${repo}-shots.log 2>&1 || true; rm -f "$ANN"`
    : '';
  const brief = `# REVISION — ${repo}

The creator requested this change to their live storefront, in their own words:

${requestMd}

${anns.length ? `Annotated screenshots are in briefs/screenshots/ — the gold circles mark exactly which areas to change. Look at them.` : ''}

Read TEMPLATE.md and VOCABULARY.md first (VOCABULARY.md maps everyday phrases to blocks
and files). Apply ONLY the requested change. Stay inside the allowed edit surface:
brand.json tokens, content/**, app/globals.css fallback vars, and composing existing
blocks inside app/*/page.tsx. NEVER add dependencies, new routes, or touch lib/api.ts,
lib/cart.tsx, platform-auth, the beacon, or the /admin pages. If a request maps to no
existing block, note it in your final message instead of inventing one. Run \`pnpm run
build\` and fix what you break.`;
  const commitMsg = `Revision (review): ${requestMd.slice(0, 60).replace(/"/g, "'").replace(/\n/g, ' ')}`;
  return `set -e
export PATH="$HOME/.local/bin:$PATH"
[ -f ~/.claude-env ] && source ~/.claude-env
unset ANTHROPIC_API_KEY
mkdir -p ~/stores && cd ~/stores
exec 9>".forge.lock"
flock -w 1800 9 || { echo LOCK_TIMEOUT; exit 1; }
AUTH="https://x-access-token:${GITHUB_TOKEN}@github.com/${fullRepo}.git"
if [ -d ${repo}/.git ]; then
  cd ${repo}
  git remote set-url origin "$AUTH"
  git fetch -q --depth 1 origin main
  git checkout -q -f main
  git reset -q --hard origin/main
  git branch -D ${branch} 2>/dev/null || true
  git clean -qfd
  git checkout -q -b ${branch}
else
  rm -rf ${repo}
  git clone -q --depth 1 "$AUTH" ${repo}
  cd ${repo}
  git checkout -q -b ${branch}
fi
mkdir -p briefs/screenshots
N=$(ls briefs/03-REVISION-*.md 2>/dev/null | wc -l | tr -d ' ')
BRIEF="briefs/03-REVISION-$((N+1)).md"
cat > "$BRIEF" <<'NANOCREW_REVISION_EOF'
${brief}
NANOCREW_REVISION_EOF
${renderShots}
pnpm install --silent 2>&1 | tail -1
claude -p "Read $BRIEF and look at any images in briefs/screenshots/, then apply exactly that change. Then run pnpm run build and fix anything you broke." --dangerously-skip-permissions --max-turns 60 < /dev/null > /tmp/${repo}-revise.log 2>&1 || true
pnpm run build > /tmp/${repo}-revise-build.log 2>&1 && echo BUILD_OK || echo BUILD_FAILED
rm -rf briefs/screenshots
git add -A
git -c user.name=nanocrew -c user.email=studio@nanocrew.app commit -q -m "${commitMsg}" || true
git push -q -u origin ${branch}
echo REVISE_DONE
`;
}

async function processOne() {
  // Oldest queued revision (single worker → no row lock needed). Join the store for slug/name.
  const [row] = await sql`
    select r.id, r.request_md as "requestMd", r.branch, r.screenshots, r.store_id as "storeId",
           s.slug, s.name as "storeName"
    from store_revisions r join stores s on s.id = r.store_id
    where r.status = 'building'
    order by r.created_at asc
    limit 1`;
  if (!row) return false;

  const repo = `store-${row.slug}`;
  const fullRepo = `${GITHUB_OWNER}/${repo}`;
  // `screenshots` jsonb carries the circled annotations at enqueue time.
  const annotations = Array.isArray(row.screenshots) ? row.screenshots : [];
  log(`▶ revision ${row.id} (${row.slug}) branch ${row.branch} — ${annotations.length} circle(s)`);

  try {
    const script = buildScript({ repo, fullRepo, branch: row.branch, requestMd: row.requestMd, annotations });
    const out = await run('bash', ['-s'], { input: script, timeoutMs: 30 * 60 * 1000 });
    if (!out.includes('REVISE_DONE')) throw new Error('forge revision did not complete');
    if (out.includes('BUILD_FAILED')) log(`  build failing on ${row.branch}`);

    const previewUrl = await resolvePreviewUrl(row.slug, row.branch);
    await sql`update store_revisions set status = 'ready', preview_url = ${previewUrl} where id = ${row.id}`;
    log(`✓ revision ${row.id} ready — ${previewUrl ?? 'no preview url'}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'revise failed';
    log(`✗ revision ${row.id} failed — ${msg}`);
    await sql`update store_revisions set status = 'failed', error_msg = ${msg.slice(0, 500)} where id = ${row.id}`;
  }
  return true;
}

async function main() {
  log('forge worker up — draining store_revisions one at a time');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let did = false;
    try {
      did = await processOne();
    } catch (e) {
      log('[worker] loop error:', e instanceof Error ? e.message : e);
    }
    if (!did) await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  console.error('[worker] fatal', e);
  process.exit(1);
});
