import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import type { BrandResult, ChatMessage } from '@/lib/interview';

// Storefront provisioning: when a store is born, clone the template repo into a new
// per-brand repo, then have a Claude session on the VPS apply the brand to it
// (templates + brand tokens — never rebuild the wheel).
//
// Env contract (all required; provisioning silently skips when any is missing):
//   GITHUB_TOKEN           fine-grained token with repo create/content rights
//   GITHUB_OWNER           e.g. VirtualJoe760
//   STOREFRONT_TEMPLATE    e.g. VirtualJoe760/nanocrew-storefront-template (a template repo)
//   VPS_HOST               DigitalOcean droplet IP/hostname
//   VPS_USER               ssh user on the droplet (needs claude CLI + ANTHROPIC_API_KEY)

type ProvisionInput = {
  storeId: string;
  slug: string;
  brand: BrandResult;
  logoUrl: string | null;
  transcript: ChatMessage[];
};

function config() {
  const { GITHUB_TOKEN, GITHUB_OWNER, STOREFRONT_TEMPLATE, VPS_HOST, VPS_USER } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !STOREFRONT_TEMPLATE || !VPS_HOST || !VPS_USER) return null;
  return { GITHUB_TOKEN, GITHUB_OWNER, STOREFRONT_TEMPLATE, VPS_HOST, VPS_USER };
}

/** The brief Claude works from on the VPS — the interview, distilled into directives. */
function buildBrief(brand: BrandResult, logoUrl: string | null, transcript: ChatMessage[]): string {
  const palette = brand.designSystem.palette.map((p) => `- ${p.role}: ${p.hex}`).join('\n');
  const convo = transcript
    .slice(-24)
    .map((m) => `${m.role === 'user' ? 'creator' : 'consultant'}: ${m.text}`)
    .join('\n');
  return `You are customizing a storefront template for the clothing brand "${brand.name}".

THE BRAND
- Name: ${brand.name}
- Tagline: ${brand.tagline}
- Mission: ${brand.mission}
- Audience: ${brand.audience}
- Voice: ${brand.voice}
- Story: ${brand.story}
- Vibe: ${brand.vibeKeywords.join(', ')}
- Design style: ${brand.designStyle}
- Products they're excited about: ${brand.products.join(', ')}
- Logo: ${logoUrl ?? 'none yet'} (${brand.logo.direction})

DESIGN SYSTEM (HARD CONSTRAINTS — the creator chose these explicitly)
Palette (use EXACTLY these colors, nothing else):
${palette}
Typography: display = ${brand.designSystem.typography.display}; body = ${brand.designSystem.typography.body}
Texture cues: ${brand.designSystem.texture.join(', ')}
Motion cues: ${brand.designSystem.motion.join(', ')}

WHAT TO DO
Apply this brand across the template: theme colors, fonts, store name, logo, hero and
about copy written in the brand's voice, page titles/metadata. Do NOT restructure the
codebase, do NOT touch commerce/checkout logic, do NOT add dependencies. Keep every
existing route working. Write copy that sounds like the brand, grounded in the story
above. When finished, run the typecheck if one exists and fix what you broke.

THE INTERVIEW (the creator's own words — mine this for copy)
${convo}
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

/**
 * Fire-and-forget from the store route. Creates the repo, then hands the brief to a
 * Claude session on the VPS. Progress lands on the store row (deployment_url / error).
 */
export async function provisionStorefront(input: ProvisionInput): Promise<void> {
  const cfg = config();
  if (!cfg) {
    console.log('[provision] skipped — env not configured');
    return;
  }
  const repo = `store-${input.slug}`;
  const fullRepo = `${cfg.GITHUB_OWNER}/${repo}`;
  try {
    // 1. New repo from the template (GitHub generate API).
    const res = await fetch(`https://api.github.com/repos/${cfg.STOREFRONT_TEMPLATE}/generate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
      body: JSON.stringify({
        owner: cfg.GITHUB_OWNER,
        name: repo,
        description: `${input.brand.name} — Nanocrew storefront`,
        private: true,
      }),
    });
    if (!res.ok && res.status !== 422) {
      // 422 = repo already exists; treat as resumable
      throw new Error(`repo generate failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }

    // 2. Hand the brief to Claude on the VPS. The token rides the clone URL so the
    //    droplet needs no GitHub credentials of its own.
    const brief = buildBrief(input.brand, input.logoUrl, input.transcript);
    const script = `set -e
mkdir -p ~/stores && cd ~/stores
rm -rf ${repo}
git clone https://x-access-token:${cfg.GITHUB_TOKEN}@github.com/${fullRepo}.git ${repo}
cd ${repo}
cat > BRAND_BRIEF.md <<'NANOCREW_BRIEF_EOF'
${brief}
NANOCREW_BRIEF_EOF
claude -p "Read BRAND_BRIEF.md and apply the brand to this storefront template exactly as it instructs." --dangerously-skip-permissions --max-turns 100 || true
git add -A
git -c user.name=nanocrew -c user.email=studio@nanocrew.app commit -m "Apply ${input.brand.name.replace(/"/g, '')} brand via Nanocrew studio" || true
git push origin HEAD
`;
    await run('ssh', ['-o', 'StrictHostKeyChecking=accept-new', `${cfg.VPS_USER}@${cfg.VPS_HOST}`, 'bash -s'], {
      input: script,
      timeoutMs: 20 * 60 * 1000, // Claude sessions take a while
    });

    await db
      .update(schema.stores)
      .set({ deploymentUrl: `https://github.com/${fullRepo}` })
      .where(eq(schema.stores.id, input.storeId));
    console.log(`[provision] ${fullRepo} branded and pushed`);
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
