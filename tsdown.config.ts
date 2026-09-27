import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22.12',
  outDir: 'dist',
  clean: true,
  dts: true,
  sourcemap: false,
  // The package is `"type": "module"`, so plain .js is already ESM — and it is
  // what `bin` and `exports` in package.json point at.
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  // Everything in `dependencies` stays external; only our own code is bundled.
  unbundle: false,
});
