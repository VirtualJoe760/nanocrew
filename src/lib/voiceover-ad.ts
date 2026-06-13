import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GoogleGenAI } from '@google/genai';

import { DEFAULT_VOICE } from '@/lib/voices';

// A cheap "video ad" — the alternative to Veo. A product image with a slow Ken-Burns
// push, an ElevenLabs voiceover of an AI-written ad line, composited with ffmpeg.
// ~$0.10/clip vs Veo's dollars-per-clip. Returns a 9:16 mp4 buffer.

const SCRIPT_MODEL = 'gemini-2.5-flash';

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(`${cmd}: ${stderr || err.message}`)) : resolve(stdout.toString()),
    );
  });
}

/** A punchy 1–2 sentence ad line (~6–9s spoken) in the brand's energy. */
async function adScript(opts: { name: string; storeName: string; tagline?: string | null }): Promise<string> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return `${opts.name}. From ${opts.storeName}. Made to order, shipped to your door.`;
  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: SCRIPT_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Write a punchy spoken ad line for a clothing product in a TikTok-style video ad.
Product: "${opts.name}" from the brand "${opts.storeName}"${opts.tagline ? ` (${opts.tagline})` : ''}.
ONE or TWO short sentences, ~6-9 seconds when spoken aloud. Confident, hype, scroll-stopping.
No hashtags, no emojis, no quotes — just the spoken words.`,
            },
          ],
        },
      ],
    });
    const line = res.text?.replace(/["#*]/g, '').trim();
    return line || `${opts.name}. Only from ${opts.storeName}.`;
  } catch {
    return `${opts.name}. Only from ${opts.storeName}.`;
  }
}

/** ElevenLabs TTS → mp3 buffer. */
async function tts(text: string, voiceId: string): Promise<Buffer> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY not configured');
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5', voice_settings: { stability: 0.4, similarity_boost: 0.8 } }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function generateVoiceoverAd(opts: {
  name: string;
  storeName: string;
  tagline?: string | null;
  imageUrl: string;
  voiceId?: string;
}): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'nc-ad-'));
  try {
    // 1. script + voiceover
    const script = await adScript(opts);
    const vo = await tts(script, opts.voiceId ?? DEFAULT_VOICE.id);
    const voPath = join(dir, 'vo.mp3');
    await writeFile(voPath, vo);

    // 2. product image
    const imgRes = await fetch(opts.imageUrl);
    if (!imgRes.ok) throw new Error(`image fetch ${imgRes.status}`);
    const imgPath = join(dir, 'img.png');
    await writeFile(imgPath, Buffer.from(await imgRes.arrayBuffer()));

    // 3. voiceover duration → video length (+0.6s tail), clamped to a sane range
    let dur = 8;
    try {
      const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', voPath]);
      const parsed = parseFloat(probe.trim());
      if (parsed > 0) dur = Math.min(20, Math.max(4, parsed + 0.6));
    } catch {
      /* keep default */
    }
    const frames = Math.round(dur * 30);

    // 4. composite: scale/crop to 1080x1920, slow zoom (Ken Burns), mux the voiceover
    const outPath = join(dir, 'ad.mp4');
    await run('ffmpeg', [
      '-y',
      '-loop',
      '1',
      '-i',
      imgPath,
      '-i',
      voPath,
      '-filter_complex',
      `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.0007,1.18)':d=${frames}:s=1080x1920:fps=30,format=yuv420p[v]`,
      '-map',
      '[v]',
      '-map',
      '1:a',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-t',
      String(dur),
      outPath,
    ]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
