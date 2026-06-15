import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import type { BrandResult, ChatMessage } from '@/lib/interview';

// Storefront provisioning v2 (see docs/STOREFRONT_ENGINE.md):
//   1. pick the template that matches the interview's designStyle
//   2. create a per-brand GitHub repo, populate it on the forge from the
//      nanocrew-templates monorepo (sparse clone), write brand.json + briefs
//   3. headless `claude` on the forge applies the brand per briefs/01-BRAND.md
//      and must satisfy briefs/02-TEST.md, then the script pushes
//   4. create a Vercel project linked to the repo and trigger the first deploy
//
// Env contract (provisioning silently skips when the required ones are missing):
//   GITHUB_TOKEN / GITHUB_OWNER     repo create/content rights
//   TEMPLATES_REPO                  optional, default <owner>/nanocrew-templates
//   VPS_HOST / VPS_USER             the forge droplet (claude CLI + ~/.claude-env)
//   VPS_SSH_KEY                     optional identity file, default ~/.ssh/nanocrew
//   VERCEL_TOKEN                    optional — without it we push but skip deploy
//   EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
//                                   baked into brand.json so the site's /admin works

type ProvisionInput = {
  storeId: string;
  slug: string;
  brand: BrandResult;
  logoUrl: string | null;
  transcript: ChatMessage[];
};

const TEMPLATE_BY_STYLE: Record<BrandResult['designStyle'], string> = {
  minimalist: 'minimal',
  bold: 'bold',
  elegant: 'elegant',
  extravagant: 'extravagant',
};

// Provision jobs ride the same queue as revisions, marked with this reserved branch so the
// forge worker runs the clone+brand+build+push+deploy pipeline instead of a revision.
const PROVISION_BRANCH = '__provision__';

function config() {
  const {
    GITHUB_TOKEN,
    GITHUB_OWNER,
    TEMPLATES_REPO,
    VPS_HOST,
    VPS_USER,
    VERCEL_TOKEN,
    EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !VPS_HOST || !VPS_USER) return null;
  return {
    GITHUB_TOKEN,
    GITHUB_OWNER,
    TEMPLATES_REPO: TEMPLATES_REPO ?? `${GITHUB_OWNER}/nanocrew-templates`,
    VPS_HOST,
    VPS_USER,
    VERCEL_TOKEN: VERCEL_TOKEN ?? null,
    SUPABASE_URL: EXPO_PUBLIC_SUPABASE_URL ?? '',
    SUPABASE_ANON_KEY: EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
  };
}

/** brand.json is written deterministically by the pipeline — Claude never invents tokens. */
function buildBrandJson(input: ProvisionInput, cfg: NonNullable<ReturnType<typeof config>>) {
  const { brand } = input;
  const byRole = (want: string[]) =>
    brand.designSystem.palette.find((p) => want.some((w) => p.role.toLowerCase().includes(w)))?.hex;
  const primary = byRole(['primary', 'main', 'brand']) ?? brand.designSystem.palette[0]?.hex ?? '#111111';
  const palette = {
    primary,
    secondary: byRole(['secondary', 'support']) ?? brand.designSystem.palette[1]?.hex ?? '#6b7280',
    accent: byRole(['accent', 'highlight']) ?? primary,
    background: byRole(['background', 'base', 'canvas']) ?? '#ffffff',
    text: byRole(['text', 'ink', 'foreground']) ?? primary,
  };
  return {
    storeId: input.storeId,
    slug: input.slug,
    name: brand.name,
    tagline: brand.tagline,
    logoUrl: input.logoUrl ?? '',
    palette,
    typography: brand.designSystem.typography,
    designStyle: brand.designStyle,
    voice: brand.voice,
    story: brand.story,
    vibeKeywords: brand.vibeKeywords,
    products: brand.products,
    social: {},
    // The deployed platform API (e.g. https://nanocrew-api.vercel.app). Empty →
    // templates fall back to placeholder products.
    apiBase: process.env.PLATFORM_API_BASE ?? '',
    platform: { supabaseUrl: cfg.SUPABASE_URL, supabaseAnonKey: cfg.SUPABASE_ANON_KEY },
    // Single source of truth for the storefront's processing-fee terms — mirrors the values the
    // checkout (platform-api) actually charges, so the cart's "save X% over $Y" nudge can't drift.
    commerce: {
      feeWaiveCents: Number(process.env.PROCESSING_FEE_WAIVE_CENTS ?? 20000),
      feePct: Number(process.env.PROCESSING_FEE_PCT ?? 0.029),
    },
  };
}

