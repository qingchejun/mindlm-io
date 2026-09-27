import type { CSSItem, IPureNode, JSItem } from 'markmap-common';
import { Transformer } from 'markmap-lib';
import { pluginCheckbox, pluginFrontmatter } from 'markmap-lib/plugins';
import { fillTemplate } from 'markmap-render';
import { VERSION } from '../util/version.js';
import { cdnUrls, installedVersion, loadOfflineAssets } from './assets.js';
import { BRANDING_LABEL, BRANDING_URL } from './branding.js';

export interface RenderOptions {
  markdown: string;
  /** Page `<title>`; falls back to the frontmatter title, then the outline root. */
  title?: string;
  /** Inline every script so the file works with no network. Default true. */
  offline?: boolean;
  /** Show the markmap toolbar (zoom / fit / expand / dark). Default true. */
  toolbar?: boolean;
  /** Opt-in "Made with mindlm-mcp" footer link. Default false. */
  branding?: boolean;
  initialExpandLevel?: number;
  colorFreezeLevel?: number;
  maxWidth?: number;
}

export interface RenderResult {
  html: string;
  title: string;
  nodes: number;
  offline: boolean;
}

/**
 * Only the frontmatter and checkbox plugins are enabled. katex and hljs are
 * left out on purpose: both reference CDN stylesheets, which would silently
 * break offline exports.
 */
function createTransformer(): Transformer {
  const transformer = new Transformer([pluginFrontmatter, pluginCheckbox]);
  // markmap-lib defaults markdown-it to `html: true`. Outlines can come from
  // web pages and PDFs, so raw HTML must not survive into the rendered SVG.
  transformer.md.set({ html: false });
  return transformer;
}

export async function renderMindmapHtml(options: RenderOptions): Promise<RenderResult> {
  const offline = options.offline ?? true;
  const toolbar = options.toolbar ?? true;

  const transformer = createTransformer();
  const { root, frontmatter } = transformer.transform(options.markdown);

  const frontmatterOptions = frontmatter?.markmap ?? {};
  const jsonOptions = {
    ...frontmatterOptions,
    ...(options.initialExpandLevel === undefined
      ? {}
      : { initialExpandLevel: options.initialExpandLevel }),
    ...(options.colorFreezeLevel === undefined
      ? {}
      : { colorFreezeLevel: options.colorFreezeLevel }),
    ...(options.maxWidth === undefined ? {} : { maxWidth: options.maxWidth }),
  };

  const title = (options.title ?? frontmatter?.title ?? rootLabel(root) ?? 'Mind map').trim();

  const { baseJs, styles } = offline ? await offlineAssets(toolbar) : await cdnAssets(toolbar);

  let html = fillTemplate(root, { styles }, { baseJs, jsonOptions });
  html = setTitle(html, title);
  html = injectHead(html, `<meta name="generator" content="mindlm-mcp ${VERSION}" />`);
  if (toolbar) html = injectBeforeBodyEnd(html, toolbarScript());
  if (options.branding) html = injectBeforeBodyEnd(html, brandingFooter());

  return { html, title, nodes: countNodes(root), offline };
}

async function offlineAssets(toolbar: boolean): Promise<{ baseJs: JSItem[]; styles: CSSItem[] }> {
  const assets = await loadOfflineAssets();
  const baseJs: JSItem[] = [inlineScript(assets.d3), inlineScript(assets.view)];
  const styles: CSSItem[] = [];
  if (toolbar) {
    baseJs.push(inlineScript(assets.toolbarJs));
    styles.push({ type: 'style', data: assets.toolbarCss });
  }
  return { baseJs, styles };
}

async function cdnAssets(toolbar: boolean): Promise<{ baseJs: JSItem[]; styles: CSSItem[] }> {
  const [d3, view, toolbarVersion] = await Promise.all([
    installedVersion('d3'),
    installedVersion('markmap-view'),
    installedVersion('markmap-toolbar'),
  ]);
  const urls = cdnUrls({ d3, view, toolbar: toolbarVersion });
  const js = toolbar ? urls.js : urls.js.slice(0, 2);
  return {
    baseJs: js.map((src) => ({ type: 'script', data: { src } })),
    styles: toolbar ? urls.css.map((href) => ({ type: 'stylesheet', data: { href } })) : [],
  };
}

function inlineScript(source: string): JSItem {
  // Nothing we inline is user content, but a stray `</script>` in a minified
  // bundle would still end the tag early, so neutralise it unconditionally.
  return { type: 'script', data: { textContent: escapeScriptEnd(source) } };
}

/** Breaks `</script` without changing what the JS engine sees. */
export function escapeScriptEnd(source: string): string {
  return source.replace(/<\/(script)/gi, '<\\/$1');
}

function toolbarScript(): string {
  // Runs after markmap-render's own IIFE has created window.mm.
  const code = `(function () {
  var markmap = window.markmap;
  if (!markmap || !markmap.Toolbar || !window.mm) return;
  var toolbar = new markmap.Toolbar();
  toolbar.attach(window.mm);
  var el = toolbar.render();
  el.setAttribute('style', 'position:absolute;bottom:20px;right:20px');
  document.body.append(el);
})();`;
  return `<script>${code}</script>`;
}

function brandingFooter(): string {
  const style = [
    'position:fixed',
    'left:12px',
    'bottom:12px',
    'font:12px/1.4 ui-sans-serif,system-ui,sans-serif',
    'opacity:.55',
  ].join(';');
  return `<div style="${style}"><a href="${escapeHtml(BRANDING_URL)}" style="color:inherit">${escapeHtml(BRANDING_LABEL)}</a></div>`;
}

function setTitle(html: string, title: string): string {
  return html.replace('<title>Markmap</title>', `<title>${escapeHtml(title)}</title>`);
}

function injectHead(html: string, snippet: string): string {
  return html.replace('</head>', `${snippet}\n</head>`);
}

function injectBeforeBodyEnd(html: string, snippet: string): string {
  return html.replace('</body>', `${snippet}\n</body>`);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function rootLabel(root: IPureNode | null): string | undefined {
  if (!root) return undefined;
  const text = root.content.replace(/<[^>]*>/g, '').trim();
  return text === '' ? undefined : decodeBasicEntities(text);
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function countNodes(root: IPureNode | null): number {
  if (!root) return 0;
  return 1 + root.children.reduce((total, child) => total + countNodes(child), 0);
}
