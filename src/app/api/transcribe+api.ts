import { GoogleGenAI } from '@google/genai';

import { getUserFromRequest } from '@/lib/auth';

// POST /api/transcribe { audio } — verbatim transcription of a base64 m4a/mp4 recording.
// Used by the site-critique flow: the creator talks Venus through site changes while
// marking up the page; we transcribe that into the revision brief sent to Claude.
const MODEL = 'gemini-2.5-flash';

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: 'transcription not configured' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { audio?: string } | null;
  if (!body?.audio) return Response.json({ error: 'audio required' }, { status: 400 });

  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'audio/mp4', data: body.audio } },
            { text: 'Transcribe this audio verbatim. Reply with ONLY the transcribed words — no preamble, no quotes. If there is no clear speech, reply with an empty string.' },
          ],
        },
      ],
    });
    const text = (res.text ?? '').trim();
    return Response.json({ text });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Transcription failed' }, { status: 502 });
  }
}
