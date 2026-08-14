import { getUserFromRequest } from '@/lib/auth';
import { isCompEmail } from '@/lib/comp';
import { generateLogo, type LogoBrief } from '@/lib/logo';
import { guardRate } from '@/lib/rate-limit';

// POST /api/dev/logo — GEN LAB harness for EVE'S EXACT logo pipeline (lib/logo.ts — the same
// function store creation calls: same prompt assembly, same backdrop-validation retry, same
// chroma-key + upload). Dev-only: gated to platform admins + comp accounts. Uploads land in
// nanocrew/logo-lab, never the real logos folder.

const ADMIN = (process.env.PLATFORM_ADMIN_EMAILS ?? 'josephsardella@gmail.com')
  .toLowerCase()
  .split(',')
  .map((s) => s.trim());

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const email = user.email.toLowerCase();
  if (!ADMIN.includes(email) && !isCompEmail(email)) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  const limited = await guardRate(`dev-logo:${user.id}`, 20, 60);
  if (limited) return limited;

  let brief: LogoBrief;
  try {
    const b = (await req.json()) as {
      name?: string;
      direction?: string;
      designStyle?: string;
      palette?: { role?: string; hex?: string }[];
    };
    if (!b.name?.trim() || !b.direction?.trim()) throw new Error();
    brief = {
      name: b.name.trim().slice(0, 80),
      logo: { direction: b.direction.trim().slice(0, 400) },
      designStyle: (b.designStyle ?? 'minimalist').slice(0, 40),
      designSystem: {
        palette: (b.palette ?? [])
          .filter((p): p is { role: string; hex: string } => !!p.role && !!p.hex)
          .slice(0, 8),
      },
    };
  } catch {
    return Response.json({ error: 'name and direction required' }, { status: 400 });
  }

  const t0 = Date.now();
  const r = await generateLogo(brief, 'nanocrew/logo-lab');
  if (!r) return Response.json({ error: 'generation failed (model returned no image)' }, { status: 502 });
  return Response.json({ url: r.url, style: r.style, ms: Date.now() - t0 });
}
