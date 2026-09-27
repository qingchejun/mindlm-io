import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { compactBlocks, type Document } from '../outline/blocks.js';
import { DEFAULTS } from '../util/env.js';
import { inputError, usageError } from '../util/errors.js';
import { USER_AGENT } from '../util/version.js';
import { stripBoilerplate } from './boilerplate.js';
import {
  assertAcceptedMime,
  assertFetchAllowed,
  parseContentType,
  readBodyLimited,
} from './guard.js';
import { htmlToBlocks } from './html-to-blocks.js';
import { textToDocument } from './text.js';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface UrlSource {
  url: string;
  finalUrl: string;
  title: string | undefined;
  byline: string | undefined;
  siteName: string | undefined;
  fetchedAt: string;
  contentType: string;
}

export type UrlFetchResult =
  | { kind: 'document'; source: UrlSource; document: Document }
  /** A PDF answered over HTTP — handed to the PDF pipeline by the caller. */
  | { kind: 'pdf'; source: UrlSource; bytes: Uint8Array };

export interface UrlOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  maxChars?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export async function fetchUrlDocument(
  rawUrl: string,
  options: UrlOptions = {},
): Promise<UrlFetchResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw usageError(`"${rawUrl}" is not a valid URL.`);
  }

  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULTS.urlTimeoutMs;
  const maxRedirects = options.maxRedirects ?? DEFAULTS.urlMaxRedirects;
  const maxBytes = options.maxBytes ?? DEFAULTS.urlMaxBytes;

  // One budget for the whole redirect chain, not per hop.
  const signal = AbortSignal.timeout(timeoutMs);

  let current = url;
  let response: Response | undefined;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    // Re-checked on every hop: a redirect is an attacker-controlled URL too.
    await assertFetchAllowed(current);

    try {
      response = await doFetch(current, {
        redirect: 'manual',
        signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,text/plain,text/markdown,application/pdf;q=0.9',
          'accept-language': '*',
        },
      });
    } catch (cause) {
      if (signal.aborted) {
        throw inputError(`Timed out after ${timeoutMs}ms fetching ${current.href}.`);
      }
      throw inputError(`Could not fetch ${current.href}: ${describeFetchError(cause)}`);
    }

    if (!REDIRECT_STATUSES.has(response.status)) break;

    const location = response.headers.get('location');
    await response.body?.cancel().catch(() => {});
    if (!location) break;
    if (hop === maxRedirects) {
      throw inputError(`Too many redirects (more than ${maxRedirects}) starting at ${url.href}.`);
    }
    current = new URL(location, current);
    response = undefined;
  }

  if (!response) throw inputError(`Too many redirects starting at ${url.href}.`);
  if (!response.ok) {
    throw inputError(`${current.href} returned HTTP ${response.status}.`);
  }

  const contentTypeHeader = response.headers.get('content-type');
  const { mime, charset } = parseContentType(contentTypeHeader);
  assertAcceptedMime(mime, current.href);

  const bytes = await readBodyLimited(response, maxBytes);
  const source: UrlSource = {
    url: url.href,
    finalUrl: current.href,
    title: undefined,
    byline: undefined,
    siteName: undefined,
    fetchedAt: new Date().toISOString(),
    contentType: mime,
  };

  if (mime === 'application/pdf' || looksLikePdf(bytes)) {
    return { kind: 'pdf', source: { ...source, contentType: 'application/pdf' }, bytes };
  }

  const text = decodeBody(bytes, charset);

  if (mime === 'text/html' || mime === 'application/xhtml+xml' || looksLikeHtml(text)) {
    const article = extractArticle(text, current.href);
    return {
      kind: 'document',
      source: { ...source, ...article.meta },
      document: {
        title: article.meta.title,
        blocks: compactBlocks(article.blocks),
        truncated: false,
      },
    };
  }

  const document = textToDocument(text, options.maxChars ? { maxChars: options.maxChars } : {});
  return { kind: 'document', source: { ...source, title: document.title }, document };
}

