// Forced dark — see use-color-scheme.ts. The web build mirrors native so the preview surfaces match
// the dark-designed effects; we don't follow the browser/OS light setting.
export function useColorScheme(): 'light' | 'dark' {
  return 'dark';
}
