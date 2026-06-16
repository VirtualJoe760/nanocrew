// Drive the whole Studio flow from a JSON file — BUILD a site, REBUILD an existing one,
// or EDIT one — without touching the app UI or doing a Venus interview. Each kind replays
// exactly what the app's API would do (calling the same libs), so the real forge worker on
// the droplet drains the job. The fast loop for build-quality work is `--dry` on a build/
// rebuild: it AUTHORS briefs/01-BRAND.md (#29, gemini-2.5-pro) and prints it — no GitHub
// repo, no forge, no Vercel, ~1 Gemini call.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/studio-flow.ts <file.json> [--dry]
//
// The JSON's `kind` field selects the action (see scripts/studio-flow/ for examples):
//   { "kind": "build",   "brand": <BrandResult>, "transcript"?: [...], "slug"?, "logoUrl"? }
//   { "kind": "rebuild", "slug": "alpha-master" }                      // re-fire an existing store
//   { "kind": "edit",    "slug": "alpha-master", "requestMd": "make the hero a full-bleed video" }
//
// `build`/`edit` create real DB rows (and `build` a real GitHub repo + Vercel project) under a
// throwaway test creator. `rebuild` is the old provision-pilot behavior — verify Alpha Master here.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';

import { db, schema } from '../src/lib/db';
import type { BrandResult, ChatMessage } from '../src/lib/interview';
import { provisionStorefront, renderProvisionArtifacts, templateForStyle, type ProvisionInput } from '../src/lib/provision';

const OUT_DIR = join('scripts', 'studio-flow', 'out');
// The exact instruction the forge worker hands the headless `claude` for a provision job
// (mirror of buildProvisionScript in forge-worker/worker.mjs — shown for review).
const FORGE_PROVISION_COMMAND =
  'claude -p "Read briefs/01-BRAND.md and apply it to this storefront. Then verify every item in ' +
  'briefs/02-TEST.md and fix anything that fails." --dangerously-skip-permissions --max-turns 80';

/** Write every prompt/artifact for a build to scripts/studio-flow/out/<slug>/ for review. */
async function renderAllPrompts(slug: string, input: ProvisionInput): Promise<void> {
  const arts = await renderProvisionArtifacts(input);
  const dir = join(OUT_DIR, slug);
  mkdirSync(dir, { recursive: true });
  const files: Record<string, string> = {
    // What conditions Venus when she authors the brief (the meta-prompt + her full input):
    '00-VENUS-AUTHOR-SYSTEM.md': arts.authorSystem,
    '00-VENUS-AUTHOR-INPUT.md': arts.authorInput,
    // What the forge actually receives:
    'brand.json': arts.brandJson,
    'briefs-01-BRAND.md': arts.brief,
    'briefs-02-TEST.md': arts.testBrief,
    // What conditions the forge + the command that runs it:
    'FORGE-COMMAND.txt': `${FORGE_PROVISION_COMMAND}\n`,
  };
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  // The forge's standing rules (Master CLAUDE.md) — copy in so the full picture is in one place.
  const masterClaude = join('forge-worker', 'forge-CLAUDE.md');
  if (existsSync(masterClaude)) copyFileSync(masterClaude, join(dir, 'FORGE-CLAUDE.md'));
  console.log(`[studio-flow] rendered all prompts (template "${arts.template}") → ${dir}/`);
  console.log(`  00-VENUS-AUTHOR-SYSTEM.md  00-VENUS-AUTHOR-INPUT.md  briefs-01-BRAND.md`);
  console.log(`  briefs-02-TEST.md  brand.json  FORGE-CLAUDE.md  FORGE-COMMAND.txt`);
}

const TEST_CREATOR_EMAIL = 'studio-flow-test@nanocrew.app';

type BuildJob = { kind: 'build'; brand: BrandResult; transcript?: ChatMessage[]; slug?: string; logoUrl?: string };
type RebuildJob = { kind: 'rebuild'; slug: string };
type EditJob = { kind: 'edit'; slug: string; requestMd: string; annotations?: unknown[] };
type Job = BuildJob | RebuildJob | EditJob;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'store'
  );
}

