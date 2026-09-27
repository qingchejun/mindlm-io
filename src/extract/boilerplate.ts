/**
 * Page furniture removal, applied to an HTML document *before* Readability sees
 * it and to the extracted blocks afterwards.
 *
 * Doing it in that order matters: Readability scores a container by how much
 * text it holds, so a section title wrapped in a `<div>` next to an "[edit]"
 * link looks like a low-content block and gets deleted along with the heading.
 * Stripping the furniture first leaves bare `<h2>` elements, which Readability
 * keeps.
 */

import type { Block } from '../outline/blocks.js';

/** The little of a DOM element this module needs; linkedom satisfies it. */
interface DomElement {
  tagName: string;
  textContent: string | null;
  children: ArrayLike<DomElement>;
  parentElement: DomElement | null;
  remove(): void;
  replaceWith(node: DomElement): void;
  querySelectorAll(selectors: string): ArrayLike<DomElement>;
}

interface DomDocument {
  body: DomElement | null;
  querySelectorAll(selectors: string): ArrayLike<DomElement>;
}

/**
 * Semantic selectors first — ARIA roles and elements whose meaning is defined by
 * the platform, so they hold on any site. Then a short list of class names that
 * recur across encyclopedia and CMS templates, which is cheaper and steadier
 * than trying to infer the same thing from text shape.
 */
const FURNITURE_SELECTORS = [
  '[role="note"]',
  '[role="navigation"]',
  '[role="complementary"]',
  '[aria-hidden="true"]',
  'figcaption',
  // `script` and `style` are deliberately left in place: Readability reads
  // JSON-LD metadata out of a `<script type="application/ld+json">` to get the
  // article title right, and every consumer of the tree already skips both tags.
  // Reference markers and "edit this section" affordances.
  'sup.reference',
  'sup.noprint',
  '.mw-editsection',
  '.editsection',
  '.noprint',
  // Template furniture: notes above the article, navigation boxes, metadata
  // tables, image captions, the reference list, the table of contents.
  '.hatnote',
  '.navbox',
  '.sidebar',
  '.infobox',
  '.metadata',
  '.shortdescription',
  '.thumbcaption',
  '.gallerytext',
  '.reflist',
  '.mw-jump-link',
  '#siteSub',
  '#contentSub',
  '#toc',
  '.toc',
];

/** Elements small enough to be a marker rather than content. */
const MARKER_HOSTS = 'a, span, sup, sub, small, em, b, i, strong, li, p, div';
/** "[edit]", "[1]", "[citation needed]" — a template's leftovers, not prose. */
const MARKER_TEXT = /^\[[^\]]{0,24}\]$/;
const EDIT_TEXT = /^\[?\s*edit\s*\]?$/i;

/** True for text that is only a bracketed marker, so no outline node is worth it. */
export function isMarkerText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed !== '' && (MARKER_TEXT.test(trimmed) || EDIT_TEXT.test(trimmed));
}

/**
 * Removes page furniture in place and unwraps heading containers. Safe to run
 * more than once on the same tree.
 */
export function stripBoilerplate(document: DomDocument): void {
  for (const selector of FURNITURE_SELECTORS) {
    removeAll(document, selector);
  }
  removeMarkers(document);
  unwrapHeadings(document);
}

function removeAll(document: DomDocument, selector: string): void {
  let found: ArrayLike<DomElement>;
  try {
    found = document.querySelectorAll(selector);
  } catch {
    // A selector the parser does not implement is not worth failing over.
    return;
  }
  for (const element of Array.from(found)) element.remove();
}

function removeMarkers(document: DomDocument): void {
  for (const element of Array.from(document.querySelectorAll(MARKER_HOSTS))) {
    if (!isMarkerText(element.textContent ?? '')) continue;
    // An element holding an image says something even when its text does not.
    if (element.querySelectorAll('img, svg, figure').length > 0) continue;
    element.remove();
  }
}

/**
 * Replaces a container whose only content is one heading with that heading.
 * Modern MediaWiki emits `<div class="mw-heading"><h2 id="…">Title</h2>…</div>`;
 * once the "[edit]" span is gone the div adds nothing but a reason for
 * Readability to throw the title away.
 */
function unwrapHeadings(document: DomDocument): void {
  for (const heading of Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))) {
    const text = normalize(heading.textContent ?? '');
    if (text === '') continue;
    let current = heading;
    for (let depth = 0; depth < 4; depth += 1) {
      const parent = current.parentElement;
      if (!parent || parent === document.body) break;
      if (!WRAPPER_TAGS.has(parent.tagName?.toUpperCase())) break;
      if (parent.children.length !== 1) break;
      if (normalize(parent.textContent ?? '') !== text) break;
      parent.replaceWith(heading);
      current = heading;
    }
  }
}

const WRAPPER_TAGS = new Set(['DIV', 'SPAN', 'HGROUP', 'HEADER', 'P']);

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Sections that exist for the page, not for the reader: they carry citations and
 * link lists, which make long, low-value branches in a mind map.
 */
const BOILERPLATE_SECTIONS = new Set([
  'see also',
  'references',
  'reference',
  'notes',
  'footnotes',
  'notes and references',
  'references and notes',
  'further reading',
  'external links',
  'external link',
  'bibliography',
  'sources',
  'citations',
  'works cited',
  'related pages',
  'related articles',
  '参见',
  '参考文献',
  '参考资料',
  '外部链接',
  '延伸阅读',
  '註釋',
  '注释',
]);

export function isBoilerplateHeading(text: string): boolean {
  const key = text
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[[\]()#*_:：.。、，,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return BOILERPLATE_SECTIONS.has(key);
}

/**
 * Drops a boilerplate section together with everything nested under it. A later
 * heading at the same level or above ends the cut, so a "References" section in
 * the middle of a document does not take the rest of the page with it.
 */
export function dropBoilerplateSections(blocks: Block[]): Block[] {
  const kept: Block[] = [];
  /** Heading level of the section being dropped, if any. */
  let cutting: number | undefined;

  for (const block of blocks) {
    if (block.type === 'heading') {
      if (cutting !== undefined && block.level > cutting) continue;
      cutting = isBoilerplateHeading(block.text) ? block.level : undefined;
      if (cutting !== undefined) continue;
    } else if (cutting !== undefined) {
      continue;
    }
    kept.push(block);
  }
  return kept;
}
