import { promises as fs } from 'fs';
import path from 'path';

// DEV ONLY — persist live-conversation transcripts as JSON under local-logs/ so the dev agent can
// read what the creator and Eve actually said (Joe, 2026-08-17: tuning her responses needs the
// verbatim exchanges). Hard-disabled in production; local-logs/ is gitignored.
const DIR = path.join(process.cwd(), 'local-logs');

export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production') return Response.json({ error: 'not found' }, { status: 404 });
  const body = (await req.json().catch(() => null)) as {
    sessionId?: string;
    startedAt?: string;
    messages?: { role: string; text: string }[];
  } | null;
  if (!body?.sessionId || !Array.isArray(body.messages)) {
    return Response.json({ error: 'sessionId and messages required' }, { status: 400 });
  }
  await fs.mkdir(DIR, { recursive: true });
  // One file per session: reuse the session's file if it exists, else claim the next number.
  const files = (await fs.readdir(DIR)).filter((f) => /^conversation_\d{4}\.json$/.test(f));
  let file: string | undefined;
  for (const f of files) {
    try {
      const j = JSON.parse(await fs.readFile(path.join(DIR, f), 'utf8')) as { sessionId?: string };
      if (j.sessionId === body.sessionId) { file = f; break; }
    } catch { /* skip unreadable */ }
  }
  if (!file) {
    const next = files.map((f) => Number(f.slice(13, 17))).reduce((a, b) => Math.max(a, b), 0) + 1;
    file = `conversation_${String(next).padStart(4, '0')}.json`;
  }
  await fs.writeFile(
    path.join(DIR, file),
    JSON.stringify({ sessionId: body.sessionId, startedAt: body.startedAt ?? null, updatedAt: new Date().toISOString(), messages: body.messages }, null, 2),
  );
  return Response.json({ ok: true, file });
}
