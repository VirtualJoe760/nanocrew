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
      })
      .from(schema.stores)
      .where(eq(schema.stores.id, store.id))
      .limit(1);

    // The brand's CURRENT baked values, so the editor opens pre-filled (not blank). Colors come
    // from the generated design system's palette ({hex, role}); tagline/story from the store. Hero
    // copy + fonts live in the template repo, so those stay override-only (the editor shows them
    // empty with a placeholder). Bespoke brands (no design system) simply have no defaults.
    const ds = (row?.designSystem ?? {}) as { palette?: { hex: string; role: string }[] };
    const byRole = Object.fromEntries((ds.palette ?? []).map((p) => [p.role, p.hex]));
    const bp = (row?.brandProfile ?? {}) as { story?: string };
    const defaults = {
      colors: {
        background: byRole.background ?? '',
        text: byRole.text ?? '',
        primary: byRole.primary ?? '',
        accent: byRole.accent ?? '',
      },
      copy: { tagline: row?.tagline ?? '', story: bp.story ?? '' },
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
