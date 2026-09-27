import { firstSentence, shortenLabel, splitSentences, tokenize } from '../util/segment.js';
import { type Block, type Document, hasHeadings } from './blocks.js';
import {
  DEFAULT_MAX_CHILDREN,
  DEFAULT_MAX_DEPTH,
  normalizeOutline,
  type Outline,
  type OutlineNode,
  outlineFromBlocks,
} from './normalize.js';

export interface HeuristicOptions {
  title?: string;
  maxDepth?: number;
  maxChildren?: number;
}

/**
 * Deterministic, dependency-free outline generator. It is the CLI default and
 * the fallback for both model-backed modes, so it must always return something
 * renderable — never throw on odd input.
 */
export function heuristicOutline(document: Document, options: HeuristicOptions = {}): Outline {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxChildren = options.maxChildren ?? DEFAULT_MAX_CHILDREN;
  const title = options.title?.trim() || document.title?.trim() || deriveTitle(document.blocks);

  const raw = hasHeadings(document.blocks)
    ? outlineFromBlocks(document.blocks, { title, paragraphs: 'firstSentence' })
    : unstructuredOutline(document.blocks, title, maxChildren);

  return normalizeOutline(raw, { maxDepth, maxChildren });
}

function deriveTitle(blocks: Block[]): string {
  for (const block of blocks) {
    if (block.type === 'pageBreak') continue;
    const sentence = firstSentence(block.text);
    if (sentence !== '') return sentence;
  }
  return 'Mind map';
}

type TextBlock = Extract<Block, { type: 'paragraph' } | { type: 'listItem' }>;

/**
 * No headings anywhere: group the paragraphs into roughly `maxChildren`
 * sections, name each one after its opening sentence, and hang the
 * highest-scoring remaining sentences off it.
 */
function unstructuredOutline(blocks: Block[], title: string, maxChildren: number): Outline {
  const items = blocks.filter(
    (block): block is TextBlock => block.type === 'paragraph' || block.type === 'listItem',
  );
  if (items.length === 0) return { title, children: [] };

  const frequencies = termFrequencies(items.map((item) => item.text).join('\n'));

  // One section per ~4 blocks, between 2 and maxChildren sections.
  const sectionCount = Math.min(maxChildren, Math.max(2, Math.ceil(items.length / 4)));
  const groups = chunkEvenly(items, sectionCount);

  const children: OutlineNode[] = [];
  for (const [index, group] of groups.entries()) {
    // The title was taken from the opening sentence, so the first section must
    // not repeat it as its own label.
    const section = buildSection(group, frequencies, maxChildren, index === 0 ? title : undefined);
    if (section) children.push(section);
  }

  // A single short paragraph has no sections worth showing; split its sentences.
  if (children.length === 0) {
    const sentences = splitSentences(items.map((item) => item.text).join(' '));
    return {
      title,
      children: sentences.slice(1, maxChildren + 1).map((text) => ({ text, children: [] })),
    };
  }

  return { title, children };
}

function buildSection(
  group: TextBlock[],
  frequencies: Map<string, number>,
  maxChildren: number,
  avoidLabel?: string,
): OutlineNode | undefined {
  const first = group[0];
  if (!first) return undefined;

  const sentences = splitSentences(first.text);
  const start = avoidLabel !== undefined && sameText(sentences[0], avoidLabel) ? 1 : 0;

  let label = shortenLabel(sentences[start] ?? '');
  let detail = sentences.slice(start + 1);
  let remaining = group.slice(1);

  // The opening block had nothing left to name the section with; use the next one.
  if (label === '') {
    const next = remaining[0];
    if (!next) return undefined;
    const nextSentences = splitSentences(next.text);
    label = shortenLabel(nextSentences[0] ?? '');
    if (label === '') return undefined;
    detail = nextSentences.slice(1);
    remaining = remaining.slice(1);
  }

  const children: OutlineNode[] = [];

  // Leftover sentences of the opening block are the section's own detail.
  for (const sentence of rankSentences(detail, frequencies).slice(0, maxChildren)) {
    children.push({ text: sentence, children: [] });
  }

  for (const block of remaining) {
    if (block.type === 'listItem') {
      children.push({ text: block.text, children: [] });
      continue;
    }
    const best = rankSentences(splitSentences(block.text), frequencies)[0];
    if (best) children.push({ text: best, children: [] });
  }

  return { text: label, children: children.slice(0, maxChildren) };
}

function sameText(a: string | undefined, b: string): boolean {
  if (a === undefined) return false;
  return a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
}

/** Token counts over the whole document, used as a crude salience signal. */
export function termFrequencies(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) {
    if (token.length < 2) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

/**
 * Orders sentences by how representative they look: frequent terms count for,
 * extreme lengths count against, and earlier sentences get a small bonus.
 */
export function rankSentences(sentences: string[], frequencies: Map<string, number>): string[] {
  const scored = sentences.map((sentence, index) => {
    const tokens = tokenize(sentence).filter((token) => token.length >= 2);
    const salience =
      tokens.length === 0
        ? 0
        : tokens.reduce((sum, token) => sum + (frequencies.get(token) ?? 0), 0) /
          Math.sqrt(tokens.length);
    const length = sentence.length;
    // Very short fragments and runaway sentences both make poor nodes.
    const lengthPenalty = length < 8 ? 0.3 : length > 200 ? 0.5 : 1;
    const positionBonus = 1 + 0.25 / (index + 1);
    return { sentence, score: salience * lengthPenalty * positionBonus, index };
  });

  scored.sort((a, b) => (b.score === a.score ? a.index - b.index : b.score - a.score));
  return scored.map((entry) => entry.sentence);
}

function chunkEvenly<T>(items: T[], count: number): T[][] {
  const groups: T[][] = [];
  const size = Math.ceil(items.length / count);
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}