/** briefs/01-BRAND.md — identity + instructions for the forge's Claude session. */
function buildBrandBrief(input: ProvisionInput, template: string): string {
  const { brand } = input;
  const convo = input.transcript
    .slice(-24)
    .map((m) => `${m.role === 'user' ? 'creator' : 'consultant'}: ${m.text}`)
    .join('\n');
  return `# 01-BRAND — ${brand.name}

You are branding a storefront for the clothing brand "${brand.name}". This repo is the
"${template}" Nanocrew template; it was chosen because the creator's style is
${brand.designStyle}. Read TEMPLATE.md first — its hard rules bind every edit you make —
and VOCABULARY.md, which translates the creator's everyday words into blocks and files.

## Identity
- Name: ${brand.name}
- Tagline: ${brand.tagline}
- Mission: ${brand.mission}
- Audience: ${brand.audience}
- Voice: ${brand.voice}
- Story: ${brand.story}
- Vibe: ${brand.vibeKeywords.join(', ')}
- Products they care about: ${brand.products.join(', ')}
- Logo: ${input.logoUrl ?? 'none yet'} (${brand.logo.direction})
- Texture cues: ${brand.designSystem.texture.join(', ')}
- Motion cues: ${brand.designSystem.motion.join(', ')}

${
  brand.siteNotes?.length
    ? `## The creator's site wishes (their own words — translate via VOCABULARY.md)
${brand.siteNotes.map((n) => `- "${n}"`).join('\n')}
Honor these by composing the matching blocks (VOCABULARY.md in this repo maps everyday
phrases to blocks). If a wish has no matching block, note it at the end of your work —
do not invent new components.

`
    : ''
}## What to do
brand.json is already written by the pipeline — treat every value in it as a hard
constraint (the creator chose those colors and fonts explicitly; never substitute).

1. Rewrite content/copy.json entirely in the brand's voice: hero headline/subline/cta,
   story kicker, featured title, about paragraphs (ground them in the story above),
   contact body, cart CTA. Short, confident lines that sound like the brand — not like
   marketing filler.
2. Write one launch journal post in content/blog/ announcing the brand (first line
   "# Title", second "> YYYY-MM-DD | one-line excerpt"). Remove placeholder posts.
3. Update content/policies/ tone where it reads like a placeholder; keep the legal
   substance.
4. If app/globals.css carries fallback brand variables, align them with brand.json.
5. Page metadata (titles/descriptions) should carry the brand name and tagline.

## The interview (the creator's own words — mine this for copy)
${convo}
`;
}

/** briefs/02-TEST.md — acceptance criteria the session must satisfy before finishing. */
function buildTestBrief(brandName: string): string {
  return `# 02-TEST — acceptance

Before you finish, ALL of these must hold:

1. \`pnpm run build\` completes with no errors. If it fails, fix what you broke and rerun.
2. You added no dependencies (package.json deps unchanged) and created no new routes.
3. lib/api.ts, lib/cart.tsx, lib/platform-auth.ts, components/blocks/beacon.tsx and the
   /admin pages are untouched.
4. brand.json is still valid JSON and still contains the exact palette/typography the
   pipeline wrote.
5. No placeholder text remains: nothing says "placeholder", "example.com", or
   "Placeholder Studio" anywhere a visitor or search engine can see.
6. Every page reads like ${brandName} wrote it.
`;
}

async function gh(cfg: { GITHUB_TOKEN: string }, path: string, init?: RequestInit) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      ...init?.headers,
    },
  });
  return res;
}

/**
 * Fire-and-forget from the store route. Creates the brand's GitHub repo and brand content
 * HERE (the app server can do GitHub API + build briefs), then ENQUEUES a provision job on
 * the shared store_revisions queue (branch '__provision__'). The forge worker — already on
 * the droplet — drains it and runs the heavy clone+brand+build+push+Vercel pipeline LOCALLY
 * (no SSH from this server, which doesn't work on a serverless/managed host). The store row
 * flips to 'ready' (with deployment_url) when the worker finishes. Errors are only logged.
 */
export async function provisionStorefront(input: ProvisionInput): Promise<void> {
  const cfg = config();
  if (!cfg) {
    console.log('[provision] skipped — env not configured');
    return;
  }
  const template = TEMPLATE_BY_STYLE[input.brand.designStyle] ?? 'minimal';
  const repo = `store-${input.slug}`;
  const fullRepo = `${cfg.GITHUB_OWNER}/${repo}`;
  try {
    // 1. Empty private repo for the brand (422 = already exists → resumable).
    const created = await gh(cfg, '/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: repo,
        description: `${input.brand.name} — Nanocrew storefront`,
        private: true,
        auto_init: false,
      }),
    });
    if (!created.ok && created.status !== 422) {
      throw new Error(`repo create failed: ${created.status} ${(await created.text()).slice(0, 200)}`);
    }

    // 2. Build the brand content here, then enqueue. The forge worker writes brand.json +
    //    briefs, runs Claude, gates on the build, pushes to main, and deploys to Vercel.
    const payload = JSON.stringify({
      kind: 'provision',
      slug: input.slug,
      template,
      brandName: input.brand.name,
      brandJson: JSON.stringify(buildBrandJson(input, cfg), null, 2),
      brandBrief: buildBrandBrief(input, template),
      testBrief: buildTestBrief(input.brand.name),
    });
    await db.insert(schema.storeRevisions).values({
      storeId: input.storeId,
      requestMd: payload,
      branch: PROVISION_BRANCH,
      status: 'building',
    });
    console.log(`[provision] ${fullRepo} repo ready, provision job enqueued for the forge worker`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'provision failed';
    console.error(`[provision] ${repo}: ${msg}`);
    // Don't leave the store stuck 'building' if we never managed to enqueue.
    await db
      .update(schema.stores)
      .set({ deploymentUrl: null, status: 'ready' })
      .where(eq(schema.stores.id, input.storeId))
      .catch(() => {});
  }
}
