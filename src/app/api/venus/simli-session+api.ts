import { getUserFromRequest } from '@/lib/auth';

// POST /api/venus/simli-session → mints a short-lived Simli session token from SIMLI_API_KEY
// SERVER-SIDE (the key never reaches the client). The client (simli-venus.*) connects with the
// returned token over Simli's LiveKit transport, so it needs neither the API key nor ICE servers.
// Gated to the Venus-Lab tester because each Simli session costs credits. Mirrors the auth→external
// pattern of enhance+api.ts (auth first, then the outbound fetch — the Railway/postgres-js rule).
// See docs/studio/VENUS_AVATAR.md "Simli (alternative renderer)".

const VENUS_LAB_EMAIL = 'josephsardella@gmail.com';
// POC placeholder = Simli's public sample face. Swap for a custom Venus face (Simli "create face"
// from the target render) by setting SIMLI_FACE_ID.
const DEFAULT_FACE_ID = '5514e24d-6086-46a3-ace4-6a7264e5cb7c';

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if ((user.email ?? '').trim().toLowerCase() !== VENUS_LAB_EMAIL) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  const apiKey = process.env.SIMLI_API_KEY;
  if (!apiKey) return Response.json({ error: 'SIMLI_API_KEY not configured' }, { status: 500 });
  const faceId = process.env.SIMLI_FACE_ID || DEFAULT_FACE_ID;

  try {
    const res = await fetch('https://api.simli.ai/compose/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-simli-api-key': apiKey },
      body: JSON.stringify({ faceId, handleSilence: true, maxSessionLength: 600, maxIdleTime: 180 }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return Response.json({ error: `simli ${res.status}: ${text}`.slice(0, 300) }, { status: 502 });
    }
    const json = (await res.json()) as { session_token?: string };
    if (!json.session_token) return Response.json({ error: 'no session_token from simli' }, { status: 502 });
    return Response.json({ sessionToken: json.session_token, faceId });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'simli session failed' }, { status: 502 });
  }
}
