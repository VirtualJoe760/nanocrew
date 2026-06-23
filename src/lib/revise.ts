import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// Revision lifecycle helpers triggered by the app. The forge RUN itself (build the change on a
// working branch → Vercel preview) lives on the droplet worker (forge-worker/worker.mjs), which
// drains the store_revisions queue. This module only handles the post-review actions:
//   • approveRevision — merge the working branch into main (production deploy)
//   • declineRevision — discard the working branch (production was never touched)
//
// IMPORTANT: these run ON THE BACKEND (Railway), which has NO SSH access to the forge droplet and
// no local git identity — so we do NOT shell out to git/ssh here. We merge and delete branches
// through the GitHub REST API (the backend already holds GITHUB_TOKEN). Merging `revision/<id>`
// into `main` of `store-<slug>` triggers the repo's Vercel production deploy automatically.
// Env: GITHUB_TOKEN / GITHUB_OWNER.

function config() {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_OWNER = process.env.GITHUB_OWNER;
  if (!GITHUB_TOKEN || !GITHUB_OWNER) return null;
  return { GITHUB_TOKEN, GITHUB_OWNER };
}

async function gh(cfg: NonNullable<ReturnType<typeof config>>, path: string, init?: RequestInit) {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

/** Best-effort delete of a working branch ref (revision/<id>). Never throws. */
async function deleteBranch(cfg: NonNullable<ReturnType<typeof config>>, repo: string, branch: string) {
  if (!branch || !branch.startsWith('revision/')) return;
  try {
    await gh(cfg, `/repos/${cfg.GITHUB_OWNER}/${repo}/git/refs/heads/${branch}`, { method: 'DELETE' });
  } catch {
    /* non-fatal — the branch lingering is harmless */
  }
}

/** Creator approved the preview → merge the branch into main (production deploy) via the GitHub API. */
export async function approveRevision(input: { revisionId: string; slug: string; branch: string }): Promise<boolean> {
  const cfg = config();
  if (!cfg) return false;
  const repo = `store-${input.slug}`;
  try {
    const res = await gh(cfg, `/repos/${cfg.GITHUB_OWNER}/${repo}/merges`, {
      method: 'POST',
      body: JSON.stringify({ base: 'main', head: input.branch, commit_message: `Merge revision ${input.branch}` }),
    });
    // 201 = merged, 204 = nothing to merge (branch already in main). Both are success.
    if (res.status !== 201 && res.status !== 204) {
      const detail = await res.text().catch(() => '');
      throw new Error(`merge ${res.status}: ${detail.slice(0, 200)}`);
    }
    await deleteBranch(cfg, repo, input.branch);
    await db
      .update(schema.storeRevisions)
      .set({ status: 'approved' })
      .where(eq(schema.storeRevisions.id, input.revisionId));
    console.log(`[revise] ${cfg.GITHUB_OWNER}/${repo} branch ${input.branch} merged to main (${res.status})`);
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
  if (cfg) {
    await deleteBranch(cfg, `store-${input.slug}`, input.branch);
    console.log(`[revise decline] store-${input.slug} branch ${input.branch} discarded`);
  }
  return true;
}
