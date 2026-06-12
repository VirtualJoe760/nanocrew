// Re-fire storefront provisioning for an existing store (the forge v2 pilot).
// Usage: npx tsx --env-file=.env.local scripts/provision-pilot.ts <slug>
import { eq } from 'drizzle-orm';

import { db, schema } from '../src/lib/db';
import type { BrandResult, ChatMessage } from '../src/lib/interview';
import { provisionStorefront } from '../src/lib/provision';

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('usage: npx tsx --env-file=.env.local scripts/provision-pilot.ts <slug>');
    process.exit(1);
  }

  const store = await db.query.stores.findFirst({ where: eq(schema.stores.slug, slug) });
  if (!store) {
    console.error(`no store with slug "${slug}"`);
    process.exit(1);
  }
  const { transcript = [], ...profile } = (store.brandProfile ?? {}) as BrandResult & {
    transcript?: ChatMessage[];
  };
  const brand = { ...profile, designSystem: store.designSystem } as BrandResult;
  if (!brand.name || !brand.designSystem) {
    console.error(`store "${slug}" has no usable brand profile/design system`);
    process.exit(1);
  }

  console.log(`[pilot] provisioning "${store.name}" (${slug}) — style: ${brand.designStyle}`);
  await provisionStorefront({
    storeId: store.id,
    slug: store.slug,
    brand,
    logoUrl: store.logoUrl,
    transcript,
  });
  const after = await db.query.stores.findFirst({ where: eq(schema.stores.id, store.id) });
  console.log(`[pilot] done — deploymentUrl: ${after?.deploymentUrl ?? 'null (failed, see log above)'}`);
  process.exit(0);
}

void main();
