import {
  type Block,
  compactBlocks,
  type Document,
  heading,
  listItem,
  paragraph,
} from '../outline/blocks.js';
import { maxInputChars } from '../util/env.js';
import { firstSentence } from '../util/segment.js';

const ATX = /^(#{1,6})\s+(.*)$/;
const SETEXT_UNDERLINE = /^(=+|-{2,})\s*$/;
const FENCE = /^\s{0,3}(```+|~~~+)/;
const BULLET = /^(\s*)([-*+•·]|\d{1,3}[.)]|[a-zA-Z][.)])\s+(.*)$/;
const THEMATIC_BREAK = /^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/;
const TABLE_DIVIDER = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;

/** Cheap structural sniff — no parsing, just "was this written as Markdown?". */
export function looksLikeMarkdown(text: string): boolean {
  const head = text.slice(0, 20_000);
  const lines = head.split('\n');
  let atx = 0;
  let bullets = 0;
  let setext = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (ATX.test(line)) atx += 1;
    else if (BULLET.test(line)) bullets += 1;
    // Only `===` counts as a setext signal: a line of dashes is just as likely
    // to be a plain-text separator.
    else if (/^=+\s*$/.test(line) && (lines[index - 1] ?? '').trim() !== '') setext += 1;
  }
  if (atx > 0 || setext > 0) return true;
  if (FENCE.test(head)) return true;
  // A handful of bullets in a short document is still a list, not prose.
  return bullets >= 3 && bullets / Math.max(1, lines.length) > 0.15;
}

/** Turns inline Markdown into the plain text a mind-map node should show. */
export function stripInlineMarkdown(input: string): string {
  let text = input;
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1');
  text = text.replace(/`+([^`]+)`+/g, '$1');
  text = text.replace(/~~([^~]+)~~/g, '$1');
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1$2');
  text = text.replace(/(^|[\s(])_{1,3}([^_\n]+)_{1,3}(?=[\s).,;:!?]|$)/g, '$1$2');
  text = text.replace(/<[^>\n]{1,200}>/g, '');
  text = text.replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1');
  return text;
}

/** Reads a Markdown or plain-text string into Blocks. */
export function textToDocument(
  raw: string,
  options: { title?: string; maxChars?: number } = {},
): Document {
  const limit = options.maxChars ?? maxInputChars();
  const stripped = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const truncated = stripped.length > limit;
  const source = truncated ? stripped.slice(0, limit) : stripped;

  const blocks = looksLikeMarkdown(source) ? parseMarkdown(source) : parsePlainText(source);
  const compacted = compactBlocks(blocks);

  const firstHeading = compacted.find((block) => block.type === 'heading');
  const title =
    options.title ??
    (firstHeading?.type === 'heading' ? firstHeading.text : undefined) ??
    firstLineTitle(compacted);

  return { title, blocks: compacted, truncated };
}

function firstLineTitle(blocks: Block[]): string | undefined {
  const first = blocks.find((block) => block.type !== 'pageBreak');
  if (!first) return undefined;
  // Sentence-aware, so Chinese text (no space after 。) does not take the whole
  // paragraph as its title.
  const sentence = firstSentence(first.text);
  return sentence.length > 0 && sentence.length <= 120 ? sentence : undefined;
}

function parsePlainText(source: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of source.split(/\n{2,}/)) {
    const text = chunk.trim();
    if (text !== '') blocks.push(paragraph(text));
  }
  return blocks;
}

function parseMarkdown(source: string): Block[] {
  const lines = source.split('\n');
  const blocks: Block[] = [];
  /** Indent widths of the currently open list levels, outermost first. */
  let indentStack: number[] = [];
  let pending: string[] = [];
  let inFence = false;
  let fenceMarker = '';

  const flushParagraph = () => {
    if (pending.length === 0) return;
    const text = stripInlineMarkdown(pending.join(' '));
    pending = [];
    if (text.trim() !== '') blocks.push(paragraph(text));
  };

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index] ?? '';

    const fence = FENCE.exec(line);
    if (inFence) {
      if (fence && fence[1]!.startsWith(fenceMarker)) inFence = false;
      continue;
    }
    if (fence) {
      flushParagraph();
      inFence = true;
      fenceMarker = fence[1]!.slice(0, 3);
      continue;
    }

    // Blockquotes contribute their text, not their markers.
    line = line.replace(/^\s{0,3}(>\s?)+/, '');

    if (line.trim() === '') {
      flushParagraph();
      indentStack = [];
      continue;
    }

    // Setext heading: the underline applies to the single line above it. Checked
    // before the thematic-break rule, which `---` would otherwise claim.
    if (pending.length === 1 && SETEXT_UNDERLINE.test(line)) {
      const level = line.trim().startsWith('=') ? 1 : 2;
      blocks.push(heading(level, stripInlineMarkdown(pending[0]!)));
      pending = [];
      continue;
    }

    if (THEMATIC_BREAK.test(line)) {
      flushParagraph();
      indentStack = [];
      continue;
    }

    const atx = ATX.exec(line.trim());
    if (atx) {
      flushParagraph();
      indentStack = [];
      blocks.push(heading(atx[1]!.length, stripInlineMarkdown(atx[2]!.replace(/\s+#+\s*$/, ''))));
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      flushParagraph();
      const indent = bullet[1]!.replace(/\t/g, '  ').length;
      const depth = pushIndent(indentStack, indent);
      const text = stripInlineMarkdown(bullet[3]!);
      if (text.trim() !== '') blocks.push(listItem(depth, text));
      continue;
    }

    if (TABLE_DIVIDER.test(line) && line.includes('|')) continue;
    if (line.trimStart().startsWith('|')) {
      flushParagraph();
      const cells = line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => stripInlineMarkdown(cell).trim())
        .filter((cell) => cell !== '');
      if (cells.length > 0) blocks.push(paragraph(cells.join(' · ')));
      continue;
    }

    // Continuation of a list item keeps the item's depth rather than starting a paragraph.
    if (indentStack.length > 0 && /^\s+\S/.test(line) && pending.length === 0) {
      const last = blocks[blocks.length - 1];
      if (last?.type === 'listItem') {
        blocks[blocks.length - 1] = listItem(
          last.depth,
          `${last.text} ${stripInlineMarkdown(line.trim())}`,
        );
        continue;
      }
    }

    indentStack = [];
    pending.push(line.trim());
  }

  flushParagraph();
  return blocks;
}

/**
 * Maps an indent width onto a 0-based list depth, keeping the stack monotonic so
 * inconsistent indentation (2 spaces here, 4 there) still nests predictably.
 */
function pushIndent(stack: number[], indent: number): number {
  while (stack.length > 0 && indent < stack[stack.length - 1]!) stack.pop();
  const top = stack[stack.length - 1];
  if (top === undefined) {
    stack.push(indent);
    return 0;
  }
  if (indent > top) {
    stack.push(indent);
    return stack.length - 1;
  }
  return stack.length - 1;
}
