import { parseHTML } from 'linkedom';
import {
  type Block,
  compactBlocks,
  heading,
  listItem,
  normalizeInline,
  paragraph,
} from '../outline/blocks.js';

/** Elements that never carry readable content. */
const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'SVG',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'CANVAS',
  'FORM',
  'BUTTON',
  'SELECT',
  'TEXTAREA',
  'INPUT',
  'NAV',
  'ASIDE',
  'FOOTER',
  'HEADER',
]);

/** Elements that start their own block, so inline collection must stop at them. */
const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DD',
  'DIV',
  'DL',
  'DT',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TBODY',
  'TD',
  'TH',
  'THEAD',
  'TR',
  'UL',
]);

/** A minimal structural view of a DOM node — enough to avoid depending on lib.dom. */
interface DomNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<DomNode>;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * Parses an HTML string (a full document or a fragment) into Blocks, keeping
 * h1–h6, paragraphs and list nesting and dropping everything else.
 */
export function htmlToBlocks(html: string): Block[] {
  // linkedom only runs full tree construction on a complete document, so a
  // fragment has to be wrapped rather than parsed on its own.
  const { document } = parseHTML(
    `<!doctype html><html><head></head><body>${stripFullDocument(html)}</body></html>`,
  );
  const body = document.body as unknown as DomNode | null;
  if (!body) return [];
  const blocks: Block[] = [];
  walk(body, blocks, 0);
  return compactBlocks(mergeAdjacentParagraphs(blocks));
}

/**
 * Readability hands back a fragment, but callers sometimes pass a whole page.
 * Wrapping a full document inside `<body>` would nest `<html>`, so unwrap first.
 */
function stripFullDocument(html: string): string {
  const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  if (bodyMatch) return bodyMatch[1]!;
  return html.replace(/<!doctype[^>]*>/i, '').replace(/<\/?html[^>]*>/gi, '');
}

function walk(node: DomNode, out: Block[], listDepth: number): void {
  const children = node.childNodes;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    if (child.nodeType === TEXT_NODE) {
      const text = normalizeInline(child.textContent ?? '');
      // Loose text directly under a container still counts as prose.
      if (text !== '' && text.length > 1) out.push(paragraph(text));
      continue;
    }
    if (child.nodeType !== ELEMENT_NODE) continue;

    const tag = child.nodeName.toUpperCase();
    if (SKIP_TAGS.has(tag)) continue;

    if (/^H[1-6]$/.test(tag)) {
      out.push(heading(Number(tag[1]), inlineText(child)));
      continue;
    }

    switch (tag) {
      case 'UL':
      case 'OL':
        walk(child, out, listDepth + 1);
        continue;
      case 'LI': {
        const text = inlineText(child);
        if (text !== '') out.push(listItem(Math.max(0, listDepth - 1), text));
        // Nested lists inside the item continue one level deeper.
        walkListChildren(child, out, listDepth);
        continue;
      }
      case 'P':
      case 'BLOCKQUOTE':
      case 'FIGCAPTION':
      case 'DD':
      case 'DT': {
        const text = inlineText(child);
        if (text !== '') out.push(paragraph(text));
        // A paragraph can still wrap a nested list in real-world markup.
        walkListChildren(child, out, listDepth);
        continue;
      }
      case 'PRE':
        continue;
      case 'TR': {
        const cells = collectCells(child);
        if (cells.length > 0) out.push(paragraph(cells.join(' · ')));
        continue;
      }
      case 'BR':
      case 'HR':
      case 'IMG':
        continue;
      default:
        walk(child, out, listDepth);
    }
  }
}

/** Recurses only into nested lists, so item text is not emitted twice. */
function walkListChildren(node: DomNode, out: Block[], listDepth: number): void {
  const children = node.childNodes;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    if (child.nodeType !== ELEMENT_NODE) continue;
    const tag = child.nodeName.toUpperCase();
    if (tag === 'UL' || tag === 'OL') walk(child, out, listDepth + 1);
  }
}

function collectCells(row: DomNode): string[] {
  const cells: string[] = [];
  const children = row.childNodes;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    if (child.nodeType !== ELEMENT_NODE) continue;
    const tag = child.nodeName.toUpperCase();
    if (tag !== 'TD' && tag !== 'TH') continue;
    const text = inlineText(child);
    if (text !== '') cells.push(text);
  }
  return cells;
}

/** Text of an element, stopping at nested block-level elements. */
function inlineText(node: DomNode): string {
  const parts: string[] = [];
  const visit = (current: DomNode) => {
    const children = current.childNodes;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]!;
      if (child.nodeType === TEXT_NODE) {
        parts.push(child.textContent ?? '');
        continue;
      }
      if (child.nodeType !== ELEMENT_NODE) continue;
      const tag = child.nodeName.toUpperCase();
      if (SKIP_TAGS.has(tag) || BLOCK_TAGS.has(tag)) continue;
      if (tag === 'BR') {
        parts.push(' ');
        continue;
      }
      visit(child);
    }
  };
  visit(node);
  return normalizeInline(parts.join(''));
}

/**
 * Inline-level splits (`<span>` soup, stray text nodes) can produce a run of
 * one-line paragraphs that were a single sentence in the original. Rejoin the
 * very short ones so sentence splitting later works on real sentences.
 */
function mergeAdjacentParagraphs(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const block of blocks) {
    const previous = out[out.length - 1];
    if (
      block.type === 'paragraph' &&
      previous?.type === 'paragraph' &&
      previous.text.length < 40 &&
      !/[.。!?！？:：]$/u.test(previous.text)
    ) {
      out[out.length - 1] = paragraph(`${previous.text} ${block.text}`);
      continue;
    }
    out.push(block);
  }
  return out;
}
