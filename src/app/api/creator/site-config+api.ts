import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { revalidateStorefront } from '@/lib/storefront-revalidate';
import { TenantError, storeForMember } from '@/lib/tenant';

// The mini-CMS write/read path. Lets a creator edit their site's COPY, COLORS, and FONTS from
// Studio — a direct DB write to stores.site_config (NOT the forge), read live by the storefront's
// /api/public/stores/:slug/site-config endpoint. No rebuild: edits show on the next page load.
//
// Shape (every field optional; absent → the template keeps its baked brand.json / copy.json value):
//   { copy?:   { heroHeadline?, heroSubline?, heroCta?, storyKicker?, story?, tagline? },
//     colors?: { background?, text?, primary?, accent? },
//     fonts?:  { display?, body? } }   // preset keys, mapped to font stacks in the template

type SiteConfig = {
  copy?: Record<string, string>;
  colors?: Record<string, string>;
  fonts?: Record<string, string>;
};

const SECTIONS = ['copy', 'colors', 'fonts'] as const;

const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Read a JSON file from a brand's storefront repo (the SOURCE OF TRUTH for the site's current copy +
// palette — they live in the repo, not our DB). Used to seed the Customize editor with what's live.
// Returns null on any miss so the editor falls back to DB-derived defaults.
async function fetchRepoJson(repo: string, path: string): Promise<Record<string, unknown> | null> {
  if (!GITHUB_OWNER || !GITHUB_TOKEN) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${repo}/contents/${path}`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.raw' },
      // cache a little — the repo copy changes rarely; keeps Customize snappy.
      next: { revalidate: 120 },
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Drop empty strings so "clear a field" falls back to the baked default rather than rendering blank.
function clean(obj: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return out;
}

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const slug = new URL(req.url).searchParams.get('store');
    if (!slug) return Response.json({ error: 'store is required' }, { status: 400 });
    const store = await storeForMember(slug, user.id);
    if (!store) return Response.json({ error: 'store not found' }, { status: 404 });
    const [row] = await db
      .select({
        siteConfig: schema.stores.siteConfig,
        designSystem: schema.stores.designSystem,
        tagline: schema.stores.tagline,
        brandProfile: schema.stores.brandProfile,
        repo: schema.stores.repo,
      })
      .from(schema.stores)
      .where(eq(schema.stores.id, store.id))
      .limit(1);

    // The brand's CURRENT values, so the editor opens pre-filled (not blank) — "this is what's live;
    // change what you want." The site's real copy + palette live in its REPO (content/copy.json +
    // brand.json), so read those first; fall back to the DB design system / store fields if the repo
    // read misses (bespoke brand at a non-standard path, no GitHub token, etc.).
    const repo = row?.repo || `store-${slug}`;
    const [copyJson, brandJson] = await Promise.all([
      fetchRepoJson(repo, 'content/copy.json'),
      (async () => (await fetchRepoJson(repo, 'brand.json')) ?? (await fetchRepoJson(repo, 'src/brand.json')))(),
    ]);
    const palette = (brandJson?.palette ?? {}) as Record<string, string>;
    const hero = (copyJson?.hero ?? {}) as Record<string, string>;
    const storyC = (copyJson?.story ?? {}) as Record<string, string>;

    const ds = (row?.designSystem ?? {}) as { palette?: { hex: string; role: string }[] };
    const byRole = Object.fromEntries((ds.palette ?? []).map((p) => [p.role, p.hex]));
    const bp = (row?.brandProfile ?? {}) as { story?: string };

    const defaults = {
      colors: {
        background: palette.background ?? byRole.background ?? '',
        text: palette.text ?? byRole.text ?? '',
        primary: palette.primary ?? byRole.primary ?? '',
        accent: palette.accent ?? byRole.accent ?? '',
      },
      copy: {
        heroHeadline: hero.headline ?? '',
        heroSubline: hero.subline ?? '',
        heroCta: hero.cta ?? '',
        storyKicker: storyC.kicker ?? '',
        story: (brandJson?.story as string) ?? bp.story ?? '',
        tagline: (brandJson?.tagline as string) ?? row?.tagline ?? '',
      },
    };
    return Response.json({ config: (row?.siteConfig ?? {}) as SiteConfig, defaults });
  } catch (e) {
    const status = e instanceof TenantError ? e.status : 500;
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status });
  }
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json().catch(() => null)) as ({ storeSlug?: string } & SiteConfig) | null;
    if (!b?.storeSlug) return Response.json({ error: 'storeSlug is required' }, { status: 400 });
    const store = await storeForMember(b.storeSlug, user.id);
    if (!store) return Response.json({ error: 'store not found' }, { status: 404 });

    const [row] = await db
      .select({ siteConfig: schema.stores.siteConfig })
      .from(schema.stores)
      .where(eq(schema.stores.id, store.id))
      .limit(1);
    const current = (row?.siteConfig ?? {}) as SiteConfig;

    // Per-section merge so a partial edit (e.g. just colors) never clobbers the other sections.
    const next: SiteConfig = { ...current };
    for (const s of SECTIONS) {
      if (b[s] !== undefined) next[s] = { ...(current[s] ?? {}), ...clean(b[s]) };
    }

    await db.update(schema.stores).set({ siteConfig: next }).where(eq(schema.stores.id, store.id));
    void revalidateStorefront(store.slug);
    return Response.json({ ok: true, config: next });
  } catch (e) {
    const status = e instanceof TenantError ? e.status : 500;
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status });
  }
}
