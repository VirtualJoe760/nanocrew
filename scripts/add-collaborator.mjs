// Grant a creator collaborator (admin + design) access to a store. The collaborator must have
// signed up to Nanocrew first (so a creators row keyed to their Supabase id exists) — this links
// that creator to the store. The store owner already has full access and is never listed here.
//
//   node scripts/add-collaborator.mjs <store-slug> <email> [role=admin]
//   e.g. node scripts/add-collaborator.mjs stephen-lawyer villagepark92@gmail.com
import fs from 'node:fs';
import postgres from 'postgres';

const [slug, email, role = 'admin'] = process.argv.slice(2);
if (!slug || !email) {
  console.error('usage: node scripts/add-collaborator.mjs <store-slug> <email> [role]');
  process.exit(1);
}
const url = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
const sql = postgres(url, { max: 1 });

const [store] = await sql`select id, name, creator_id from stores where slug=${slug}`;
if (!store) { console.error(`store '${slug}' not found`); await sql.end(); process.exit(1); }

const [creator] = await sql`select id, email from creators where lower(email)=lower(${email})`;
if (!creator) {
  console.error(`\nNo Nanocrew account for ${email} yet.\nHave them sign up in the app first (creates their creator record), then re-run this.\n`);
  await sql.end();
  process.exit(1);
}
if (creator.id === store.creator_id) {
  console.log(`${email} already OWNS ${store.name} — nothing to do.`);
  await sql.end();
  process.exit(0);
}

await sql`insert into store_collaborators (store_id, creator_id, role) values (${store.id}, ${creator.id}, ${role}) on conflict do nothing`;
console.log(`✓ ${email} is now a ${role} collaborator on ${store.name} (${slug}) — can admin + design for it.`);
await sql.end();
