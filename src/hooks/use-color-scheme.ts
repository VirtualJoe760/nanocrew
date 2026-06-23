// Appearance is FORCED to dark app-wide. The entire visual system — the Skia dot-field background,
// the neon Venus avatar, and every glow effect — is dark-designed, so the app deliberately does NOT
// follow the device's light/dark setting (a light-mode device would otherwise get light chrome over
// the dark effects). Pair with app.json `userInterfaceStyle: "dark"` for the native chrome.
// To restore system-following, re-export the RN hook: `export { useColorScheme } from 'react-native';`
// Return type stays the usual union so consumers' `=== 'light'` branches remain type-valid (they
// just never hit at runtime); only the value is pinned.
export function useColorScheme(): 'light' | 'dark' {
  return 'dark';
}
