// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', '.expo/*', 'coverage/*', 'ui-smoke-out/*'] },
  {
    // skrypty narzędziowe uruchamiane w Node (nie w aplikacji)
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { Buffer: 'readonly', process: 'readonly', console: 'readonly', URL: 'readonly', setTimeout: 'readonly' } },
  },
]);
