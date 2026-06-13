import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// Post-launch site revisions: the creator describes a change in plain words (via Studio),
// and a constrained Claude session on the forge applies it to their existing store repo
// — same edit surface as branding (tokens/copy/composition only, never structure or
// commerce). The brand site redeploys on push. Fire-and-forget, like provisioning.
//
// Env contract mirrors provision.ts: GITHUB_TOKEN / GITHUB_OWNER / VPS_HOST / VPS_USER
// (+ optional VPS_SSH_KEY). Silently skips when unset.

type ReviseInput = {
  storeId: string;
  slug: string;
  storeName: string;
  request: string; // the creator's own words
};

function config() {
  const { GITHUB_TOKEN, GITHUB_OWNER, VPS_HOST, VPS_USER } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !VPS_HOST || !VPS_USER) return null;
  return { GITHUB_TOKEN, GITHUB_OWNER, VPS_HOST, VPS_USER };
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

/** Apply one plain-language change to a store's already-provisioned site. */
export async function reviseStorefront(input: ReviseInput): Promise<void> {
  const cfg = config();
  if (!cfg) {
    console.log('[revise] skipped — env not configured');
    return;
  }
  const repo = `store-${input.slug}`;
  const fullRepo = `${cfg.GITHUB_OWNER}/${repo}`;
  const brief = `# REVISION — ${input.storeName}

The creator asked for this change to their live storefront, in their own words:

"${input.request.replace(/"/g, "'")}"

Read TEMPLATE.md and VOCABULARY.md first. VOCABULARY.md translates everyday phrases
("slideshow", "the menu", "mobile bottom bar") into the blocks and files to edit. Apply
ONLY this change. Stay inside the allowed edit surface: brand.json tokens, content/**,
app/globals.css fallback vars, and composing existing blocks inside app/*/page.tsx.
NEVER add dependencies, new routes, or touch lib/api.ts, lib/cart.tsx, platform-auth, the
beacon, or the /admin pages. If the request maps to no existing block, leave a note in
your final message instead of inventing one. Run \`npm run build\` and fix what you break.`;

  try {
    const script = `set -e
export PATH="$HOME/.local/bin:$PATH"
[ -f ~/.claude-env ] && source ~/.claude-env
unset ANTHROPIC_API_KEY
mkdir -p ~/stores && cd ~/stores
rm -rf ${repo}
git clone --depth 1 https://x-access-token:${cfg.GITHUB_TOKEN}@github.com/${fullRepo}.git ${repo}
cd ${repo}
mkdir -p briefs
N=$(ls briefs/03-REVISION-*.md 2>/dev/null | wc -l | tr -d ' ')
BRIEF="briefs/03-REVISION-$((N+1)).md"
cat > "$BRIEF" <<'NANOCREW_REVISION_EOF'
${brief}
NANOCREW_REVISION_EOF
npm install --no-audit --no-fund 2>&1 | tail -1
claude -p "Read $BRIEF and apply exactly that change. Then run npm run build and fix anything you broke." --dangerously-skip-permissions --max-turns 60 < /dev/null > /tmp/${repo}-revise.log 2>&1 || true
npm run build > /tmp/${repo}-revise-build.log 2>&1 && echo BUILD_OK || echo BUILD_FAILED
git add -A
git -c user.name=nanocrew -c user.email=studio@nanocrew.app commit -q -m "Revision: ${input.request.slice(0, 60).replace(/"/g, "'")}" || true
git push -q origin HEAD
echo REVISE_DONE
`;
    const { homedir } = await import('node:os');
    const sshKey = process.env.VPS_SSH_KEY ?? `${homedir()}/.ssh/nanocrew`;
    const out = await run(
      'ssh',
      ['-i', sshKey, '-o', 'StrictHostKeyChecking=accept-new', `${cfg.VPS_USER}@${cfg.VPS_HOST}`, 'bash -s'],
      { input: script, timeoutMs: 30 * 60 * 1000 },
    );
    if (!out.includes('REVISE_DONE')) throw new Error('forge revision did not complete');
    await db.update(schema.stores).set({ updatedAt: new Date() }).where(eq(schema.stores.id, input.storeId));
    console.log(`[revise] ${fullRepo}: applied "${input.request.slice(0, 50)}"`);
  } catch (e) {
    console.error(`[revise] ${repo}: ${e instanceof Error ? e.message : 'failed'}`);
  }
}
