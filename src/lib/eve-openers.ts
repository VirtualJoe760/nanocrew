import AsyncStorage from '@react-native-async-storage/async-storage';

// WHAT SHE ALREADY SAID (Joe, 2026-08-18: "she needs real diversity and authenticity"). A model has
// no memory between sessions, so left alone it converges on its single most likely opener — which
// is why every launch sounded like "Hi Joe, what's on the agenda?". We keep her last few openings
// ON DEVICE and hand them back as a do-not-repeat list, plus the gap since the last one so she can
// say something true ("been a few days") instead of something generic.

const KEY = 'eve.openers.v1';
const KEEP = 8;

type Opener = { text: string; at: number };

async function read(): Promise<Opener[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Opener[]) : [];
    return Array.isArray(list) ? list.filter((o) => typeof o?.text === 'string') : [];
  } catch {
    return [];
  }
}

/** Her recent opening lines, newest first — fed to the greeting so she never reuses one. */
export async function recentOpeners(): Promise<string[]> {
  return (await read()).map((o) => o.text);
}

/** Hours since she last opened a session — lets her greet a return honestly. */
export async function hoursSinceLastOpen(): Promise<number | null> {
  const [last] = await read();
  return last ? Math.max(0, Math.round((Date.now() - last.at) / 3_600_000)) : null;
}

/** Record what she actually opened with (first line of a session). */
export async function rememberOpener(text: string): Promise<void> {
  const t = text.trim();
  if (!t) return;
  try {
    const list = await read();
    if (list[0]?.text === t) return; // same line twice in a row — already known
    await AsyncStorage.setItem(KEY, JSON.stringify([{ text: t, at: Date.now() }, ...list].slice(0, KEEP)));
  } catch {
    /* best-effort — a missing history only costs her some variety */
  }
}
