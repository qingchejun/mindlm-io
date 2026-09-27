import { describe, expect, it } from 'vitest';
import {
  blocksToText,
  clampLevel,
  compactBlocks,
  countChars,
  hasHeadings,
  heading,
  listItem,
  normalizeInline,
  pageBreak,
  paragraph,
} from '../../src/outline/blocks.js';

describe('block constructors', () => {
  it('clamp heading levels into 1–6', () => {
    expect(clampLevel(0)).toBe(1);
    expect(clampLevel(9)).toBe(6);
    expect(heading(0, 'x')).toEqual({ type: 'heading', level: 1, text: 'x' });
    expect(heading(7, 'x')).toEqual({ type: 'heading', level: 6, text: 'x' });
  });

  it('clamp list depth to zero or more', () => {
    expect(listItem(-3, 'x')).toEqual({ type: 'listItem', depth: 0, text: 'x' });
  });
});

describe('normalizeInline', () => {
  it('collapses whitespace and strips zero-width characters', () => {
    expect(normalizeInline('  a​ b \n c  ')).toBe('a b c');
    expect(normalizeInline('a b')).toBe('a b');
  });
});

describe('compactBlocks', () => {
  it('drops empty text blocks but keeps page breaks', () => {
    expect(compactBlocks([paragraph('  '), pageBreak(2), paragraph('x')])).toEqual([
      { type: 'pageBreak', page: 2 },
      { type: 'paragraph', text: 'x' },
    ]);
  });
});

describe('hasHeadings', () => {
  it('detects any heading', () => {
    expect(hasHeadings([paragraph('x')])).toBe(false);
    expect(hasHeadings([paragraph('x'), heading(2, 'y')])).toBe(true);
  });
});

describe('blocksToText', () => {
  it('renders a readable plain-text view', () => {
    const text = blocksToText([
      heading(1, 'Title'),
      paragraph('Body text.'),
      listItem(0, 'one'),
      listItem(1, 'nested'),
      pageBreak(2),
      paragraph('Next page.'),
    ]);

    expect(text).toBe(
      ['# Title', '', 'Body text.', '', '- one', '  - nested', '', 'Next page.'].join('\n'),
    );
  });
});

describe('countChars', () => {
  it('sums text length and ignores page breaks', () => {
    expect(countChars([paragraph('abc'), pageBreak(1), heading(2, 'de')])).toBe(5);
  });
});
