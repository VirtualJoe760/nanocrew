import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { corsJson, corsPreflight } from '@/lib/cors';

export const OPTIONS = corsPreflight;

// GET /api/public/stores/:slug/site-config — the mini-CMS overrides (copy, colors, fonts) a creator
// edited in Studio. The storefront reads these LIVE and layers them over its baked brand.json /
// copy.json. Absent sections → the template keeps its baked values. No rebuild involved.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const [store] = await db
      .select({ siteConfig: schema.stores.siteConfig })
      .from(schema.stores)
      .where(eq(schema.stores.slug, slug))
      .limit(1);
    if (!store) return corsJson({ error: 'store not found' }, { status: 404 });
    const c = (store.siteConfig ?? {}) as { copy?: unknown; colors?: unknown; fonts?: unknown };
    return corsJson({ copy: c.copy ?? {}, colors: c.colors ?? {}, fonts: c.fonts ?? {} });
  } catch (e) {
    return corsJson({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
