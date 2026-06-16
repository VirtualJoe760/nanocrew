import { GoogleGenAI } from '@google/genai';
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

export type ProvisionInput = {
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

/** The storefront template a brand's designStyle maps to (single source of truth). */
export function templateForStyle(designStyle: BrandResult['designStyle']): string {
  return TEMPLATE_BY_STYLE[designStyle] ?? 'minimal';
}

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

/**
 * Deterministic fallback for briefs/01-BRAND.md — a data mail-merge with no art direction.
 * Used only when the AI author (`authorBrandBrief`) can't run (no GOOGLE_GENAI_API_KEY) or
 * fails, so provisioning never breaks. The masterful, art-directed brief is the AI path.
 */
function buildBrandBriefFallback(input: ProvisionInput, template: string): string {
  const { brand } = input;
  const convo = input.transcript
    .slice(-24)
    .map((m) => `${m.role === 'user' ? 'creator' : 'consultant'}: ${m.text}`)
    .join('\n');
  return `# 01-BRAND — ${brand.name}

You are branding a storefront for the clothing brand "${brand.name}". This repo is the
"${template}" Nanocrew template; it was chosen because the creator's style is
${brand.designStyle}. Read TEMPLATE.md first — its hard rules bind every edit you make, and
its block inventory (with keyword hints) is what you compose from.

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
    ? `## The creator's site wishes (their own words)
${brand.siteNotes.map((n) => `- "${n}"`).join('\n')}
Honor these by composing the matching blocks from TEMPLATE.md's inventory (its keyword
hints map everyday phrases to blocks). If a wish has no matching block, note it at the end
of your work — do not invent new components.

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

// The build prompt is the single highest-leverage lever on build quality (see
// docs/studio/FORGE_AI.md). Instead of a data mail-merge, an AI step AUTHORS briefs/01-BRAND.md
// as a real art-directed build prompt — the brief a master would hand a fresh Claude Code
// session. gemini-2.5-pro: this is fire-and-forget background provisioning, one call per brand,
// and quality is the whole point. Standing rules the robot always holds live in the forge's
// Master CLAUDE.md (forge-worker/forge-CLAUDE.md); this authors the per-brand art direction.
const BRIEF_AUTHOR_MODEL = 'gemini-2.5-pro';

function briefAuthorSystem(): string {
  return `You are VENUS, Nanocrew's brand consultant — a lead creative director AND senior Next.js
engineer. You just interviewed the creator. Now write the build brief (briefs/01-BRAND.md) that the
forge (a headless Claude session) will follow to turn a storefront TEMPLATE into this brand's
website — wired to the platform's DB, store, and Printful fulfilment.

YOU ARE THE INTERPRETER. The forge does NOT decode the creator's casual words — that is your job,
done here. You are given this template's TEMPLATE.md (its real blocks, props, rules, page skeleton)
and VOCABULARY.md (a dictionary from the creator's everyday phrases to the template's actual block
files). Use VOCABULARY.md to translate every loose wish into the CONCRETE block + file, and write
the brief in those concrete terms (e.g. "use the hero-video block (blocks/hero-video.tsx) for a
waving-flag hero" — NOT "they want a video at the top"). The forge builds exactly what you specify
and never guesses. Resolve ambiguity yourself; if a wish maps to no block in this template, say so
explicitly in the brief as "unsupported — skip" rather than inventing one.

WHAT THE FORGE ALREADY KNOWS (don't repeat the plumbing — it has standing rules + TEMPLATE.md):
- brand.json is already written and is LAW: palette, typography, name, tagline, logo, apiBase.
  Never tell it to change or invent those values.
- Products/prices/catalogue/auth/checkout come from the platform API at runtime; it must not
  hardcode products or touch lib/api.ts, lib/cart.tsx, platform-auth, the beacon, or /admin.
- No new dependencies or routes. Edit surface: brand.json tokens, content/**, public/**,
  app/globals.css fallback vars, and composing EXISTING blocks in app/*/page.tsx.

TEMPORARY CONTENT GOES IN content/placeholders.json (NOT hardcoded in pages, NEVER in lib/api.ts):
- The template ships a placeholder index (hero media, product tiles, featured videos). The live
  catalogue auto-overrides it the moment real products exist — your brief must tell the forge to
  edit content/placeholders.json and to leave the wiring (lib/api.ts) alone.
- IMAGES/VIDEO: the forge cannot generate images. So LEAVE imageUrl/videoUrl null and rely on the
  template's deliberate brand-tinted treatment (a palette wash + the name) UNLESS a real on-brand
  asset URL exists (e.g. a creator upload). NEVER invent a stock or external URL — a dead link is a
  blank hero. Direct the MOOD/treatment in words; do not fabricate asset links.
- PRODUCT TILES: specify on-brand placeholder names/categories/prices that fit THIS brand (not
  "Essential Tee"), to go in placeholders.json.

WHAT YOUR BRIEF MUST DELIVER (the quality bar — the current pipeline fails all of these):
- A HERO that is never blank: set the hero entry in content/placeholders.json (a real on-brand
  video/image URL only if one truly exists, else null → the template renders a deliberate brand
  treatment), and write the hero headline/subline/cta into content/copy.json.
- A styled, high-contrast, obviously-working primary CTA.
- On-brand placeholder product tiles in content/placeholders.json — never the template's generic
  defaults. These auto-swap for the creator's real products later.
- Copy in the brand's REAL voice, grounded in the creator's actual words below — quote and mine
  them. No invented marketing filler, no lorem, no "example.com"/"Placeholder Studio".
- Palette/typography fallbacks in globals.css aligned to brand.json; page metadata carrying the
  brand name + tagline; one launch journal post in content/blog/ (first line "# Title", second
  "> YYYY-MM-DD | one-line excerpt"); policy tone refreshed without losing legal substance.

OUTPUT: return ONLY the finished briefs/01-BRAND.md as GitHub-flavored Markdown — no code fences,
no preamble, no "here is". Start with "# 01-BRAND — <brand name>". Write it as a direct instruction
to the forge ("you are branding…", "establish a hero that…"). Open by telling it to read TEMPLATE.md
first (the spec for the blocks you reference). Give it a concrete, block-by-block plan — it should
never need to guess what the creator meant. End by reminding it to run pnpm run build, review its own
output against this bar, and report honestly. Be specific to THIS brand throughout; a reader should
never mistake it for another brand's brief.`;
}

/** The structured creator input + this template's docs the author reasons over. */
function briefAuthorInput(input: ProvisionInput, template: string, templateMd: string | null, vocabMd: string | null): string {
  const { brand } = input;
  const convo = input.transcript
    .slice(-30)
    .map((m) => `${m.role === 'user' ? 'creator' : 'Venus'}: ${m.text}`)
    .join('\n');
  return `Template chosen (from designStyle "${brand.designStyle}"): ${template}

## Brand facts (already baked into brand.json — context for you, not to be changed)
- Name: ${brand.name}
- Tagline: ${brand.tagline}
- Mission: ${brand.mission}
- Audience: ${brand.audience}
- Voice: ${brand.voice}
- Story: ${brand.story}
- Vibe keywords: ${brand.vibeKeywords.join(', ')}
- Products they're excited to sell: ${brand.products.join(', ')}
- Logo: ${input.logoUrl ?? 'none yet'} — direction: ${brand.logo.direction}
- Palette (roled hexes): ${brand.designSystem.palette.map((p) => `${p.role} ${p.hex}`).join(', ')}
- Typography: display "${brand.designSystem.typography.display}", body "${brand.designSystem.typography.body}"
- Texture cues: ${brand.designSystem.texture.join(', ')}
- Motion cues: ${brand.designSystem.motion.join(', ')}

## The creator's site wishes — their OWN WORDS (YOU translate these to concrete blocks)
${brand.siteNotes?.length ? brand.siteNotes.map((n) => `- "${n}"`).join('\n') : '- (none stated)'}

## The interview transcript (mine this for the brand's voice and copy)
${convo}

## THIS TEMPLATE'S SPEC — TEMPLATE.md (the real blocks/props/rules to name in your brief)
${templateMd ?? '(unavailable — describe blocks generically and let the forge map them)'}

## THIS TEMPLATE'S DICTIONARY — VOCABULARY.md (creator phrase → concrete block/file; YOU resolve with this)
${vocabMd ?? '(unavailable — interpret the wishes as best you can)'}`;
}

/** Read one of the chosen template's docs from the templates repo (best-effort; null on any miss). */
async function fetchTemplateDoc(template: string, file: string): Promise<string | null> {
  const cfg = config();
  if (!cfg) return null;
  try {
    const res = await gh(cfg, `/repos/${cfg.TEMPLATES_REPO}/contents/templates/${template}/${file}`, {
      headers: { Accept: 'application/vnd.github.raw' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * VENUS authors briefs/01-BRAND.md with AI — she interprets the creator (using the template's
 * VOCABULARY.md) and writes a concrete, block-by-block brief the forge executes literally. Falls
 * back to the deterministic mail-merge when the model key is missing or the call fails, so
 * provisioning never breaks.
 */
export async function authorBrandBrief(input: ProvisionInput, template: string): Promise<string> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('[provision] no GOOGLE_GENAI_API_KEY — using mail-merge brief fallback');
    return buildBrandBriefFallback(input, template);
  }
  try {
    const [templateMd, vocabMd] = await Promise.all([
      fetchTemplateDoc(template, 'TEMPLATE.md'),
      fetchTemplateDoc(template, 'VOCABULARY.md'),
    ]);
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: BRIEF_AUTHOR_MODEL,
      contents: [{ role: 'user', parts: [{ text: briefAuthorInput(input, template, templateMd, vocabMd) }] }],
      config: { systemInstruction: briefAuthorSystem(), temperature: 0.8 },
    });
    const md = res.text?.trim();
    if (!md || !md.includes('# 01-BRAND')) throw new Error('author returned an unusable brief');
    return md;
  } catch (e) {
    console.error(`[provision] brief author failed (${e instanceof Error ? e.message : e}) — using fallback`);
    return buildBrandBriefFallback(input, template);
  }
}

/**
 * Render every text artifact that steers one build, for LOCAL REVIEW (the `--dry` path of
 * scripts/studio-flow.ts). Returns the author's system prompt + input (with the template docs
 * Venus reads), the authored 01-BRAND.md, 02-TEST.md, and brand.json — exactly what the forge
 * would receive. No repo, no forge, no deploy; one Gemini call (for the brief).
 */
export async function renderProvisionArtifacts(input: ProvisionInput): Promise<{
  template: string;
  authorSystem: string;
  authorInput: string;
  brief: string;
  testBrief: string;
  brandJson: string;
}> {
  const template = templateForStyle(input.brand.designStyle);
  const [templateMd, vocabMd] = await Promise.all([
    fetchTemplateDoc(template, 'TEMPLATE.md'),
    fetchTemplateDoc(template, 'VOCABULARY.md'),
  ]);
  const brief = await authorBrandBrief(input, template);
  const cfg = config() ?? {
    GITHUB_TOKEN: '',
    GITHUB_OWNER: '',
    TEMPLATES_REPO: '',
    VPS_HOST: '',
    VPS_USER: '',
    VERCEL_TOKEN: null,
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
  };
  return {
    template,
    authorSystem: briefAuthorSystem(),
    authorInput: briefAuthorInput(input, template, templateMd, vocabMd),
    brief,
    testBrief: buildTestBrief(input.brand.name),
    brandJson: JSON.stringify(buildBrandJson(input, cfg), null, 2),
  };
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
  const template = templateForStyle(input.brand.designStyle);
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
    //    The brief is AUTHORED by AI (art-directed build prompt; mail-merge fallback).
    const brandBrief = await authorBrandBrief(input, template);
    const payload = JSON.stringify({
      kind: 'provision',
      slug: input.slug,
      template,
      brandName: input.brand.name,
      brandJson: JSON.stringify(buildBrandJson(input, cfg), null, 2),
      brandBrief,
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
