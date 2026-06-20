// Tier-2 backend test harness — exercises this session's server work against the LOCAL dev server
// (Metro :8081, internal-key auth) + the DB, then cleans up. Run:
//   set -a; . ./.env.local; set +a; npx tsx scripts/backend-tests.ts
import postgres from 'postgres';

import { assertSafePrompt, ContentSafetyError } from '../src/lib/content-safety';
import { checkProviderPolicy } from '../src/lib/pod-policy';
import { ensureCreditAccount, debit, grant, InsufficientCreditsError, CREDIT_COSTS } from '../src/lib/credits';

const API = 'http://localhost:8081';
const KEY = process.env.INTERNAL_API_KEY!;
const CREATOR = 'c60f23f8-f804-4ecb-8018-36e90433a96e';
const STORE = '36d70399-eebb-4139-bfe2-e022f8f0cd60';
const SLUG = 'alpha-master';
const hdr = { 'Content-Type': 'application/json', 'x-internal-key': KEY, 'x-internal-creator': CREATOR };
const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 });

let pass = 0;
let fail = 0;
const ok = (cond: boolean, name: string, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const section = (s: string) => console.log(`\n── ${s} ──`);

async function main() {
  // 1) CONTENT-SAFETY (generation) — real assertSafePrompt
  section('1. content-safety (generation policy)');
  const csCases: [string, 'allow' | 'block'][] = [
    ['a promiscuous woman in seductive clothing', 'allow'],
    ['a nude person, tasteful fine art', 'allow'],
    ['Donald Trump with guns and a cigar like the Terminator', 'allow'],
    ['an american flag blowing in the wind', 'allow'],
    ['explicit porn scene, hardcore', 'block'],
    ['a blowjob', 'block'],
    ['Donald Trump getting his head blown off', 'block'],
    ['a dismembered mutilated corpse', 'block'],
    ['a nude child', 'block'],
    ['underage girl in lingerie', 'block'],
  ];
  for (const [p, exp] of csCases) {
    let blocked = false;
    try {
      assertSafePrompt(p);
    } catch (e) {
      blocked = e instanceof ContentSafetyError;
    }
    ok((exp === 'block') === blocked, `${exp.toUpperCase()} :: "${p.slice(0, 40)}"`);
  }

  // 2) POD POLICY (fulfillment) — real checkProviderPolicy
  section('2. pod-policy (Printful fulfillment policy)');
  const podCases: [string, 'ok' | 'block' | 'warn'][] = [
    ['american flag blowing in the wind', 'ok'],
    ['a nude woman tasteful fine art', 'ok'],
    ['Trump with guns and a cigar like Terminator', 'ok'],
    ['hardcore porn xxx scene', 'block'],
    ['a swastika white power slogan', 'block'],
    ['ISIS how to make a bomb', 'block'],
    ['pro-ana suicide guide', 'block'],
    ['a Disney Mickey Mouse parody', 'warn'],
  ];
  for (const [t, exp] of podCases) {
    const r = checkProviderPolicy('printful', t);
    const got = r.blocks.length ? 'block' : r.warnings.length ? 'warn' : 'ok';
    ok(got === exp, `${exp.toUpperCase()} :: "${t.slice(0, 40)}"`, got === exp ? '' : `got ${got}`);
  }

  // 3) CREDIT GATE — real debit + refund + insufficient, on an ISOLATED throwaway creator (NOT a
  //    comp account, which would no-op the debit). Fully cleaned up afterward.
  section('3. credit debit / refund / insufficient');
  const tId = crypto.randomUUID();
  try {
    await sql`insert into creators (id, email) values (${tId}, ${`credtest-${tId}@example.invalid`})`;
    const before = await ensureCreditAccount(tId); // signup bonus
    const afterDebit = await debit(tId, 'design_generate');
    ok(afterDebit === before - CREDIT_COSTS.design_generate, `debit design_generate (${CREDIT_COSTS.design_generate})`, `${before}→${afterDebit}`);
    const afterRefund = await grant(tId, CREDIT_COSTS.design_generate, 'refund');
    ok(afterRefund === before, 'refund restores balance', `→${afterRefund}`);
    let threw = false;
    try {
      await debit(tId, 'video_veo'); // 400cr > 200 balance → must throw
    } catch (e) {
      threw = e instanceof InsufficientCreditsError;
    }
    ok(threw, 'InsufficientCreditsError thrown when balance too low');
  } catch (e) {
    ok(false, 'credit test', e instanceof Error ? e.message : String(e));
  } finally {
    await sql`delete from credit_ledger where creator_id=${tId}`.catch(() => {});
    await sql`delete from credit_accounts where creator_id=${tId}`.catch(() => {});
    await sql`delete from creators where id=${tId}`.catch(() => {});
  }

  // 4) /api/generate — safety-settings fix (the bug that 400'd every image)
  section('4. /api/generate (safety-settings fix)');
  try {
    const r = await fetch(`${API}/api/generate`, { method: 'POST', headers: hdr, body: JSON.stringify({ prompt: 'an american flag blowing in the wind', background: 'filled', aspectRatio: '16:9' }) });
    const d = (await r.json()) as { image?: string; error?: string };
    ok(r.ok && !!d.image, 'flag generates (no safety_settings 400)', d.image ? d.image.slice(0, 48) : d.error);
  } catch (e) {
    ok(false, 'generate', e instanceof Error ? e.message : String(e));
  }

  // 5) /api/creator/site-assets — section:<key> write path
  section('5. /api/creator/site-assets (section write)');
  try {
    const url = 'https://res.cloudinary.com/dqqoorb1o/test-section.png';
    const r = await fetch(`${API}/api/creator/site-assets`, { method: 'POST', headers: hdr, body: JSON.stringify({ storeSlug: SLUG, slot: 'section:about', url }) });
    const [s] = await sql`select site_assets from stores where id=${STORE}`;
    const wrote = (s?.site_assets as any)?.sections?.about === url;
    const heroKept = !!(s?.site_assets as any)?.hero; // didn't clobber hero
    ok(r.ok && wrote && heroKept, 'section:about written, hero preserved');
    // cleanup: drop the test section back out
    const cur = (s?.site_assets ?? {}) as any;
    delete cur.sections?.about;
    await sql`update stores set site_assets=${sql.json(cur)} where id=${STORE}`;
  } catch (e) {
    ok(false, 'site-assets', e instanceof Error ? e.message : String(e));
  }

  // 6) /api/creator/revise — durable record (transcript + editPlan)
  section('6. /api/creator/revise (transcript + editPlan persisted)');
  let testRevId: string | null = null;
  try {
    const body = {
      storeSlug: SLUG,
      requestMd: 'The creator requested these changes:\n\n1. TEST make the button blue',
      transcript: [{ role: 'user', text: 'make the button blue' }],
      editPlan: { images: [{ slot: 'hero', prompt: 'TEST', generated: false, placed: false, error: 'TEST err' }], edits: ['make the button blue'] },
    };
    const r = await fetch(`${API}/api/creator/revise`, { method: 'POST', headers: hdr, body: JSON.stringify(body) });
    const d = (await r.json()) as { revisionId?: string };
    testRevId = d.revisionId ?? null;
    const [row] = await sql`select transcript, edit_plan from store_revisions where id=${testRevId}`;
    const hasT = Array.isArray(row?.transcript) && (row.transcript as any[]).length === 1;
    const hasP = (row?.edit_plan as any)?.counts?.total === 2 && (row?.edit_plan as any)?.images?.[0]?.error === 'TEST err';
    ok(r.ok && hasT && hasP, 'revision row persisted transcript + editPlan + counts');
  } catch (e) {
    ok(false, 'revise', e instanceof Error ? e.message : String(e));
  } finally {
    if (testRevId) await sql`delete from store_revisions where id=${testRevId}`.catch(() => {});
  }

  // 7) /api/publish — POD provider gate blocks a forbidden design (422) BEFORE Printful
  section('7. /api/publish (POD gate blocks → 422)');
  let dId: string | null = null;
  let cId: string | null = null;
  try {
    const [cat] = await sql`select id from catalogues where store_id=${STORE} limit 1`;
    if (!cat) throw new Error('no catalogue on alpha-master to attach a test composition');
    [{ id: dId }] = (await sql`insert into designs (store_id, catalogue_id, prompt, url) values (${STORE}, ${cat.id}, ${'hardcore porn xxx explicit sex'}, ${'https://x/y.png'}) returning id`) as any;
    [{ id: cId }] = (await sql`insert into compositions (store_id, catalogue_id, design_id, template_key, placement, status) values (${STORE}, ${cat.id}, ${dId}, ${'71'}, ${'front'}, ${'generating'}) returning id`) as any;
    const r = await fetch(`${API}/api/publish`, { method: 'POST', headers: hdr, body: JSON.stringify({ compositionId: cId, name: 'Test Product', variants: [{ printfulVariantId: 1, retailPriceCents: 2500, size: 'M', color: 'Black' }] }) });
    const d = (await r.json()) as { error?: string; blocks?: any[] };
    ok(r.status === 422 && d.error === 'provider_policy' && !!d.blocks?.length, 'forbidden design → 422 provider_policy (never reached Printful)', `${r.status} ${d.error ?? ''}`);
  } catch (e) {
    ok(false, 'publish gate', e instanceof Error ? e.message : String(e));
  } finally {
    if (cId) await sql`delete from compositions where id=${cId}`.catch(() => {});
    if (dId) await sql`delete from designs where id=${dId}`.catch(() => {});
  }

  console.log(`\n══ ${pass} passed, ${fail} failed ══`);
  await sql.end();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error('harness crashed:', e);
  await sql.end().catch(() => {});
  process.exit(1);
});
