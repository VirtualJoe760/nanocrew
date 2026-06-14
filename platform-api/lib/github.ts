// Merge a revision branch into main via GitHub's REST API — a server-side merge, so platform-api
// (serverless) can publish a reviewed revision without any local git (the app uses SSH to the forge;
// this is the equivalent for the web /admin path). Vercel auto-deploys main → production on push.

const GH = 'https://api.github.com';

function gh() {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  if (!token || !owner) throw new Error('GITHUB_TOKEN / GITHUB_OWNER not configured');
  return { token, owner };
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'nanocrew-platform-api',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** Merge `branch` into main for store-<slug>, then delete the branch. Returns false on conflict. */
export async function mergeRevisionBranch(slug: string, branch: string): Promise<boolean> {
  const { token, owner } = gh();
  const repo = `${owner}/store-${slug}`;

  const res = await fetch(`${GH}/repos/${repo}/merges`, {
    method: 'POST',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ base: 'main', head: branch, commit_message: `Merge revision ${branch}` }),
  });
  // 201 merged · 204 already up to date (nothing to merge — still a success) · 409 conflict.
  if (res.status === 409) return false;
  if (!res.ok && res.status !== 204) throw new Error(`github merge failed: ${res.status} ${(await res.text()).slice(0, 200)}`);

  // Best-effort branch cleanup — a failure here doesn't undo the merge.
  await fetch(`${GH}/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'DELETE',
    headers: headers(token),
  }).catch(() => {});
  return true;
}