/** Find-or-create the throwaway creator that owns script-built test stores. */
async function ensureTestCreator(): Promise<string> {
  const existing = await db.query.creators.findFirst({ where: eq(schema.creators.email, TEST_CREATOR_EMAIL) });
  if (existing) return existing.id;
  const [row] = await db
    .insert(schema.creators)
    .values({ id: crypto.randomUUID(), email: TEST_CREATOR_EMAIL, name: 'Studio Flow Test' })
    .returning({ id: schema.creators.id });
  return row.id;
}

/** Pull a usable BrandResult out of a stored store row (mirrors provision-pilot / build-site). */
function brandFromStore(store: typeof schema.stores.$inferSelect): { brand: BrandResult; transcript: ChatMessage[] } {
  const { transcript = [], ...profile } = (store.brandProfile ?? {}) as BrandResult & { transcript?: ChatMessage[] };
  const brand = { ...profile, designSystem: store.designSystem } as BrandResult;
  return { brand, transcript };
}

async function runBuild(job: BuildJob, dry: boolean) {
  if (!job.brand?.name || !job.brand.designSystem) throw new Error('build job needs brand.name + brand.designSystem');
  const template = templateForStyle(job.brand.designStyle);
  const transcript = job.transcript ?? [];

  if (dry) {
    // Render every prompt to disk — no store, no repo, no forge.
    const slug = job.slug ?? slugify(job.brand.name);
    await renderAllPrompts(slug, { storeId: 'dry-run', slug, brand: job.brand, logoUrl: job.logoUrl ?? null, transcript });
    return;
  }

  const creatorId = await ensureTestCreator();
  const slug = job.slug ?? slugify(job.brand.name);
  // Reuse the row if this slug was built before (resumable, like the real repo create's 422).
  let store = await db.query.stores.findFirst({ where: eq(schema.stores.slug, slug) });
  if (!store) {
    const { designSystem, ...profile } = job.brand;
    [store] = (await db
      .insert(schema.stores)
      .values({
        creatorId,
        name: job.brand.name,
        slug,
        tagline: job.brand.tagline,
        descriptionMd: job.brand.story,
        brandProfile: { ...profile, transcript },
        designSystem,
        logoUrl: job.logoUrl ?? null,
        status: 'building',
      })
      .returning()) as (typeof schema.stores.$inferSelect)[];
    await db.insert(schema.catalogues).values({ storeId: store.id, name: 'First drop', slug: 'first-drop' });
    console.log(`[studio-flow] created test store "${store.name}" (${slug})`);
  } else {
    console.log(`[studio-flow] reusing existing store "${store.name}" (${slug})`);
  }

  console.log(`[studio-flow] building (${template}) — fire forge provision…`);
  await provisionStorefront({ storeId: store.id, slug, brand: job.brand, logoUrl: store.logoUrl, transcript });
  const after = await db.query.stores.findFirst({ where: eq(schema.stores.id, store.id) });
  console.log(`[studio-flow] enqueued. store status: ${after?.status}. The droplet's forge worker will build + deploy.`);
}

async function runRebuild(job: RebuildJob, dry: boolean) {
  const store = await db.query.stores.findFirst({ where: eq(schema.stores.slug, job.slug) });
  if (!store) throw new Error(`no store with slug "${job.slug}"`);
  const { brand, transcript } = brandFromStore(store);
  if (!brand.name || !brand.designSystem) throw new Error(`store "${job.slug}" has no usable brand profile/design system`);
  const template = templateForStyle(brand.designStyle);

  if (dry) {
    await renderAllPrompts(store.slug, { storeId: store.id, slug: store.slug, brand, logoUrl: store.logoUrl, transcript });
    return;
  }

  console.log(`[studio-flow] re-provisioning "${store.name}" (${job.slug}) — style ${brand.designStyle} → ${template}`);
  await provisionStorefront({ storeId: store.id, slug: store.slug, brand, logoUrl: store.logoUrl, transcript });
  const after = await db.query.stores.findFirst({ where: eq(schema.stores.id, store.id) });
  console.log(`[studio-flow] enqueued. deploymentUrl: ${after?.deploymentUrl ?? '(set when the forge worker finishes)'}`);
}

