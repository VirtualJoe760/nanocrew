import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { notifyRevisionReady } from '@/lib/notify';

// The visual revision loop. A creator's change (markdown + annotated screenshots) is
// applied by a constrained Claude session on the forge — ALWAYS on a working branch,
// NEVER on main. Vercel deploys the branch as a preview; the creator reviews it and
// only then approves, which merges the branch to main → production.
//
// Env: GITHUB_TOKEN / GITHUB_OWNER / VPS_HOST / VPS_USER (+ optional VPS_SSH_KEY) like
// provisioning; VERCEL_TOKEN to resolve the branch preview URL.

// One circled change: the page it was drawn on + the strokes (in document coordinates) so
// the forge can re-render the live page and overlay the marks into an annotated screenshot.
type Annotation = { url: string; width: number; strokes: { x: number; y: number }[][] };

type ReviseInput = {
  revisionId: string;
  storeId: string;
  slug: string;
  storeName: string;
  branch: string;
  requestMd: string;
  screenshots: string[]; // legacy: pre-hosted annotated image URLs (now unused by the app)
  annotations?: Annotation[]; // circles to render into briefs/screenshots/ on the forge
};

function config() {
  const { GITHUB_TOKEN, GITHUB_OWNER, VPS_HOST, VPS_USER, VERCEL_TOKEN } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !VPS_HOST || !VPS_USER) return null;
  return { GITHUB_TOKEN, GITHUB_OWNER, VPS_HOST, VPS_USER, VERCEL_TOKEN: VERCEL_TOKEN ?? null };
}

async function run(cmd: string, args: string[], opts?: { input?: string; timeoutMs?: number }) {
  const { execFile } = await import('node:child_process');
  return new Promise<string>((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { timeout: opts?.timeoutMs ?? 120000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => (err ? reject(new Error(`${cmd} failed: ${stderr || err.message}`)) : resolve(stdout)),
    );
    if (opts?.input) {
      child.stdin?.write(opts.input);
      child.stdin?.end();
    }
  });
}

async function ssh(cfg: NonNullable<ReturnType<typeof config>>, script: string, timeoutMs: number) {
  const { homedir } = await import('node:os');
  const sshKey = process.env.VPS_SSH_KEY ?? `${homedir()}/.ssh/nanocrew`;
  return run('ssh', ['-i', sshKey, '-o', 'StrictHostKeyChecking=accept-new', `${cfg.VPS_USER}@${cfg.VPS_HOST}`, 'bash -s'], {
    input: script,
    timeoutMs,
  });
}

