import { textToDocument } from '../extract/text.js';
import { firstSentence, shortenLabel } from '../util/segment.js';
import type { Block } from './blocks.js';

export interface OutlineNode {
  text: string;
  children: OutlineNode[];
}

export interface Outline {
  title: string;
  children: OutlineNode[];
}

export interface NormalizeOptions {
  /** Total levels including the root. 2–6, default 4. */
  maxDepth?: number;
  /** Children kept per node before the rest collapse into a `…(+N)` marker. */
  maxChildren?: number;
}

export const DEFAULT_MAX_DEPTH = 4;
export const DEFAULT_MAX_CHILDREN = 8;

export function node(text: string, children: OutlineNode[] = []): OutlineNode {
  return { text, children };
}

/**
 * Shapes an outline into something a mind map can actually show: bounded depth
 * and breadth, one-glance labels, no duplicate siblings, exactly one root.
 */
export function normalizeOutline(outline: Outline, options: NormalizeOptions = {}): Outline {
  const maxDepth = clamp(options.maxDepth ?? DEFAULT_MAX_DEPTH, 2, 6);
  const maxChildren = clamp(options.maxChildren ?? DEFAULT_MAX_CHILDREN, 3, 15);

  const title = shortenLabel(outline.title.trim()) || 'Mind map';
  // The root occupies level 1, so its children may nest maxDepth - 1 deep.
  const children = normalizeLevel(outline.children, 2, maxDepth, maxChildren);
  return { title, children };
}

function normalizeLevel(
  nodes: OutlineNode[],
  level: number,
  maxDepth: number,
  maxChildren: number,
): OutlineNode[] {
  if (level > maxDepth) return [];

  const seen = new Set<string>();
  const kept: OutlineNode[] = [];
  let dropped = 0;

  for (const current of nodes) {
    const text = shortenLabel(current.text);
    if (text === '') continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (kept.length >= maxChildren) {
      dropped += 1;
      continue;
    }
    kept.push({
      text,
      children: normalizeLevel(current.children, level + 1, maxDepth, maxChildren),
    });
  }

  if (dropped > 0) kept.push({ text: `…(+${dropped})`, children: [] });
  return kept;
}

export function countNodes(outline: Outline): number {
  const count = (nodes: OutlineNode[]): number =>
    nodes.reduce((total, current) => total + 1 + count(current.children), 0);
  return 1 + count(outline.children);
}

export function outlineDepth(outline: Outline): number {
  const depth = (nodes: OutlineNode[]): number =>
    nodes.length === 0 ? 0 : 1 + Math.max(...nodes.map((current) => depth(current.children)));
  return 1 + depth(outline.children);
}

/**
 * Serializes to the Markdown flavour markmap reads best: the root and the first
 * two levels as headings, everything below as a nested list.
 */
export function outlineToMarkdown(outline: Outline): string {
  const lines: string[] = [`# ${escapeInline(outline.title)}`];

  const walk = (nodes: OutlineNode[], level: number) => {
    for (const current of nodes) {
      if (level <= 2) {
        lines.push('', `${'#'.repeat(level + 1)} ${escapeInline(current.text)}`);
      } else {
        lines.push(`${'  '.repeat(level - 3)}- ${escapeInline(current.text)}`);
      }
      walk(current.children, level + 1);
    }
  };
  walk(outline.children, 1);

  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}

/** Escapes the few characters that would otherwise start Markdown structure. */
function escapeInline(text: string): string {
  return text.replace(/^([#>*+-]|\d+[.)])\s/, '\\$1 ').replace(/([[\]`])/g, '\\$1');
}

/** Reads an existing Markdown outline back into the tree, e.g. to re-normalize it. */
export function parseOutlineMarkdown(markdown: string, fallbackTitle = 'Mind map'): Outline {
  const document = textToDocument(markdown, { maxChars: Number.MAX_SAFE_INTEGER });
  return outlineFromBlocks(document.blocks, {
    title: document.title ?? fallbackTitle,
    paragraphs: 'firstSentence',
  });
}

export interface FromBlocksOptions {
  title: string;
  /** How a paragraph under a heading becomes a node. */
  paragraphs: 'skip' | 'firstSentence' | 'full';
}

/**
 * Builds a tree out of the heading/list structure in Blocks. Heading level maps
 * straight onto tree depth; list items nest under the heading that precedes
 * them; page breaks are ignored.
 */
export function outlineFromBlocks(blocks: Block[], options: FromBlocksOptions): Outline {
  const root: OutlineNode = { text: options.title, children: [] };
  /** Open ancestors by tree level; index 0 is the root, skipped levels are holes. */
  const stack: (OutlineNode | undefined)[] = [root];
  /** Tree level of the heading currently in scope. */
  let headingLevel = 0;

  const attach = (level: number, created: OutlineNode) => {
    const target = Math.max(1, Math.trunc(level));
    // Skipped levels (an h3 with no h2 above it) leave holes in the stack;
    // walk down to the nearest real ancestor instead of trusting the index.
    let parentLevel = Math.min(target - 1, stack.length - 1);
    while (parentLevel > 0 && stack[parentLevel] === undefined) parentLevel -= 1;
    stack[parentLevel]!.children.push(created);
    stack.length = parentLevel + 1;
    stack[target] = created;
  };

  // The first level-1 heading is the document title, not a node.
  let titleConsumed = false;

  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        if (
          !titleConsumed &&
          block.level === 1 &&
          normalizeText(block.text) === normalizeText(options.title)
        ) {
          titleConsumed = true;
          continue;
        }
        headingLevel = block.level;
        attach(block.level, { text: block.text, children: [] });
        break;
      }
      case 'listItem': {
        attach(headingLevel + 1 + block.depth, { text: block.text, children: [] });
        break;
      }
      case 'paragraph': {
        if (options.paragraphs === 'skip') break;
        const text = options.paragraphs === 'full' ? block.text : firstSentence(block.text);
        if (text.trim() === '') break;
        attach(headingLevel + 1, { text, children: [] });
        break;
      }
      case 'pageBreak':
        break;
    }
  }

  return { title: root.text, children: root.children };
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
