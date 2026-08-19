// EVE'S PERSONA CODEGEN — src/eve/*.md → src/eve/persona.generated.ts
//
// React Native bundles JS, not arbitrary files, so her markdown can't be read at runtime on a
// phone. This compiles the files into one typed string module at build time, with a content hash
// so we can prove on the wire that the model received THESE files and not a stale bundle.
//
//   npm run eve:persona           # write the module
//   npm run eve:persona -- --check  # fail if the module is stale (CI / pre-commit)
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.join(process.cwd(), 'src/eve');
const OUT = path.join(ROOT, 'persona.generated.ts');
const CHECK = process.argv.includes('--check');

const FILES = ['identity', 'soul', 'user', 'conversation', 'guardrails'];

/** Strip the markdown chrome the model doesn't need — headings stay (they're structure), but the
 *  file's own title line is redundant once composed under a section header. */
const clean = (s) => s.replace(/^#\s+.*\n+/, '').trim();

async function main() {
  const parts = {};
  for (const name of FILES) {
    const body = clean(await readFile(path.join(ROOT, `${name}.md`), 'utf8'));
    if (!body) throw new Error(`src/eve/${name}.md is empty — refusing to generate a hollow persona`);
    parts[name] = body;
  }

  const jobDir = path.join(ROOT, 'jobs');
  const jobs = {};
  for (const f of (await readdir(jobDir)).filter((f) => f.endsWith('.md')).sort()) {
    const body = clean(await readFile(path.join(jobDir, f), 'utf8'));
    if (!body) throw new Error(`src/eve/jobs/${f} is empty`);
    jobs[f.replace('.md', '')] = body;
  }
  if (!Object.keys(jobs).length) throw new Error('no job files found');

  const hash = createHash('sha256').update(JSON.stringify({ parts, jobs })).digest('hex').slice(0, 12);
  const lit = (s) => JSON.stringify(s);
  const out = `// GENERATED FILE — DO NOT EDIT.
// Source: src/eve/*.md + src/eve/jobs/*.md · regenerate with \`npm run eve:persona\`.
// Her character is authored as markdown (see src/eve/README.md); this module is how it reaches a
// device, since React Native cannot read .md at runtime.

export const EVE_PARTS = {
${FILES.map((n) => `  ${n}: ${lit(parts[n])},`).join('\n')}
} as const;

export const EVE_JOBS = {
${Object.keys(jobs).map((n) => `  ${n}: ${lit(jobs[n])},`).join('\n')}
} as const;

export type EveJob = keyof typeof EVE_JOBS;

/** Hash of the markdown this module was built from — logged at session setup so a stale bundle is
 *  provable rather than suspected. */
export const EVE_PERSONA_HASH = '${hash}';
`;

  const current = await readFile(OUT, 'utf8').catch(() => '');
  if (CHECK) {
    if (current !== out) {
      console.error('✗ persona.generated.ts is STALE — run `npm run eve:persona`');
      process.exit(1);
    }
    console.log(`✓ persona in sync (${hash})`);
    return;
  }
  await writeFile(OUT, out);
  const chars = Object.values(parts).concat(Object.values(jobs)).reduce((n, s) => n + s.length, 0);
  console.log(`✓ ${FILES.length} parts + ${Object.keys(jobs).length} jobs → ${chars} chars · hash ${hash}`);
}

await main();
