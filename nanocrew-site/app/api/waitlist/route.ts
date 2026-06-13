import postgres from 'postgres';

export const runtime = 'nodejs';

// Lazily connect to the shared Postgres if configured. The waitlist lives in its own
// standalone table so it doesn't touch the app's migrations.
let sql: ReturnType<typeof postgres> | null = null;
let ensured = false;
function db() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!sql) sql = postgres(url, { prepare: false, max: 1 });
  return sql;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  let email = '';
  try {
    const b = (await req.json()) as { email?: string };
    email = (b.email || '').trim().toLowerCase();
  } catch {
    return Response.json({ ok: false, error: 'Bad request' }, { status: 400 });
  }
  if (!EMAIL_RE.test(email) || email.length > 320) {
    return Response.json({ ok: false, error: 'Enter a valid email.' }, { status: 400 });
  }

  const conn = db();
  if (!conn) {
    // No DB configured yet — accept gracefully so the page works before it's wired.
    console.log('[waitlist] (no DATABASE_URL set) signup:', email);
    return Response.json({ ok: true });
  }
  try {
    if (!ensured) {
      await conn`create table if not exists waitlist (
        email text primary key,
        created_at timestamptz not null default now()
      )`;
      ensured = true;
    }
    await conn`insert into waitlist (email) values (${email}) on conflict (email) do nothing`;
    return Response.json({ ok: true });
  } catch (e) {
    console.error('[waitlist]', e instanceof Error ? e.message : e);
    return Response.json({ ok: false, error: 'Could not save — try again.' }, { status: 500 });
  }
}
