// TALK TO EVE FROM THE TERMINAL (Joe, 2026-08-18: "generate a few voice prompts, play them on the
// computer, get her to respond — this way you can start to test it yourself").
//
// How it works: the iOS Simulator listens on the Mac's default INPUT, and the Mac's default OUTPUT
// is its speakers — so a line spoken through the speakers reaches Eve exactly like a human in the
// room. ElevenLabs renders the line (a different voice from hers, so nothing is ambiguous), afplay
// puts it in the air, and the dev build's transcript log gives back what she heard and said.
//
//   set -a; . ./.env.local; set +a
//   node scripts/talk-to-eve.mjs "Hi Eve, tell me about life"
//   node scripts/talk-to-eve.mjs --listen            # just show the transcript delta
//
// Flags: --voice <id>  --wait <seconds>  --listen
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const run = promisify(execFile);
const LOGS = path.join(process.cwd(), 'local-logs');
const KEY = process.env.ELEVENLABS_API_KEY;
const VOICE = process.env.ELEVEN_VOICE ?? 'CwhRBWXzGAHq8TQ4Fs17'; // Roger — laid-back male, clearly not Eve

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const listenOnly = args.includes('--listen');
const waitFor = Number(flag('wait', 12));
const line = args.filter((a) => !a.startsWith('--') && a !== flag('voice') && a !== String(waitFor)).join(' ').trim();

/** The newest transcript file and its messages. */
async function transcript() {
  try {
    const files = (await readdir(LOGS)).filter((f) => f.endsWith('.json')).sort();
    const newest = files.at(-1);
    if (!newest) return { file: null, messages: [] };
    const d = JSON.parse(await readFile(path.join(LOGS, newest), 'utf8'));
    return { file: newest, messages: d.messages ?? [] };
  } catch {
    return { file: null, messages: [] };
  }
}

async function speak(text) {
  if (!KEY) throw new Error('ELEVENLABS_API_KEY not in the environment — `set -a; . ./.env.local; set +a`');
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      // Natural, unhurried — she has VAD on the other end and rushed speech gets clipped.
      voice_settings: { stability: 0.45, similarity_boost: 0.75, speed: 0.95 },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const file = `/tmp/eve-test-${Date.now()}.mp3`;
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  await run('afplay', [file]);
  return file;
}

const before = await transcript();
if (!listenOnly) {
  if (!line) throw new Error('give me a line to say');
  console.log(`🗣  "${line}"`);
  await speak(line);
  console.log('   (spoken — waiting for her)');
}

const deadline = Date.now() + waitFor * 1000;
let seen = before.messages.length;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 1500));
  const now = await transcript();
  // A new session file starts the count over.
  const fresh = now.file !== before.file ? now.messages : now.messages.slice(seen);
  if (now.file !== before.file) seen = 0;
  for (const m of fresh) {
    console.log(`${m.role === 'user' ? '👤 heard' : '🤖 EVE '} : ${m.text}`);
    seen++;
  }
}
