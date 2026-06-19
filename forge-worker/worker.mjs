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
const PROVISION_BRANCH = '__provision__';
const TEMPLATES_REPO = process.env.TEMPLATES_REPO ?? `${GITHUB_OWNER}/nanocrew-templates`;
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
async function resolvePreviewUrl(app, branch) {
  if (!VERCEL_TOKEN) return null;
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

/** The local forge pipeline for first-time provisioning (mirror of src/lib/provision.ts):
 *  sparse-clone the chosen template, write brand.json + briefs, let Claude brand it, gate on
 *  the build, push to main. brand.json/briefs come pre-built from the app via the queue. */
function buildProvisionScript({ repo, fullRepo, template, brandJson, brandBrief, testBrief }) {
  return `set -e
export PATH="$HOME/.local/bin:$PATH"
[ -f ~/.claude-env ] && source ~/.claude-env
unset ANTHROPIC_API_KEY
mkdir -p ~/stores && cd ~/stores
exec 9>".forge.lock"
flock -w 1800 9 || { echo LOCK_TIMEOUT; exit 1; }
rm -rf ${repo} ${repo}-src
git clone --depth 1 --filter=blob:none --sparse https://x-access-token:${GITHUB_TOKEN}@github.com/${TEMPLATES_REPO}.git ${repo}-src
git -C ${repo}-src sparse-checkout set templates/${template}
mkdir ${repo}
cp -R ${repo}-src/templates/${template}/. ${repo}/
rm -rf ${repo}-src ${repo}/node_modules
cd ${repo}
mkdir -p briefs
cat > brand.json <<'NANOCREW_BRAND_JSON'
${brandJson}
NANOCREW_BRAND_JSON
cat > briefs/01-BRAND.md <<'NANOCREW_BRIEF_01'
${brandBrief}
NANOCREW_BRIEF_01
cat > briefs/02-TEST.md <<'NANOCREW_BRIEF_02'
${testBrief}
NANOCREW_BRIEF_02
git init -b main -q
git remote add origin https://x-access-token:${GITHUB_TOKEN}@github.com/${fullRepo}.git
pnpm install --silent 2>&1 | tail -2
claude -p "Read briefs/01-BRAND.md and apply it to this storefront. Then verify every item in briefs/02-TEST.md and fix anything that fails." --dangerously-skip-permissions --max-turns 80 < /dev/null > /tmp/${repo}-claude.log 2>&1 || true
tail -1 /tmp/${repo}-claude.log
pnpm run build > /tmp/${repo}-build.log 2>&1 && echo "BUILD_OK" || echo "BUILD_FAILED"
git add -A
git -c user.name=nanocrew -c user.email=studio@nanocrew.app commit -q -m "Apply brand via Nanocrew studio"
# Provision authoritatively rebuilds the repo from the template + brand data (fresh git init), so
# force main — a re-provision (rebuild) of an existing brand repo would otherwise be rejected as a
# non-fast-forward. (Creator edits ride revision/* branches, not main.)
git push -q -f -u origin main
echo "FORGE_DONE"
`;
}

/** Create the Vercel project (idempotent) and kick the first production deploy. */
async function deployToVercel(fullRepo, repo) {
  if (!VERCEL_TOKEN) return null;
  const headers = { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' };
  const proj = await fetch('https://api.vercel.com/v11/projects', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: repo, framework: 'nextjs', gitRepository: { type: 'github', repo: fullRepo } }),
  });
  if (!proj.ok && proj.status !== 409) {
    throw new Error(`vercel project create failed: ${proj.status} ${(await proj.text()).slice(0, 300)}`);
  }
  // Creators have no Vercel account — make preview/production deployments publicly reviewable by
  // disabling Vercel Authentication (Deployment Protection). Idempotent; non-fatal.
  await fetch(`https://api.vercel.com/v9/projects/${repo}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ ssoProtection: null }),
  }).catch(() => {});
  const repoRes = await fetch(`https://api.github.com/repos/${fullRepo}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
  });
  if (!repoRes.ok) throw new Error(`github repo lookup failed: ${repoRes.status}`);
  const repoId = (await repoRes.json()).id;
  const dep = await fetch('https://api.vercel.com/v13/deployments', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: repo, project: repo, target: 'production', gitSource: { type: 'github', repoId, ref: 'main' } }),
  });
  if (!dep.ok) throw new Error(`vercel deploy failed: ${dep.status} ${(await dep.text()).slice(0, 300)}`);
  return `https://${repo}.vercel.app`;
}

/** Deploy a revision BRANCH as a Vercel preview via the API (the projects aren't wired for
 *  push-triggered previews), then poll it to READY. Mirrors deployToVercel but ref=branch + no
 *  production target. Returns the preview URL, or null if it never readies. */
async function deployPreview(fullRepo, repo, branch) {
  if (!VERCEL_TOKEN) return null;
  const headers = { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' };
  try {
    const repoRes = await fetch(`https://api.github.com/repos/${fullRepo}`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
    });
    if (!repoRes.ok) return null;
    const repoId = (await repoRes.json()).id;
    const dep = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: repo, project: repo, gitSource: { type: 'github', repoId, ref: branch } }),
    });
    if (!dep.ok) return null;
    const { id, url } = await dep.json();
    for (let i = 0; i < 30; i++) {
      const r = await fetch(`https://api.vercel.com/v13/deployments/${id}`, { headers });
      const s = await r.json();
      if (s.readyState === 'READY') return `https://${s.url}`;
      if (s.readyState === 'ERROR' || s.readyState === 'CANCELED') return null;
      await new Promise((res) => setTimeout(res, 10_000));
    }
    return url ? `https://${url}` : null;
  } catch {
    return null;
  }
}

