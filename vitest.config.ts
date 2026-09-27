import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The Pages link checker is a plain .mjs script run by CI; its test imports
    // that file directly rather than a TypeScript copy that could drift.
    include: ['test/**/*.test.ts', 'test/**/*.test.mjs'],
    environment: 'node',
    // Builds dist/ once, so the e2e tests can run the published entry points
    // and `npm test` works from a clean checkout.
    globalSetup: ['test/e2e/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