async function runEdit(job: EditJob) {
  if (!job.requestMd?.trim()) throw new Error('edit job needs a requestMd');
  const store = await db.query.stores.findFirst({ where: eq(schema.stores.slug, job.slug) });
  if (!store) throw new Error(`no store with slug "${job.slug}"`);
  // Mirror POST /api/creator/revise: enqueue a revision the forge worker drains on a branch.
  const branch = `revision/${Date.now().toString(36)}`;
  const annotations = Array.isArray(job.annotations) ? job.annotations.slice(0, 8) : [];
  const [rev] = await db
    .insert(schema.storeRevisions)
    .values({ storeId: store.id, requestMd: job.requestMd.trim(), screenshots: annotations, status: 'building', branch })
    .returning({ id: schema.storeRevisions.id });
  console.log(`[studio-flow] edit enqueued for "${store.name}" — revision ${rev.id}, branch ${branch}.`);
  console.log(`[studio-flow] the forge worker builds it on a branch → Vercel preview → approve to merge to main.`);
}

// Re-pull the LATEST template into every template-built brand (the way template improvements —
// SEO, OG card, mini-CMS, cart icon, etc. — reach existing sites). Brand/products/posts/CMS all live
// in the DB, so they survive; the forge re-applies them onto the fresh template. SKIPS bespoke sites
// (stores.repo set to something other than store-<slug>, e.g. stephen-lawyer) so it can't clobber a
// hand-built design — those get a targeted file-sync instead. Usage:
//   npx tsx --env-file=.env.local scripts/studio-flow.ts --reprovision-all [--dry]
async function reprovisionAll(dry: boolean) {
  const stores = await db.query.stores.findMany();
  const eligible: typeof stores = [];
  const skipped: { slug: string; why: string }[] = [];
  for (const s of stores) {
    if (s.repo && s.repo !== `store-${s.slug}`) { skipped.push({ slug: s.slug, why: `bespoke repo "${s.repo}"` }); continue; }
    const { brand } = brandFromStore(s);
    if (!brand.name || !brand.designSystem) { skipped.push({ slug: s.slug, why: 'no brand profile / design system' }); continue; }
    eligible.push(s);
  }
  console.log(`[studio-flow] reprovision-all — ${eligible.length} eligible, ${skipped.length} skipped:`);
  skipped.forEach((x) => console.log(`  · skip ${x.slug} — ${x.why}`));
  if (dry) {
    eligible.forEach((s) => console.log(`  · would re-provision ${s.slug} → ${templateForStyle(brandFromStore(s).brand.designStyle)}`));
    return;
  }
  for (const s of eligible) {
    const { brand, transcript } = brandFromStore(s);
    console.log(`  ▶ re-provisioning ${s.slug} → ${templateForStyle(brand.designStyle)}`);
    await provisionStorefront({ storeId: s.id, slug: s.slug, brand, logoUrl: s.logoUrl, transcript });
  }
  console.log(`[studio-flow] enqueued ${eligible.length} re-provisions — the forge worker drains them one at a time.`);
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  if (args.includes('--reprovision-all')) {
    await reprovisionAll(dry);
    process.exit(0);
  }
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('usage: npx tsx --env-file=.env.local scripts/studio-flow.ts <file.json> [--dry]');
    process.exit(1);
  }
  const job = JSON.parse(readFileSync(file, 'utf8')) as Job;

  switch (job.kind) {
    case 'build':
      await runBuild(job, dry);
      break;
    case 'rebuild':
      await runRebuild(job, dry);
      break;
    case 'edit':
      if (dry) throw new Error('--dry has no meaning for an edit (it only enqueues a revision)');
      await runEdit(job);
      break;
    default:
      throw new Error(`unknown job kind: ${(job as { kind?: string }).kind ?? '(none)'} — expected build | rebuild | edit`);
  }
  process.exit(0);
}

void main().catch((e) => {
  console.error(`[studio-flow] ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
