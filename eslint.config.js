// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // React Three Fiber renders three.js objects as JSX, so props like `position`, `args`,
    // `intensity`, and `attach` are valid R3F — not DOM attributes — but the core React rule
    // misflags them. These files also lazy-`require()` the heavy 3D / native modules on purpose,
    // to keep them out of the Metro / Expo Go bundle (see CLAUDE.md). Both are intentional here.
    files: [
      'src/components/venus-avatar*.tsx',
      'src/components/phone-scene*.tsx',
      'src/components/backgrounds/**/*.tsx',
    ],
    rules: {
      'react/no-unknown-property': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // SSR / native seams: AsyncStorage and the lip-sync audio module are require()d only on a real
    // client (each file documents why). A static import would break the server render / Metro bundle.
    files: ['src/lib/supabase.ts', 'src/lib/venus-lipsync.ts'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
]);
