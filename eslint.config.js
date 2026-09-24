import js from '@eslint/js';
import globals from 'globals';

const pureDirs = ['src/core/**/*.js', 'src/state/**/*.js', 'src/export/**/*.js'];

export default [
  {
    ignores: ['dist/**', 'coverage/**', 'playwright-report/**', 'test-results/**'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' },
    },
  },
  {
    files: pureDirs,
    languageOptions: {
      globals: {},
    },
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'Pure modules must not use the DOM.' },
        { name: 'document', message: 'Pure modules must not use the DOM.' },
        { name: 'localStorage', message: 'Pure modules must not use browser storage.' },
        { name: 'navigator', message: 'Pure modules must not use the DOM.' },
      ],
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['**/ui/**', '**/worker/**'], message: 'Pure modules must not import UI or worker code.' }] },
      ],
    },
  },
  {
    files: ['scripts/**/*.js', 'tests/**/*.js', '*.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Callbacks passed to page.evaluate run in the browser.
    files: ['tests/e2e/**/*.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
