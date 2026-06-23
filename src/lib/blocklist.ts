import AsyncStorage from '@react-native-async-storage/async-storage';

// On-device block list for the Market (Apple Guideline 1.2 "block abusive users"). A blocked brand's
// content is hidden from THIS viewer's Market. Local-only by design (migration-free MVP) — it travels
// with the device, which is sufficient for the moderation UX; pair it with /api/report for the
// server-side report-to-ops. An in-memory cache keeps reads cheap during a session.
const KEY = 'nc_blocked_brands';
let cache: Set<string> | null = null;

export async function getBlockedBrands(): Promise<Set<string>> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    cache = new Set();
  }
  return cache;
}

export async function blockBrand(slug: string): Promise<void> {
  const set = await getBlockedBrands();
  set.add(slug);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    /* best-effort */
  }
}

export async function unblockBrand(slug: string): Promise<void> {
  const set = await getBlockedBrands();
  set.delete(slug);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    /* best-effort */
  }
}