function describeFetchError(cause: unknown): string {
  if (cause instanceof Error) {
    const code = (cause as { cause?: { code?: string } }).cause?.code;
    return code ? `${cause.message} (${code})` : cause.message;
  }
  return String(cause);
}

function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

function looksLikeHtml(text: string): boolean {
  return /<\s*(!doctype html|html|body|div|p|h1|article)\b/i.test(text.slice(0, 2000));
}

/**
 * Decodes a response body. The HTTP charset wins; failing that we sniff
 * `<meta charset>` from the head of the document, which is how Chinese pages
 * served as GBK without a header still come out readable.
 */
export function decodeBody(bytes: Uint8Array, headerCharset?: string): string {
  const bom = detectBom(bytes);
  if (bom) return decodeWith(bytes, bom);

  if (headerCharset) {
    const decoded = tryDecode(bytes, headerCharset);
    if (decoded !== undefined) return decoded;
  }

  const sniffed = sniffMetaCharset(bytes);
  if (sniffed) {
    const decoded = tryDecode(bytes, sniffed);
    if (decoded !== undefined) return decoded;
  }

  return decodeWith(bytes, 'utf-8');
}

function detectBom(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return undefined;
}

function sniffMetaCharset(bytes: Uint8Array): string | undefined {
  // Latin-1 round-trips every byte, so ASCII markup is readable regardless of
  // the real encoding — enough to find the declaration itself.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  const meta =
    /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head) ??
    /<\?xml[^>]+encoding\s*=\s*["']([\w-]+)["']/i.exec(head);
  return meta?.[1]?.toLowerCase();
}

function tryDecode(bytes: Uint8Array, label: string): string | undefined {
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return undefined;
  }
}

function decodeWith(bytes: Uint8Array, label: string): string {
  return new TextDecoder(label, { fatal: false }).decode(bytes).replace(/^﻿/, '');
}

interface ArticleResult {
  blocks: ReturnType<typeof htmlToBlocks>;
  meta: { title: string | undefined; byline: string | undefined; siteName: string | undefined };
}

/** Readability first; a plain body walk when it finds nothing it likes. */
export function extractArticle(html: string, documentUrl: string): ArticleResult {
  // linkedom leaves `documentElement` null for input it cannot recognise as a
  // document (an empty body, a tag-soup fragment), and reading `.title` then
  // throws — so make sure it always gets a document shape.
  const source = /<html[\s>]/i.test(html)
    ? html
    : `<!doctype html><html><head></head><body>${html}</body></html>`;
  const { document } = parseHTML(source);
  const documentTitle = document.title?.trim() || undefined;

  // Before Readability, not after: it deletes a container that holds little more
  // than a heading, which is exactly what a section title plus an "[edit]" link
  // looks like on a wiki. Stripping the furniture first keeps the headings.
  stripBoilerplate(document as never);

  let parsed: ReturnType<Readability['parse']> = null;
  try {
    // linkedom's Document is structurally compatible with what Readability needs.
    parsed = new Readability(document as never, { charThreshold: 200 }).parse();
  } catch {
    parsed = null;
  }

  const fallbackSiteName = hostnameOf(documentUrl);

  if (parsed?.content) {
    const blocks = htmlToBlocks(parsed.content);
    if (blocks.length > 0) {
      return {
        blocks,
        meta: {
          title: parsed.title?.trim() || documentTitle,
          byline: parsed.byline?.trim() || undefined,
          siteName: parsed.siteName?.trim() || fallbackSiteName,
        },
      };
    }
  }

  // Fallback: the whole document, minus the tags htmlToBlocks already ignores.
  return {
    blocks: htmlToBlocks(html),
    meta: { title: documentTitle, byline: undefined, siteName: fallbackSiteName },
  };
}

function hostnameOf(documentUrl: string): string | undefined {
  try {
    return new URL(documentUrl).hostname || undefined;
  } catch {
    return undefined;
  }
}
