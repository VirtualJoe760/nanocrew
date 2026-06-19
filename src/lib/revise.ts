import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// Revision lifecycle helpers triggered by the app. The forge RUN itself (build the change on a
// working branch → Vercel preview) lives on the droplet worker (forge-worker/worker.mjs), which
// drains the store_revisions queue. This module only handles the post-review actions:
//   • approveRevision — merge the working branch into main (production deploy)
//   • declineRevision — discard the working branch (production was never touched)
// Env: GITHUB_TOKEN / GITHUB_OWNER / VPS_HOST / VPS_USER (+ optional VPS_SSH_KEY).

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

// The creator declined the preview. Production was never touched (the change lived on a working
// branch only), so "reverting" = discarding that branch and marking the revision declined. Always
// mark it declined even if the branch delete hiccups — the row must leave the review bar.
export async function declineRevision(input: { revisionId: string; slug: string; branch: string }): Promise<boolean> {
  await db.update(schema.storeRevisions).set({ status: 'declined' }).where(eq(schema.storeRevisions.id, input.revisionId));
  const cfg = config();
  if (cfg && input.branch && input.branch.startsWith('revision/')) {
    const repo = `store-${input.slug}`;
    const fullRepo = `${cfg.GITHUB_OWNER}/${repo}`;
    try {
      await ssh(
        cfg,
        `cd ~/stores/${repo}-merge 2>/dev/null && git push -q origin --delete ${input.branch} || ` +
          `git -c credential.helper= ls-remote https://x-access-token:${cfg.GITHUB_TOKEN}@github.com/${fullRepo}.git >/dev/null 2>&1 && ` +
          `git push -q https://x-access-token:${cfg.GITHUB_TOKEN}@github.com/${fullRepo}.git --delete ${input.branch} || true`,
        60 * 1000,
      );
      console.log(`[revise decline] ${fullRepo} branch ${input.branch} discarded`);
    } catch (e) {
      console.error(`[revise decline] ${repo}: branch cleanup failed (non-fatal): ${e instanceof Error ? e.message : 'failed'}`);
    }
  }
  return true;
}
