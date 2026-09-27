import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, resolve } from 'node:path';
import { getDocumentProxy } from 'unpdf';
import {
  type Block,
  compactBlocks,
  type Document,
  heading,
  pageBreak,
  paragraph,
} from '../outline/blocks.js';
import { DEFAULTS, maxInputChars } from '../util/env.js';
import { inputError, usageError } from '../util/errors.js';

export interface PdfSource {
  path: string | undefined;
  pages: string | undefined;
  totalPages: number;
  hasOutline: boolean;
}

export interface PdfResult {
  document: Document;
  source: PdfSource;
  /** Page texts actually read, in page order. */
  pageTexts: { page: number; text: string }[];
  /** Bookmark titles flattened into headings, when the PDF has an outline. */
  outline: OutlineEntry[];
}

export interface OutlineEntry {
  level: number;
  title: string;
}

export interface PdfOptions {
  /** A 1-based page selection such as `"1-20"`, `"3"` or `"1-5,9"`. */
  pages?: string;
  maxPages?: number;
  maxChars?: number;
  /** Label used in errors and as a title fallback. */
  label?: string;
}

/** Expands `~` and resolves to an absolute path. */
export function resolveUserPath(input: string): string {
  const expanded =
    input === '~' || input.startsWith('~/') ? resolve(homedir(), input.slice(2)) : input;
  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
}

/**
 * Parses a page selection into a sorted, de-duplicated list of 1-based page
 * numbers. Returns undefined for an empty selection so callers can mean "all".
 */
export function parsePageRange(spec: string | undefined, totalPages: number): number[] | undefined {
  if (spec === undefined || spec.trim() === '') return undefined;

  const pages = new Set<number>();
  for (const part of spec.split(',')) {
    const piece = part.trim();
    if (piece === '') continue;
    const range = /^(\d+)\s*-\s*(\d+)?$/.exec(piece);
    if (range) {
      const from = Number(range[1]);
      const to = range[2] === undefined ? totalPages : Number(range[2]);
      if (from < 1 || to < from) throw usageError(`Invalid page range "${piece}".`);
      for (let page = from; page <= Math.min(to, totalPages); page += 1) pages.add(page);
      continue;
    }
    if (!/^\d+$/.test(piece)) {
      throw usageError(
        `Invalid page selection "${piece}".`,
        'Use forms like "1-20", "3" or "1-5,9".',
      );
    }
    const page = Number(piece);
    if (page >= 1 && page <= totalPages) pages.add(page);
  }

  if (pages.size === 0) {
    throw usageError(`Page selection "${spec}" selects no page of a ${totalPages}-page document.`);
  }
  return [...pages].sort((a, b) => a - b);
}

export async function pdfFileToDocument(
  inputPath: string,
  options: PdfOptions = {},
): Promise<PdfResult> {
  const path = resolveUserPath(inputPath);

  let size: number;
  try {
    const info = await stat(path);
    if (!info.isFile()) throw inputError(`"${path}" is not a file.`);
    size = info.size;
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') {
      throw inputError(`No such file: ${path}`);
    }
    throw cause;
  }

  if (size > DEFAULTS.pdfMaxBytes) {
    throw inputError(
      `${path} is ${Math.round(size / 1024 / 1024)}MB, over the ${DEFAULTS.pdfMaxBytes / 1024 / 1024}MB limit.`,
    );
  }

  const bytes = new Uint8Array(await readFile(path));
  return pdfBytesToDocument(bytes, { label: basename(path), ...options, sourcePath: path });
}

export async function pdfBytesToDocument(
  bytes: Uint8Array,
  options: PdfOptions & { sourcePath?: string } = {},
): Promise<PdfResult> {
  if (bytes.byteLength === 0) throw inputError('The PDF is empty.');
  if (!startsWithPdfHeader(bytes)) {
    throw inputError('That file does not look like a PDF (missing %PDF header).');
  }

  const pdf = await openPdf(bytes);
  const totalPages = pdf.numPages;
  const maxPages = options.maxPages ?? DEFAULTS.pdfMaxPages;

  const selected = parsePageRange(options.pages, totalPages) ?? rangeUpTo(totalPages, maxPages);
  if (selected.length > maxPages) selected.length = maxPages;

  const charLimit = options.maxChars ?? maxInputChars();
  const pageTexts: { page: number; text: string }[] = [];
  let chars = 0;
  let truncated = selected.length < totalPages;

  for (const page of selected) {
    const text = await readPageText(pdf, page);
    pageTexts.push({ page, text });
    chars += text.length;
    if (chars >= charLimit) {
      truncated = true;
      break;
    }
  }

  const outline = await readOutline(pdf);
  const totalText = pageTexts.reduce((sum, entry) => sum + entry.text.trim().length, 0);
  if (totalText < Math.max(40, pageTexts.length * 20)) {
    throw inputError(
      'This PDF has no text layer (OCR is not supported).',
      'It is most likely a scan. Run it through OCR first, or paste the text into the text command.',
    );
  }

  const blocks = pagesToBlocks(pageTexts, outline);
  const title = (await readTitle(pdf)) ?? outline[0]?.title ?? options.label;

  return {
    document: { title, blocks: compactBlocks(blocks), truncated },
    source: {
      path: options.sourcePath,
      pages: options.pages,
      totalPages,
      hasOutline: outline.length > 0,
    },
    pageTexts,
    outline,
  };
}

