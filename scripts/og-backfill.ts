// Backfill stores.og_image_url from logo + tagline + palette.
// Usage: npx tsx --env-file=.env.local scripts/og-backfill.ts
import postgres from 'postgres';

import { buildOgImageUrl } from '../src/lib/og-image';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  const stores = await sql<
    { id: string; slug: string; logo_url: string | null; tagline: string | null; ds: { palette?: { role: string; hex: string }[] } | null }[]
  >`select id, slug, logo_url, tagline, design_system as ds from stores`;
  for (const s of stores) {
    const pal = s.ds?.palette ?? [];
    const url = buildOgImageUrl({
      logoUrl: s.logo_url,
      tagline: s.tagline,
      bgHex: pal.find((p) => p.role === 'background')?.hex,
      textHex: pal.find((p) => p.role === 'text')?.hex,
    });
    if (url) {
      await sql`update stores set og_image_url=${url} where id=${s.id}`;
      console.log(`✓ ${s.slug}`);
    } else {
      console.log(`· ${s.slug}: no logo`);
    }
  }
  await sql.end();
  process.exit(0);
}
void main();
