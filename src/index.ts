/**
 * Programmatic API. The MCP server and the CLI are both thin layers over these
 * functions; nothing here reads argv, writes to stdout or touches the network
 * unless you ask it to.
 */

import {
  type PdfOptions,
  type PdfSource,
  pdfBytesToDocument,
  pdfFileToDocument,
} from './extract/pdf.js';
import { textToDocument } from './extract/text.js';
import { fetchUrlDocument, type UrlOptions, type UrlSource } from './extract/url.js';
import type { Document } from './outline/blocks.js';
import { countChars } from './outline/blocks.js';
import { heuristicOutline } from './outline/heuristic.js';
import {
  countNodes,
  DEFAULT_MAX_CHILDREN,
  DEFAULT_MAX_DEPTH,
  type Outline,
  outlineDepth,
  outlineToMarkdown,
} from './outline/normalize.js';
import { renderMindmapHtml } from './render/html.js';

export { assertFetchAllowed, isPrivateAddress } from './extract/guard.js';
export { htmlToBlocks } from './extract/html-to-blocks.js';
export type { PdfResult, PdfSource } from './extract/pdf.js';
export { parsePageRange, pdfBytesToDocument, pdfFileToDocument } from './extract/pdf.js';
export { looksLikeMarkdown, textToDocument } from './extract/text.js';
export type { UrlFetchResult, UrlSource } from './extract/url.js';
export { fetchUrlDocument } from './extract/url.js';
export type { Block, Document } from './outline/blocks.js';
export { blocksToText, compactBlocks } from './outline/blocks.js';
export { heuristicOutline } from './outline/heuristic.js';
export type { Outline, OutlineNode } from './outline/normalize.js';
export {
  normalizeOutline,
  outlineFromBlocks,
  outlineToMarkdown,
  parseOutlineMarkdown,
} from './outline/normalize.js';
export type { RenderOptions, RenderResult } from './render/html.js';
export { renderMindmapHtml } from './render/html.js';
export { describeError, MindlmError } from './util/errors.js';
export { VERSION } from './util/version.js';

export interface OutlineOptions {
  title?: string;
  maxDepth?: number;
  maxChildren?: number;
}

export interface OutlineStats {
  inputChars: number;
  nodes: number;
  depth: number;
  truncated: boolean;
}

export interface OutlineResult {
  title: string;
  /** A valid Markdown outline, ready for `renderMindmapHtml`. */
  markdown: string;
  outline: Outline;
  stats: OutlineStats;
}

export const OUTLINE_DEFAULTS = {
  maxDepth: DEFAULT_MAX_DEPTH,
  maxChildren: DEFAULT_MAX_CHILDREN,
} as const;

/**
 * Turns an already-extracted document into an outline using the deterministic
 * heuristic. Model-backed refinement lives in the server/CLI layers, which call
 * this first and use the result as their draft and their fallback.
 */
export function outlineFromDocument(
  document: Document,
  options: OutlineOptions = {},
): OutlineResult {
  const outline = heuristicOutline(document, options);
  return {
    title: outline.title,
    markdown: outlineToMarkdown(outline),
    outline,
    stats: {
      inputChars: countChars(document.blocks),
      nodes: countNodes(outline),
      depth: outlineDepth(outline),
      truncated: document.truncated,
    },
  };
}

export function textToOutline(text: string, options: OutlineOptions = {}): OutlineResult {
  const document = textToDocument(
    text,
    options.title === undefined ? {} : { title: options.title },
  );
  return outlineFromDocument(document, options);
}

export interface UrlOutlineResult extends OutlineResult {
  source: UrlSource;
  /** Set when the URL served a PDF and the PDF pipeline took over. */
  pdf?: PdfSource;
}

export async function urlToOutline(
  url: string,
  options: OutlineOptions & UrlOptions = {},
): Promise<UrlOutlineResult> {
  const fetched = await fetchUrlDocument(url, options);
  if (fetched.kind === 'pdf') {
    const pdf = await pdfBytesToDocument(fetched.bytes, { label: fetched.source.finalUrl });
    return {
      ...outlineFromDocument(pdf.document, options),
      source: fetched.source,
      pdf: pdf.source,
    };
  }
  return { ...outlineFromDocument(fetched.document, options), source: fetched.source };
}

export interface PdfOutlineResult extends OutlineResult {
  source: PdfSource;
}

export async function pdfToOutline(
  path: string,
  options: OutlineOptions & PdfOptions = {},
): Promise<PdfOutlineResult> {
  const result = await pdfFileToDocument(path, options);
  return { ...outlineFromDocument(result.document, options), source: result.source };
}

/** Convenience: outline a string and render it in one step. */
export async function textToMindmapHtml(
  text: string,
  options: OutlineOptions & { offline?: boolean; toolbar?: boolean; branding?: boolean } = {},
): Promise<{ outline: OutlineResult; html: string }> {
  const outline = textToOutline(text, options);
  const rendered = await renderMindmapHtml({
    markdown: outline.markdown,
    title: outline.title,
    ...(options.offline === undefined ? {} : { offline: options.offline }),
    ...(options.toolbar === undefined ? {} : { toolbar: options.toolbar }),
    ...(options.branding === undefined ? {} : { branding: options.branding }),
  });
  return { outline, html: rendered.html };
}
