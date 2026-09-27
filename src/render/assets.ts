import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * The browser assets a standalone markmap page needs. Paths are the same ones
 * `markmap-render` publishes as `baseJsPaths`, resolved out of node_modules so
 * the exported HTML can be opened with no network at all.
 *
 * katex and highlight.js are deliberately absent: their markmap plugins pull
 * stylesheets from a CDN, which would break the single-file promise.
 */
interface AssetSpec {
  /** Bare specifier used to locate the owning package. */
  pkg: string;
  /** Path inside that package. */
  file: string;
}

const D3: AssetSpec = { pkg: 'd3', file: 'dist/d3.min.js' };
const VIEW: AssetSpec = { pkg: 'markmap-view', file: 'dist/browser/index.js' };
const TOOLBAR_JS: AssetSpec = { pkg: 'markmap-toolbar', file: 'dist/index.js' };
const TOOLBAR_CSS: AssetSpec = { pkg: 'markmap-toolbar', file: 'dist/style.css' };

export interface OfflineAssets {
  d3: string;
  view: string;
  toolbarJs: string;
  toolbarCss: string;
}

let cached: Promise<OfflineAssets> | undefined;

/** Reads and caches the inlinable assets. ~350KB, so once per process is plenty. */
export function loadOfflineAssets(): Promise<OfflineAssets> {
  cached ??= (async () => {
    const [d3, view, toolbarJs, toolbarCss] = await Promise.all([
      readAsset(D3),
      readAsset(VIEW),
      readAsset(TOOLBAR_JS),
      readAsset(TOOLBAR_CSS),
    ]);
    return { d3, view, toolbarJs, toolbarCss };
  })();
  return cached;
}

/** Test seam: forget the cached assets. */
export function resetAssetCache(): void {
  cached = undefined;
}

async function readAsset(spec: AssetSpec): Promise<string> {
  const root = packageRoot(spec.pkg);
  return await readFile(join(root, spec.file), 'utf8');
}

const requireFrom = createRequire(import.meta.url);

/**
 * Finds a dependency's directory on disk by resolving its entry file and walking
 * up. d3 exposes neither `./package.json` nor `./dist/*` through `exports`, so
 * the subpath cannot be resolved directly.
 *
 * `require.resolve` rather than `import.meta.resolve`: the latter is absent
 * under Vite's SSR transform, which is how the test suite loads this module.
 */
export function packageRoot(specifier: string): string {
  const entry = requireFrom.resolve(specifier);
  const relative = specifier.split('/').join(sep);
  const segment = `${sep}node_modules${sep}${relative}${sep}`;
  const index = entry.indexOf(segment);
  if (index >= 0) return entry.slice(0, index + segment.length - 1);

  // Not under a node_modules path (workspace link, pnpm store): walk up until a
  // directory looks like the package root.
  let current = dirname(entry);
  for (let depth = 0; depth < 8; depth += 1) {
    if (current.endsWith(relative)) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(dirname(entry), '..');
}

/** jsDelivr URLs used by `--no-offline`, kept in step with the installed versions. */
export function cdnUrls(versions: { d3: string; view: string; toolbar: string }): {
  js: string[];
  css: string[];
} {
  const base = 'https://cdn.jsdelivr.net/npm';
  return {
    js: [
      `${base}/d3@${versions.d3}/dist/d3.min.js`,
      `${base}/markmap-view@${versions.view}/dist/browser/index.js`,
      `${base}/markmap-toolbar@${versions.toolbar}/dist/index.js`,
    ],
    css: [`${base}/markmap-toolbar@${versions.toolbar}/dist/style.css`],
  };
}

/** Reads the installed version of a dependency, so CDN URLs cannot drift. */
export async function installedVersion(specifier: string): Promise<string> {
  const manifest = JSON.parse(await readFile(join(packageRoot(specifier), 'package.json'), 'utf8'));
  return String(manifest.version ?? 'latest');
}
