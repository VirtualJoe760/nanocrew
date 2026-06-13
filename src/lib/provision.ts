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

async function run(cmd: string, args: string[], opts?: { input?: string; timeoutMs?: number }) {
  const { execFile } = await import('node:child_process');
  return new Promise<string>((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { timeout: opts?.timeoutMs ?? 120000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => (err ? reject(new Error(`${cmd} failed: ${stderr || err.message}`)) : resolve(stdout)),
    );
    if (opts?.input) {
      child.stdin?.write(opts.input);
      child.stdin?.end();
    }
  });
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

/** Create the Vercel project (idempotent) and kick the first git deploy. */
async function deployToVercel(
  cfg: NonNullable<ReturnType<typeof config>>,
  fullRepo: string,
  repo: string,
): Promise<string | null> {
  if (!cfg.VERCEL_TOKEN) return null;
  const headers = { Authorization: `Bearer ${cfg.VERCEL_TOKEN}`, 'Content-Type': 'application/json' };

  const proj = await fetch('https://api.vercel.com/v11/projects', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: repo,
      framework: 'nextjs',
      gitRepository: { type: 'github', repo: fullRepo },
    }),
  });
  if (!proj.ok && proj.status !== 409) {
    // 409 = project already exists; anything else is a real failure
    throw new Error(`vercel project create failed: ${proj.status} ${(await proj.text()).slice(0, 300)}`);
  }

  const repoRes = await gh(cfg, `/repos/${fullRepo}`);
  if (!repoRes.ok) throw new Error(`github repo lookup failed: ${repoRes.status}`);
  const repoId = (await repoRes.json()).id as number;

  const dep = await fetch('https://api.vercel.com/v13/deployments', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: repo,
      project: repo,
      target: 'production',
      gitSource: { type: 'github', repoId, ref: 'main' },
    }),
  });
  if (!dep.ok) throw new Error(`vercel deploy failed: ${dep.status} ${(await dep.text()).slice(0, 300)}`);
  return `https://${repo}.vercel.app`;
}

/**
 * Fire-and-forget from the store route. Progress lands on the store row
 * (deployment_url on success). Errors are logged, never thrown to the caller.
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

    // 2. Forge: sparse-clone the chosen template out of the monorepo, write
    //    brand.json + briefs, let Claude apply the brand, gate on the build, push.
    //    All dynamic content rides single-quoted heredocs so nothing expands.
    const brandJson = JSON.stringify(buildBrandJson(input, cfg), null, 2);
    const brandBrief = buildBrandBrief(input, template);
    const testBrief = buildTestBrief(input.brand.name);
    const script = `set -e
export PATH="$HOME/.local/bin:$PATH"
[ -f ~/.claude-env ] && source ~/.claude-env
unset ANTHROPIC_API_KEY
mkdir -p ~/stores && cd ~/stores
exec 9>".forge.lock"
flock -w 1800 9 || { echo LOCK_TIMEOUT; exit 1; }
rm -rf ${repo} ${repo}-src
git clone --depth 1 --filter=blob:none --sparse https://x-access-token:${cfg.GITHUB_TOKEN}@github.com/${cfg.TEMPLATES_REPO}.git ${repo}-src
git -C ${repo}-src sparse-checkout set templates/${template}
mkdir ${repo}
cp -R ${repo}-src/templates/${template}/. ${repo}/
rm -rf ${repo}-src ${repo}/node_modules
cd ${repo}
mkdir -p briefs
cat > brand.json <<'NANOCREW_BRAND_JSON'
${brandJson}
NANOCREW_BRAND_JSON
cat > briefs/01-BRAND.md <<'NANOCREW_BRIEF_01'
${brandBrief}
NANOCREW_BRIEF_01
cat > briefs/02-TEST.md <<'NANOCREW_BRIEF_02'
${testBrief}
NANOCREW_BRIEF_02
git init -b main -q
git remote add origin https://x-access-token:${cfg.GITHUB_TOKEN}@github.com/${fullRepo}.git
pnpm install --silent 2>&1 | tail -2
claude -p "Read briefs/01-BRAND.md and apply it to this storefront. Then verify every item in briefs/02-TEST.md and fix anything that fails." --dangerously-skip-permissions --max-turns 80 < /dev/null > /tmp/${repo}-claude.log 2>&1 || true
tail -1 /tmp/${repo}-claude.log
pnpm run build > /tmp/${repo}-build.log 2>&1 && echo "BUILD_OK" || echo "BUILD_FAILED"
git add -A
git -c user.name=nanocrew -c user.email=studio@nanocrew.app commit -q -m "Apply ${input.brand.name.replace(/"/g, '')} brand via Nanocrew studio"
git push -q -u origin main
echo "FORGE_DONE"
`;
    const { homedir } = await import('node:os');
    const sshKey = process.env.VPS_SSH_KEY ?? `${homedir()}/.ssh/nanocrew`;
    const out = await run(
      'ssh',
      ['-i', sshKey, '-o', 'StrictHostKeyChecking=accept-new', `${cfg.VPS_USER}@${cfg.VPS_HOST}`, 'bash -s'],
      { input: script, timeoutMs: 40 * 60 * 1000 },
    );
    if (!out.includes('FORGE_DONE')) throw new Error('forge script did not complete');
    if (out.includes('BUILD_FAILED')) console.warn(`[provision] ${repo}: build failing at push time — check /tmp/${repo}-build.log on the forge`);

    // 3. Vercel project + first deploy (skipped without VERCEL_TOKEN).
    const url = await deployToVercel(cfg, fullRepo, repo);
    // Provisioned + deployed to the preview URL → 'ready' (reviewable/editable). It becomes
    // 'live' only when a custom domain is attached (Phase C go-live).
    await db
      .update(schema.stores)
      .set({ deploymentUrl: url ?? `https://github.com/${fullRepo}`, status: 'ready' })
      .where(eq(schema.stores.id, input.storeId));
    console.log(`[provision] ${fullRepo} branded, pushed${url ? `, deploying at ${url}` : ' (no Vercel token — repo only)'}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'provision failed';
    console.error(`[provision] ${repo}: ${msg}`);
    await db
      .update(schema.stores)
      .set({ deploymentUrl: null })
      .where(eq(schema.stores.id, input.storeId))
      .catch(() => {});
  }
}
