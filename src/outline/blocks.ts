/**
 * Blocks IR — the single shape every extractor produces and every outline
 * generator consumes. Text, HTML and PDF each know how to become Blocks; the
 * outline code never learns where the content came from.
 */

export type Block =
  /** `level` is 1–6, matching Markdown `#` depth and HTML h1–h6. */
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  /** `depth` is 0-based nesting inside the list. */
  | { type: 'listItem'; depth: number; text: string }
  /** Carries no text; marks where one PDF page ends and the next begins. */
  | { type: 'pageBreak'; page: number };

export interface Document {
  /** Best guess at a title: Markdown h1, HTML <title>, PDF metadata, or a filename. */
  title: string | undefined;
  blocks: Block[];
  /** True when the source was cut short by a size limit. */
  truncated: boolean;
}

export function heading(level: number, text: string): Block {
  return { type: 'heading', level: clampLevel(level), text: normalizeInline(text) };
}

export function paragraph(text: string): Block {
  return { type: 'paragraph', text: normalizeInline(text) };
}

export function listItem(depth: number, text: string): Block {
  return { type: 'listItem', depth: Math.max(0, Math.trunc(depth)), text: normalizeInline(text) };
}

export function pageBreak(page: number): Block {
  return { type: 'pageBreak', page };
}

export function clampLevel(level: number): number {
  return Math.min(6, Math.max(1, Math.trunc(level)));
}

/** Collapses runs of whitespace and strips zero-width characters. */
export function normalizeInline(text: string): string {
  return text
    .replace(/[​-‍﻿]/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

/** Drops empty text blocks; keeps page breaks. A single pass, applied by every extractor. */
export function compactBlocks(blocks: Block[]): Block[] {
  return blocks.filter((block) => block.type === 'pageBreak' || block.text !== '');
}

export function hasHeadings(blocks: Block[]): boolean {
  return blocks.some((block) => block.type === 'heading');
}

/** Plain text of a document, used as the `sourceText` handed to a client model. */
export function blocksToText(blocks: Block[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        lines.push('', `${'#'.repeat(block.level)} ${block.text}`, '');
        break;
      case 'paragraph':
        lines.push(block.text, '');
        break;
      case 'listItem':
        lines.push(`${'  '.repeat(block.depth)}- ${block.text}`);
        break;
      case 'pageBreak':
        lines.push('');
        break;
    }
  }
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function countChars(blocks: Block[]): number {
  let total = 0;
  for (const block of blocks) {
    if (block.type !== 'pageBreak') total += block.text.length;
  }
  return total;
}
