import Constants from 'expo-constants';

// On a physical device, relative /api/* URLs don't resolve — point them at the Metro
// dev server host. On web they pass through unchanged.
export function apiUrl(path: string): string {
  const host = Constants.expoConfig?.hostUri;
  return host ? `http://${host}${path}` : path;
}
