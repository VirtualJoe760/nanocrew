import { GoogleGenAI } from '@google/genai';

import { getUserFromRequest } from '@/lib/auth';
import { guardRate } from '@/lib/rate-limit';

// POST /api/voice-live-token — mint a short-lived Gemini EPHEMERAL token so the app can connect
// DIRECTLY to the Gemini Live API (a WebSocket) without the real API key ever touching the client.
// The token starts a session within 2 min and the session may run up to 30 min. See live-voice.ts.
const LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const limited = await guardRate(`live:${user.id}`, 20, 60);
  if (limited) return limited;

  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: 'GOOGLE_GENAI_API_KEY not configured' }, { status: 500 });

  try {
    // Ephemeral tokens (authTokens.create) are a v1alpha feature — the default API version 404s.
    const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });
    const now = Date.now();
    const token = await ai.authTokens.create({
      config: {
        uses: 2, // initial connect + one reconnect
        expireTime: new Date(now + 30 * 60 * 1000).toISOString(), // token valid 30 min
        newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString(), // must start a session within 2 min
      },
    });
    return Response.json({ token: token.name, model: LIVE_MODEL });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed to mint token' }, { status: 502 });
  }
}
