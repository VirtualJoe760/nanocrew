// Server-side: verify a Supabase access token from the Authorization header by asking
// Supabase's auth API who it belongs to. Used by API routes that need the creator.

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

export interface AuthedUser {
  id: string;
  email: string;
}

export async function getUserFromRequest(req: Request): Promise<AuthedUser | null> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token || !SUPABASE_URL) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { id?: string; email?: string };
    if (!user.id || !user.email) return null;
    return { id: user.id, email: user.email };
  } catch {
    return null;
  }
}
