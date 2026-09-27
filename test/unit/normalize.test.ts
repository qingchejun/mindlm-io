import { describe, expect, it } from 'vitest';
import { heading, listItem, paragraph } from '../../src/outline/blocks.js';
import {
  countNodes,
  node,
  normalizeOutline,
  type Outline,
  outlineDepth,
  outlineFromBlocks,
  outlineToMarkdown,
  parseOutlineMarkdown,
} from '../../src/outline/normalize.js';

describe('outlineFromBlocks', () => {
  it('maps heading levels onto tree depth', () => {
    const outline = outlineFromBlocks(
      [
        heading(1, 'Guide'),
        heading(2, 'Setup'),
        heading(3, 'Install'),
        heading(2, 'Usage'),
        listItem(0, 'run it'),
      ],
      { title: 'Guide', paragraphs: 'skip' },
    );

    expect(outline).toEqual({
      title: 'Guide',
      children: [
        { text: 'Setup', children: [{ text: 'Install', children: [] }] },
        { text: 'Usage', children: [{ text: 'run it', children: [] }] },
      ],
    });
  });

  it('survives a skipped heading level', () => {
    const outline = outlineFromBlocks([heading(3, 'Deep'), heading(2, 'Shallow')], {
      title: 'T',
      paragraphs: 'skip',
    });
    expect(outline.children.map((child) => child.text)).toEqual(['Deep', 'Shallow']);
  });

  it('hangs a paragraph first sentence under the heading in scope', () => {
    const outline = outlineFromBlocks(
      [heading(2, 'Setup'), paragraph('Install it. Then configure it.')],
      { title: 'T', paragraphs: 'firstSentence' },
    );
    expect(outline.children[0]?.children).toEqual([{ text: 'Install it.', children: [] }]);
  });

  it('keeps whole paragraphs when asked', () => {
    const outline = outlineFromBlocks([heading(2, 'S'), paragraph('One. Two.')], {
      title: 'T',
      paragraphs: 'full',
    });
    expect(outline.children[0]?.children[0]?.text).toBe('One. Two.');
  });

  it('nests list items below the current heading', () => {
    const outline = outlineFromBlocks(
      [heading(2, 'S'), listItem(0, 'a'), listItem(1, 'a1'), listItem(0, 'b')],
      { title: 'T', paragraphs: 'skip' },
    );
    expect(outline.children[0]).toEqual({
      text: 'S',
      children: [
        { text: 'a', children: [{ text: 'a1', children: [] }] },
        { text: 'b', children: [] },
      ],
    });
  });
});

describe('normalizeOutline', () => {
  const deep: Outline = {
    title: 'Root',
    children: [node('L2', [node('L3', [node('L4', [node('L5')])])])],
  };

  it('drops levels past maxDepth', () => {
    const result = normalizeOutline(deep, { maxDepth: 3 });
    expect(outlineDepth(result)).toBe(3);
    expect(result.children[0]?.children[0]?.children).toEqual([]);
  });

  it('clamps maxDepth into the documented 2–6 range', () => {
    expect(outlineDepth(normalizeOutline(deep, { maxDepth: 99 }))).toBe(5);
    expect(outlineDepth(normalizeOutline(deep, { maxDepth: 0 }))).toBe(2);
  });

  it('collapses extra children into a counted marker', () => {
    const wide: Outline = {
      title: 'Root',
      children: Array.from({ length: 10 }, (_value, index) => node(`item ${index}`)),
    };
    const result = normalizeOutline(wide, { maxChildren: 3 });
    expect(result.children.map((child) => child.text)).toEqual([
      'item 0',
      'item 1',
      'item 2',
      '…(+7)',
    ]);
  });

  it('removes duplicate siblings and empty labels', () => {
    const result = normalizeOutline({
      title: 'Root',
      children: [node('same'), node('Same'), node('  '), node('other')],
    });
    expect(result.children.map((child) => child.text)).toEqual(['same', 'other']);
  });

  it('shortens long labels', () => {
    const long = 'word '.repeat(30).trim();
    const result = normalizeOutline({ title: long, children: [node(long)] });
    expect(result.title.endsWith('…')).toBe(true);
    expect(result.children[0]?.text.endsWith('…')).toBe(true);
  });

  it('always produces a root title', () => {
    expect(normalizeOutline({ title: '   ', children: [] }).title).toBe('Mind map');
  });
});

describe('countNodes / outlineDepth', () => {
  it('counts the root', () => {
    const outline: Outline = { title: 'R', children: [node('a', [node('b')]), node('c')] };
    expect(countNodes(outline)).toBe(4);
    expect(outlineDepth(outline)).toBe(3);
    expect(outlineDepth({ title: 'R', children: [] })).toBe(1);
  });
});

describe('outlineToMarkdown', () => {
  it('uses headings for the first levels and a list below them', () => {
    const outline: Outline = {
      title: 'Root',
      children: [node('A', [node('a1', [node('deep', [node('deeper')])])])],
    };
    expect(outlineToMarkdown(outline)).toBe(
      ['# Root', '', '## A', '', '### a1', '- deep', '  - deeper', ''].join('\n'),
    );
  });

  it('escapes text that would otherwise start Markdown structure', () => {
    const markdown = outlineToMarkdown({
      title: '# not a heading',
      children: [node('1. not a list')],
    });
    expect(markdown).toContain('\\# not a heading');
    expect(markdown).toContain('\\1. not a list');
  });

  it('round-trips through the parser', () => {
    const outline: Outline = {
      title: 'Root',
      children: [node('A', [node('a1')]), node('B')],
    };
    expect(parseOutlineMarkdown(outlineToMarkdown(outline))).toEqual(outline);
  });
});

describe('parseOutlineMarkdown', () => {
  it('reads a hand-written outline', () => {
    const outline = parseOutlineMarkdown('# Title\n\n## One\n- a\n  - b\n\n## Two\n');
    expect(outline).toEqual({
      title: 'Title',
      children: [
        { text: 'One', children: [{ text: 'a', children: [{ text: 'b', children: [] }] }] },
        { text: 'Two', children: [] },
      ],
    });
  });

  it('falls back to the given title when there is no heading', () => {
    expect(parseOutlineMarkdown('- just\n- a\n- list\n', 'Fallback').title).toBe('just');
  });
});
