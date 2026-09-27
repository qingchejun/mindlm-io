#!/usr/bin/env node
/**
 * Renders every Markdown outline in examples/ into docs/demo/ as a standalone
 * offline page. The Pages hero embeds docs/demo/quickstart.html in an iframe, so
 * this has to run before the site is uploaded.
 *
 * docs/demo/ is generated and gitignored — it is never committed. The renderer
 * comes from the built dist/, not from src/, so the site shows exactly what the
 * published package produces.
 *
 *   npm run build && npm run demo:gen
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXAMPLES = join(ROOT, 'examples');
const OUT = join(ROOT, 'docs', 'demo');

async function loadRenderer() {
  const entry = join(ROOT, 'dist', 'index.js');
  try {
    return (await import(pathToFileURL(entry).href)).renderMindmapHtml;
  } catch (cause) {
    console.error(`gen-demo: could not load ${entry} — run \`npm run build\` first.`);
    throw cause;
  }
}

const renderMindmapHtml = await loadRenderer();

const sources = (await readdir(EXAMPLES, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.md')
  .map((entry) => entry.name)
  .sort();

if (sources.length === 0) {
  console.error(`gen-demo: no *.md found in ${EXAMPLES}`);
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

for (const name of sources) {
  const markdown = await readFile(join(EXAMPLES, name), 'utf8');
  const { html, title, nodes } = await renderMindmapHtml({
    markdown,
    // Offline and unbranded, the same defaults the CLI and the MCP tool use.
    offline: true,
    toolbar: true,
    branding: false,
  });

  const target = join(OUT, `${basename(name, extname(name))}.html`);
  await writeFile(target, html, 'utf8');
  console.log(
    `gen-demo: ${name} → docs/demo/${basename(target)} · ${nodes} nodes · ` +
      `${Math.round(html.length / 1024)} KB · "${title}"`,
  );
}
