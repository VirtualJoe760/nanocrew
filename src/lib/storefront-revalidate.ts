// Keep a brand's live storefront in sync with the app's catalogue. Template storefronts read our
// platform-api at build/ISR time, so after a product add/delete/edit they stay stale until the
// site rebuilds. This triggers a fresh Vercel build of that store's project. Fire-and-forget:
// it must never block or fail the product mutation that called it.
//
// Needs VERCEL_TOKEN in the server env. Per-brand Vercel projects are named either `<slug>` (the
// migrated/first brands) or `store-<slug>` (standard provisioned ones), so we try both.

const VERCEL_API = 'https://api.vercel.com';

async function findProjectId(token: string, slug: string): Promise<string | null> {
  for (const name of [slug, `store-${slug}`]) {
    const r = await fetch(`${VERCEL_API}/v9/projects/${encodeURIComponent(name)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.ok) {
      const j = (await r.json()) as { id?: string };
      if (j.id) return j.id;
    }
  }
  return null;
}

/** Redeploy a store's storefront so it reflects the current catalogue. Safe to await or not. */
export async function revalidateStorefront(slug: string | null | undefined): Promise<void> {
  const token = process.env.VERCEL_TOKEN;
  if (!slug) return;
  if (!token) {
    // Without the token every brand site silently stays stale — make the miss legible.
    console.warn('[revalidate-storefront] VERCEL_TOKEN unset — skipped');
    return;
  }
  try {
    const projectId = await findProjectId(token, slug);
    if (!projectId) {
      console.warn(`[revalidate-storefront] no Vercel project for "${slug}"`);
      return;
    }
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const d = (await fetch(
      `${VERCEL_API}/v6/deployments?projectId=${projectId}&target=production&limit=1`,
      { headers },
    ).then((r) => r.json())) as { deployments?: { uid: string; name: string }[] };
    const latest = d.deployments?.[0];
    if (!latest) return;
    const res = await fetch(`${VERCEL_API}/v13/deployments?forceNew=1`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: latest.name, deploymentId: latest.uid, target: 'production' }),
    });
    if (res.ok) console.log(`[revalidate-storefront] redeployed "${slug}"`);
    else console.warn(`[revalidate-storefront] "${slug}" redeploy ${res.status}`);
  } catch (e) {
    console.warn(`[revalidate-storefront] "${slug}":`, e instanceof Error ? e.message : e);
  }
}