/** Push the creator when their preview is ready (or an edit failed). Mirrors src/lib/notify.ts,
 *  but the worker marks revisions ready ON the box, so it must send the push itself. Never throws. */
async function notifyCreator(storeId, title, body, data) {
  try {
    const [s] = await sql`select creator_id as "creatorId" from stores where id = ${storeId}`;
    if (!s) return;
    const rows = await sql`select token from device_tokens where creator_id = ${s.creatorId}`;
    const messages = rows
      .map((r) => r.token)
      .filter((t) => typeof t === 'string' && t.startsWith('ExponentPushToken'))
      .map((to) => ({ to, title, body, sound: 'default', data }));
    if (!messages.length) return;
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    }).catch(() => {});
  } catch (e) {
    log(`notify failed: ${e?.message || e}`);
  }
}

/** Run one first-time provision job, then flip the store to 'ready' with its deploy URL. */
async function processProvision(row) {
  let payload;
  try {
    payload = JSON.parse(row.requestMd);
  } catch {
    await sql`update store_revisions set status = 'failed', error_msg = 'bad provision payload' where id = ${row.id}`;
    await sql`update stores set status = 'ready' where id = ${row.storeId}`.catch(() => {});
    return;
  }
  const repo = `store-${payload.slug}`;
  const fullRepo = `${GITHUB_OWNER}/${repo}`;
  log(`▶ provision ${row.id} (${payload.slug}) template ${payload.template}`);
  try {
    const script = buildProvisionScript({
      repo,
      fullRepo,
      template: payload.template,
      brandJson: payload.brandJson,
      brandBrief: payload.brandBrief,
      testBrief: payload.testBrief,
    });
    const out = await run('bash', ['-s'], { input: script, timeoutMs: 45 * 60 * 1000 });
    if (!out.includes('FORGE_DONE')) throw new Error('forge provision did not complete');
    if (out.includes('BUILD_FAILED')) log(`  build failing for ${repo}`);
    const url = await deployToVercel(fullRepo, repo);
    await sql`update stores set deployment_url = ${url ?? `https://github.com/${fullRepo}`}, status = 'ready' where id = ${row.storeId}`;
    await sql`update store_revisions set status = 'ready', preview_url = ${url} where id = ${row.id}`;
    log(`✓ provision ${row.id} ready — ${url ?? 'no url'}`);
    await notifyCreator(row.storeId, `${row.storeName} — your site is ready`, 'Your storefront is built. Open Studio to review it.', { kind: 'provision_ready', storeId: row.storeId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'provision failed';
    log(`✗ provision ${row.id} failed — ${msg}`);
    await sql`update stores set status = 'ready' where id = ${row.storeId}`.catch(() => {});
    await sql`update store_revisions set status = 'failed', error_msg = ${msg.slice(0, 500)} where id = ${row.id}`;
    await notifyCreator(row.storeId, `${row.storeName} — build didn’t finish`, 'Your site build hit a snag. Open Studio to try again.', { kind: 'provision_failed', storeId: row.storeId });
  }
}

async function processOne() {
  // Oldest queued revision (single worker → no row lock needed). Join the store for slug/name.
  const [row] = await sql`
    select r.id, r.request_md as "requestMd", r.branch, r.screenshots, r.store_id as "storeId",
           s.slug, s.name as "storeName", s.repo as "repo"
    from store_revisions r join stores s on s.id = r.store_id
    where r.status = 'building'
    order by r.created_at asc
    limit 1`;
  if (!row) return false;

  // Provision jobs reuse this queue but run a different (first-time) pipeline.
  if (row.branch === PROVISION_BRANCH) {
    await processProvision(row);
    return true;
  }

  // Bespoke/imported brands set stores.repo to their actual repo; provisioned brands default to
  // store-<slug>. Same name is the Vercel project for the preview lookup.
  const repo = row.repo || `store-${row.slug}`;
  const fullRepo = `${GITHUB_OWNER}/${repo}`;
  // `screenshots` jsonb carries the circled annotations at enqueue time.
  const annotations = Array.isArray(row.screenshots) ? row.screenshots : [];
  log(`▶ revision ${row.id} (${row.slug}) branch ${row.branch} — ${annotations.length} circle(s)`);

  try {
    const script = buildScript({ repo, fullRepo, branch: row.branch, requestMd: row.requestMd, annotations });
    const out = await run('bash', ['-s'], { input: script, timeoutMs: 30 * 60 * 1000 });
    if (!out.includes('REVISE_DONE')) throw new Error('forge revision did not complete');
    if (out.includes('BUILD_FAILED')) log(`  build failing on ${row.branch}`);

    const previewUrl = await deployPreview(fullRepo, repo, row.branch);
    await sql`update store_revisions set status = 'ready', preview_url = ${previewUrl} where id = ${row.id}`;
    log(`✓ revision ${row.id} ready — ${previewUrl ?? 'no preview url'}`);
    // slug + name let the tapped push deep-link straight to that store's Edit/review in the app.
    await notifyCreator(row.storeId, `${row.storeName} — changes ready`, 'Your update is on a preview. Tap to review and publish it.', { kind: 'revision_ready', storeId: row.storeId, slug: row.slug, name: row.storeName });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'revise failed';
    log(`✗ revision ${row.id} failed — ${msg}`);
    await sql`update store_revisions set status = 'failed', error_msg = ${msg.slice(0, 500)} where id = ${row.id}`;
    await notifyCreator(row.storeId, `${row.storeName} — change didn’t take`, 'That edit didn’t apply. Open Studio to try rewording it.', { kind: 'revision_failed', storeId: row.storeId });
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
