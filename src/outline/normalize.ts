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
  const children = normalizeLevel(collapseTitleEcho(outline), 2, maxDepth, maxChildren);
  return { title, children };
}

/**
 * A top-level child that only repeats the root title says nothing new: a PDF
 * whose first page prints its own title, an HTML page whose `<h1>` echoes
 * `<title>`, a Markdown file with one top-level section.
 *
 * As a lone wrapper it is lifted away so the real sections sit directly under
 * the root and the depth budget is not spent on it; as a leaf it is dropped.
 */
function collapseTitleEcho(outline: Outline): OutlineNode[] {
  let children = outline.children;
  const title = normalizeText(outline.title);
  while (children.length === 1) {
    const only = children[0]!;
    // Nothing to lift: fall through and let the filter below decide.
    if (only.children.length === 0 || normalizeText(only.text) !== title) break;
    children = only.children;
  }

  const kept = children.filter(
    (child) => child.children.length > 0 || normalizeText(child.text) !== title,
  );
  // Never trade a redundant node for an empty mind map.
  return kept.length > 0 ? kept : children;
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
  const lines: string[] = [`# ${escapeInline(outline.title, 'heading')}`];

  const walk = (nodes: OutlineNode[], level: number) => {
    for (const current of nodes) {
      if (level <= 2) {
        lines.push('', `${'#'.repeat(level + 1)} ${escapeInline(current.text, 'heading')}`);
      } else {
        lines.push(`${'  '.repeat(level - 3)}- ${escapeInline(current.text, 'listItem')}`);
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

/**
 * Escapes only what the surrounding line would actually misparse, so the raw
 * outline stays readable.
 *
 * On a heading line nothing can start a new block: `### 1. Overview` is a
 * heading whose text is "1. Overview", and a leading `-` or `>` is plain text
 * too. Inside a list item the same text would open a nested ordered or bulleted
 * list, so there the delimiter is escaped.
 */
function escapeInline(text: string, line: 'heading' | 'listItem'): string {
  let out = text;
  if (line === 'listItem') {
    // "1. x" nests an ordered list, "- x" a bullet; escaping the delimiter (not
    // the digit) is the form Markdown actually understands.
    out = out.replace(/^(\d{1,9})([.)])(\s)/, '$1\\$2$3').replace(/^([*+-])(\s)/, '\\$1$2');
  } else {
    // A trailing run of "#" would be eaten as the heading's closing sequence.
    out = out.replace(/(\s)(#+)$/, '$1\\$2');
  }
  // A pair of backticks would turn the text between them into code.
  out = out.replace(/`/g, '\\`');
  // "[1]" and "[edit]" render literally; only a link or reference pair needs the
  // brackets escaped, so a stray footnote marker stays readable.
  if (/\]\s*[([]/.test(out)) out = out.replace(/([[\]])/g, '\\$1');
  return out;
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
  /**
   * Headings in scope, outermost first. Only headings open a scope: prose that
   * precedes the first heading belongs to the root, and must not become the
   * parent of the sections that follow it.
   */
  const open: { level: number; node: OutlineNode }[] = [];
  /** The list item chain currently being nested into, one entry per depth. */
  let listChain: OutlineNode[] = [];

  const scope = (): OutlineNode => open[open.length - 1]?.node ?? root;

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
        // A skipped level (an h3 with no h2 above it) just nests one step deeper.
        while (open.length > 0 && open[open.length - 1]!.level >= block.level) open.pop();
        const created: OutlineNode = { text: block.text, children: [] };
        scope().children.push(created);
        open.push({ level: block.level, node: created });
        listChain = [];
        break;
      }
      case 'listItem': {
        const created: OutlineNode = { text: block.text, children: [] };
        // Clamp to the chain we actually have, so a list that starts at depth 2
        // still attaches somewhere sensible.
        const depth = Math.min(block.depth, listChain.length);
        (depth === 0 ? scope() : listChain[depth - 1]!).children.push(created);
        listChain.length = depth;
        listChain.push(created);
        break;
      }
      case 'paragraph': {
        if (options.paragraphs === 'skip') break;
        const text = options.paragraphs === 'full' ? block.text : firstSentence(block.text);
        if (text.trim() === '') break;
        scope().children.push({ text, children: [] });
        listChain = [];
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
