import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// Comp / internal accounts — exempt from billing AND credit charges (the founder, team, demo
// accounts). It makes no sense to bill ourselves. Configured via COMP_EMAILS (a comma-separated
// list); falls back to PLATFORM_ADMIN_EMAILS so platform admins are comp by default.
const COMP = (process.env.COMP_EMAILS ?? process.env.PLATFORM_ADMIN_EMAILS ?? '')
  .toLowerCase()
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function isCompEmail(email: string | null | undefined): boolean {
  return !!email && COMP.includes(email.toLowerCase());
}

// Look up the creator's email and check it against the comp list. Cheap, but callers on hot paths
// can cache. Returns false when no comp list is configured.
export async function isCompCreator(creatorId: string): Promise<boolean> {
  if (!COMP.length) return false;
  const [c] = await db
    .select({ email: schema.creators.email })
    .from(schema.creators)
    .where(eq(schema.creators.id, creatorId))
    .limit(1);
  return isCompEmail(c?.email);
}
