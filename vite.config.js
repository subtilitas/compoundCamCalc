import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Release channel of the build: 'main' (the default) or the release tag
// vMAJOR.MINOR.PATCH that scripts/build-site.js builds into its own folder.
const channel = process.env.APP_CHANNEL || 'main';
if (!/^(main|v(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5}))$/.test(channel)) {
  throw new Error(`APP_CHANNEL must be main or vMAJOR.MINOR.PATCH, got "${channel}"`);
}

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_CHANNEL__: JSON.stringify(channel),
  },
  build: {
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  test: {
    include: ['tests/unit/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['src/core/**', 'src/state/**', 'src/export/**'],
      thresholds: {
        lines: 90,
      },
    },
  },
});
