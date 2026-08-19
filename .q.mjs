import postgres from 'postgres';
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n')
  .filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1).replace(/^["']|["']$/g,'')];}));
const sql = postgres(env.DATABASE_URL_SESSION || env.DATABASE_URL, { ssl: 'require', max: 1 });
const q = process.argv[2];
const rows = await sql.unsafe(q);
console.log(JSON.stringify(rows, null, 1));
await sql.end();
