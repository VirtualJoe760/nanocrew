// Targeted writer for a brand site's baked brand.json (the per-store repo's "LAW": name, tagline,
// palette, logoUrl, …). The mini-CMS (site-config) handles runtime copy/color overrides, but a few
// fields are baked at build time and only change by rewriting brand.json + letting Vercel rebuild —
// notably the BRAND NAME and the LOGO shown in the site header. This runs on the backend (Railway),
// which already holds GITHUB_TOKEN + GITHUB_OWNER, and merges via the GitHub contents API (no SSH).
// Same GET-sha → PUT pattern as scripts/resync-brand-config.mjs. Pushing to main triggers the
// repo's Vercel production deploy automatically. Best-effort: returns false (never throws) when the
// store has no repo (app-only brands) or GitHub is unreachable.

function gh() {
  const { GITHUB_TOKEN, GITHUB_OWNER } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_OWNER) return null;
  return { GITHUB_TOKEN, GITHUB_OWNER };
}

export type BrandJsonPatch = {
  name?: string;
  tagline?: string | null;
  story?: string | null; // drives the site's meta/og/twitter description + JSON-LD (baked → needs rebuild)
  logoUrl?: string | null;
};

export async function updateBrandJson(slug: string, patch: BrandJsonPatch): Promise<boolean> {
  const cfg = gh();
  if (!cfg) return false;
  const url = `https://api.github.com/repos/${cfg.GITHUB_OWNER}/store-${slug}/contents/brand.json`;
  const headers = {
    Authorization: `Bearer ${cfg.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  try {
    const get = await fetch(url, { headers });
    if (get.status === 404) return false; // app-only brand, no site repo
    if (!get.ok) throw new Error(`read ${get.status}`);
    const file = (await get.json()) as { content: string; sha: string };
    const current = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')) as Record<string, unknown>;

    const next = { ...current };
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.tagline !== undefined) next.tagline = patch.tagline ?? '';
    if (patch.story !== undefined) next.story = patch.story ?? '';
    if (patch.logoUrl !== undefined) next.logoUrl = patch.logoUrl ?? '';
    if (JSON.stringify(next) === JSON.stringify(current)) return true; // already in sync

    const put = await fetch(url, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'chore: sync brand.json identity (name/tagline/story/logo) from Site Options',
        content: Buffer.from(JSON.stringify(next, null, 2)).toString('base64'),
        sha: file.sha,
      }),
    });
    if (!put.ok) throw new Error(`write ${put.status}`);
    console.log(`[brand-config] store-${slug} brand.json updated (${Object.keys(patch).join(',')}) → rebuilding`);
    return true;
  } catch (e) {
    console.error(`[brand-config] store-${slug}: ${e instanceof Error ? e.message : 'failed'}`);
    return false;
  }
}
