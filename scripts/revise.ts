// Trigger a site revision from the CLI — no app, no microphone. For backend testing.
// Mirrors the in-app critique "Submit": creates a revision row and runs the forge (Claude
// on the VPS edits a WORKING BRANCH → Vercel preview; main is never touched). Prints the
// preview URL when it's ready to review.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/revise.ts <slug> "<change>" ["<change 2>" …]
//   npx tsx --env-file=.env.local scripts/revise.ts <slug> "<change>" --dry   (print, don't run)
//
// Example (the navbar ask):
//   npx tsx --env-file=.env.local scripts/revise.ts alpha-master \
//     "In the header, remove the brand-name text" \
//     "Make the logo noticeably larger" \
//     "Consolidate the nav links into a hamburger dropdown menu"
import { eq } from 'drizzle-orm';

import { db, schema } from '../src/lib/db';

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const rest = args.filter((a) => a !== '--dry');
  const slug = rest[0];
  const changes = rest.slice(1).filter((c) => c.trim());
  if (!slug || !changes.length) {
    console.error('usage: npx tsx --env-file=.env.local scripts/revise.ts <slug> "<change>" ["<change 2>" …] [--dry]');
    process.exit(1);
  }

  const store = await db.query.stores.findFirst({ where: eq(schema.stores.slug, slug) });
  if (!store) {
    console.error(`no store with slug "${slug}"`);
    process.exit(1);
  }

  const body = changes.map((c, i) => `${i + 1}. ${c.trim()}`).join('\n\n');
  const requestMd = `The creator requested these changes to their live storefront, in their own words:\n\n${body}`;

  console.log(`store: ${store.name} (${slug}) → ${store.deploymentUrl ?? 'no site'}`);
  console.log(`\n${requestMd}\n`);
  if (dry) {
    console.log('--dry: nothing sent.');
    process.exit(0);
  }

  const branch = `revision/${Date.now().toString(36)}`;
  const [rev] = await db
    .insert(schema.storeRevisions)
    .values({ storeId: store.id, requestMd, screenshots: [], status: 'building', branch })
    .returning({ id: schema.storeRevisions.id });

  console.log(`enqueued revision ${rev.id} → branch ${branch}; the forge worker will pick it up (a few minutes)…\n`);

  // Poll until the forge worker finishes the job.
  const started = Date.now();
  const MAX = 30 * 60 * 1000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 10_000));
    const [s] = await db
      .select({ status: schema.storeRevisions.status, previewUrl: schema.storeRevisions.previewUrl, errorMsg: schema.storeRevisions.errorMsg })
      .from(schema.storeRevisions)
      .where(eq(schema.storeRevisions.id, rev.id));
    if (!s || s.status === 'building') {
      process.stdout.write('.');
      if (Date.now() - started > MAX) {
        console.log('\n(timed out waiting on the worker)');
        break;
      }
      continue;
    }
    if (s.status === 'ready') console.log(`\n✅ ready — review at: ${s.previewUrl ?? '(branch pushed; preview URL not resolved)'}`);
    else if (s.status === 'failed') console.log(`\n❌ failed — ${s.errorMsg ?? 'unknown error'}`);
    else console.log(`\nstatus: ${s.status}`);
    break;
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
