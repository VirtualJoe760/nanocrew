import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import type { BrandResult } from './interview+api';

// POST /api/store — persist a finished Studio interview as the creator's store:
// brand identity → stores.brand_profile, design language → stores.design_system.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let brand: BrandResult;
  try {
    const body = (await req.json()) as { brand?: BrandResult };
    if (!body.brand?.name) throw new Error();
    brand = body.brand;
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  try {
    // Make sure the creators row exists (same bootstrap /api/me does).
    await db
      .insert(schema.creators)
      .values({ id: user.id, email: user.email })
      .onConflictDoNothing({ target: schema.creators.id });

    const base =
      brand.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'store';

    const { designSystem, ...profile } = brand;

    // Retry on slug collision with a numeric suffix.
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
      try {
        const [store] = await db
          .insert(schema.stores)
          .values({
            creatorId: user.id,
            name: brand.name,
            slug,
            tagline: brand.tagline,
            descriptionMd: brand.story,
            brandProfile: profile,
            designSystem,
            status: 'building',
          })
          .returning({ id: schema.stores.id, slug: schema.stores.slug });
        // A fresh store needs a first catalogue so the Designer has somewhere to work.
        await db
          .insert(schema.catalogues)
          .values({ storeId: store.id, name: 'First drop', slug: 'first-drop' });
        return Response.json({ store });
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        if (!/unique|duplicate/i.test(msg)) throw e;
      }
    }
    throw new Error('could not find a free store slug');
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