type PdfProxy = Awaited<ReturnType<typeof getDocumentProxy>>;

async function openPdf(bytes: Uint8Array): Promise<PdfProxy> {
  try {
    // A copy: pdf.js takes ownership of the buffer it is handed.
    return await getDocumentProxy(new Uint8Array(bytes));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/password/i.test(message)) {
      throw inputError('This PDF is password protected.', 'Remove the password and try again.');
    }
    throw inputError(`Could not read the PDF: ${message}`);
  }
}

async function readPageText(pdf: PdfProxy, pageNumber: number): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  let text = '';
  for (const item of content.items) {
    if (!('str' in item)) continue;
    text += item.str;
    if (item.hasEOL) text += '\n';
  }
  page.cleanup();
  return text;
}

async function readOutline(pdf: PdfProxy): Promise<OutlineEntry[]> {
  let raw: Awaited<ReturnType<PdfProxy['getOutline']>>;
  try {
    raw = await pdf.getOutline();
  } catch {
    return [];
  }
  if (!raw || raw.length === 0) return [];

  const out: OutlineEntry[] = [];
  const visit = (nodes: typeof raw, level: number) => {
    for (const node of nodes ?? []) {
      const title = typeof node.title === 'string' ? node.title.trim() : '';
      if (title !== '') out.push({ level, title });
      if (node.items && node.items.length > 0) visit(node.items, level + 1);
    }
  };
  visit(raw, 1);
  return out;
}

async function readTitle(pdf: PdfProxy): Promise<string | undefined> {
  try {
    const meta = await pdf.getMetadata();
    const info = meta.info as { Title?: unknown } | undefined;
    const title = typeof info?.Title === 'string' ? info.Title.trim() : '';
    return title === '' ? undefined : title;
  } catch {
    return undefined;
  }
}

function rangeUpTo(totalPages: number, maxPages: number): number[] {
  const count = Math.min(totalPages, maxPages);
  return Array.from({ length: count }, (_value, index) => index + 1);
}

function startsWithPdfHeader(bytes: Uint8Array): boolean {
  // Some producers put junk before the header; PDF readers scan the first 1KB.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

/**
 * Converts page text into Blocks. Bookmark titles, when present, are matched
 * against the page lines so they become real headings; otherwise line shape
 * decides (numbered, short, no trailing sentence punctuation).
 */
export function pagesToBlocks(
  pageTexts: { page: number; text: string }[],
  outline: OutlineEntry[],
): Block[] {
  const bookmarks = new Map<string, number>();
  for (const entry of outline) {
    bookmarks.set(normalizeKey(entry.title), entry.level);
  }

  const blocks: Block[] = [];
  for (const { page, text } of pageTexts) {
    if (blocks.length > 0) blocks.push(pageBreak(page));
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const bookmarkLevel = bookmarks.get(normalizeKey(line));
      if (bookmarkLevel !== undefined) {
        blocks.push(heading(Math.min(6, bookmarkLevel), line));
        continue;
      }
      if (looksLikeHeadingLine(line, lines[index + 1])) {
        blocks.push(heading(numberedDepth(line), line));
        continue;
      }
      blocks.push(paragraph(line));
    }
  }
  return blocks;
}

function normalizeKey(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

const NUMBERED = /^(\d+(\.\d+)*)[.、)\s]\s*\S/;
const CJK_CHAPTER =
  /^(第[一二三四五六七八九十百零\d]+[章节節篇部]|[一二三四五六七八九十]+[、.])\s*\S/;

/** Heading candidates: numbered, or short lines that do not end a sentence. */
export function looksLikeHeadingLine(line: string, next: string | undefined): boolean {
  if (line.length > 90) return false;
  if (NUMBERED.test(line) || CJK_CHAPTER.test(line)) return true;
  if (/[.。,，;；:：]$/u.test(line)) return false;
  if (line.length > 48) return false;
  // A short standalone line followed by a real paragraph reads as a heading.
  return next !== undefined && next.length > 80;
}

function numberedDepth(line: string): number {
  const match = NUMBERED.exec(line);
  if (!match) return 2;
  const dots = (match[1]!.match(/\./g) ?? []).length;
  return Math.min(6, 2 + dots);
}