/** Poll Vercel for the branch's preview deployment URL (READY). Null if not found. */
async function resolvePreviewUrl(cfg: NonNullable<ReturnType<typeof config>>, slug: string, branch: string): Promise<string | null> {
  if (!cfg.VERCEL_TOKEN) return null;
  const app = `store-${slug}`;
  for (let i = 0; i < 18; i++) {
    try {
      const res = await fetch(`https://api.vercel.com/v6/deployments?app=${app}&limit=20`, {
        headers: { Authorization: `Bearer ${cfg.VERCEL_TOKEN}` },
      });
      const data = (await res.json()) as { deployments?: { url: string; readyState: string; meta?: { githubCommitRef?: string } }[] };
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

/** Apply one change on a working branch; the site's preview deploy updates, not main. */
export async function reviseStorefront(input: ReviseInput): Promise<void> {
  const cfg = config();
  if (!cfg) {
    console.log('[revise] skipped — env not configured');
    return;
  }
  const repo = `store-${input.slug}`;
  const fullRepo = `${cfg.GITHUB_OWNER}/${repo}`;
  // Re-render each circled page on the forge and overlay the marks → briefs/screenshots/.
  // Best-effort: a render hiccup must never block a revision. base64 keeps the payload shell-safe.
  const annotations = (input.annotations ?? []).filter((a) => a?.url && Array.isArray(a.strokes) && a.strokes.length > 0).slice(0, 8);
  const annB64 = annotations.length ? Buffer.from(JSON.stringify(annotations)).toString('base64') : '';
  const renderShots = annB64
    ? `ANN=$(mktemp); printf '%s' '${annB64}' | base64 -d > "$ANN"; node ~/critique-shot/render.mjs "$ANN" briefs/screenshots > /tmp/${repo}-shots.log 2>&1 || true; rm -f "$ANN"`
    : '';
  const brief = `# REVISION — ${input.storeName}

The creator requested this change to their live storefront, in their own words:

${input.requestMd}

${annotations.length ? `Annotated screenshots are in briefs/screenshots/ — the gold circles mark exactly which areas to change. Look at them.` : ''}

Read TEMPLATE.md and VOCABULARY.md first (VOCABULARY.md maps everyday phrases to blocks
and files). Apply ONLY the requested change. Stay inside the allowed edit surface:
brand.json tokens, content/**, app/globals.css fallback vars, and composing existing
blocks inside app/*/page.tsx. NEVER add dependencies, new routes, or touch lib/api.ts,
lib/cart.tsx, platform-auth, the beacon, or the /admin pages. If a request maps to no
existing block, note it in your final message instead of inventing one. Run \`npm run
build\` and fix what you break.`;

  try {
    const script = `set -e
export PATH="$HOME/.local/bin:$PATH"
[ -f ~/.claude-env ] && source ~/.claude-env
unset ANTHROPIC_API_KEY
mkdir -p ~/stores && cd ~/stores
rm -rf ${repo}
git clone --depth 1 https://x-access-token:${cfg.GITHUB_TOKEN}@github.com/${fullRepo}.git ${repo}
cd ${repo}
git checkout -b ${input.branch}
mkdir -p briefs/screenshots
N=$(ls briefs/03-REVISION-*.md 2>/dev/null | wc -l | tr -d ' ')
BRIEF="briefs/03-REVISION-$((N+1)).md"
cat > "$BRIEF" <<'NANOCREW_REVISION_EOF'
${brief}
NANOCREW_REVISION_EOF
${renderShots}
npm install --no-audit --no-fund 2>&1 | tail -1
claude -p "Read $BRIEF and look at any images in briefs/screenshots/, then apply exactly that change. Then run npm run build and fix anything you broke." --dangerously-skip-permissions --max-turns 60 < /dev/null > /tmp/${repo}-revise.log 2>&1 || true
npm run build > /tmp/${repo}-revise-build.log 2>&1 && echo BUILD_OK || echo BUILD_FAILED
rm -rf briefs/screenshots
git add -A
git -c user.name=nanocrew -c user.email=studio@nanocrew.app commit -q -m "Revision (review): ${input.requestMd.slice(0, 60).replace(/"/g, "'").replace(/\n/g, ' ')}" || true
git push -q -u origin ${input.branch}
echo REVISE_DONE
`;
    const out = await ssh(cfg, script, 30 * 60 * 1000);
    if (!out.includes('REVISE_DONE')) throw new Error('forge revision did not complete');
    if (out.includes('BUILD_FAILED')) console.warn(`[revise] ${repo}: build failing on branch ${input.branch}`);

    const previewUrl = await resolvePreviewUrl(cfg, input.slug, input.branch);
    await db
      .update(schema.storeRevisions)
      .set({ status: 'ready', previewUrl: previewUrl ?? null })
      .where(eq(schema.storeRevisions.id, input.revisionId));
    await notifyRevisionReady({ storeId: input.storeId, storeName: input.storeName, previewUrl });
    console.log(`[revise] ${fullRepo} branch ${input.branch} ready — ${previewUrl ?? 'no preview url'}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'revise failed';
    console.error(`[revise] ${repo}: ${msg}`);
    await db
      .update(schema.storeRevisions)
      .set({ status: 'failed', errorMsg: msg.slice(0, 500) })
      .where(eq(schema.storeRevisions.id, input.revisionId))
      .catch(() => {});
  }
}

/** Creator approved the preview → merge the branch into main (production deploy). */
export async function approveRevision(input: { revisionId: string; slug: string; branch: string }): Promise<boolean> {
  const cfg = config();
  if (!cfg) return false;
  const repo = `store-${input.slug}`;
  const fullRepo = `${cfg.GITHUB_OWNER}/${repo}`;
  try {
    const script = `set -e
cd ~/stores 2>/dev/null || { mkdir -p ~/stores && cd ~/stores; }
rm -rf ${repo}-merge
git clone https://x-access-token:${cfg.GITHUB_TOKEN}@github.com/${fullRepo}.git ${repo}-merge
cd ${repo}-merge
git checkout main
git merge --no-ff origin/${input.branch} -m "Merge revision ${input.branch}" || { echo MERGE_CONFLICT; exit 1; }
git push -q origin main
git push -q origin --delete ${input.branch} || true
echo MERGE_DONE
`;
    const out = await ssh(cfg, script, 5 * 60 * 1000);
    if (!out.includes('MERGE_DONE')) throw new Error('merge did not complete');
    await db
      .update(schema.storeRevisions)
      .set({ status: 'approved' })
      .where(eq(schema.storeRevisions.id, input.revisionId));
    console.log(`[revise] ${fullRepo} branch ${input.branch} merged to main`);
    return true;
  } catch (e) {
    console.error(`[revise approve] ${repo}: ${e instanceof Error ? e.message : 'failed'}`);
    return false;
  }
}
