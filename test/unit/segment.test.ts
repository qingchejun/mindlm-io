import { describe, expect, it } from 'vitest';
import {
  countWords,
  firstSentence,
  isCjk,
  shortenLabel,
  splitSentences,
  tokenize,
} from '../../src/util/segment.js';

describe('isCjk', () => {
  it('detects Chinese and Japanese text', () => {
    expect(isCjk('这是一段中文文本，用来测试分句。')).toBe(true);
    expect(isCjk('これは日本語のテキストです。')).toBe(true);
  });

  it('treats Latin text and a stray CJK character as non-CJK', () => {
    expect(isCjk('This is plain English prose.')).toBe(false);
    expect(isCjk(`One character 中 in a long English sentence ${'word '.repeat(20)}`)).toBe(false);
  });
});

describe('splitSentences', () => {
  it('splits English prose', () => {
    expect(splitSentences('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?']);
  });

  it('splits Chinese prose on full-width punctuation', () => {
    expect(splitSentences('第一句。第二句！第三句？')).toEqual([
      '第一句。',
      '第二句！',
      '第三句？',
    ]);
  });

  it('collapses whitespace and returns the whole text when there is one sentence', () => {
    expect(splitSentences('  a   single\n line  ')).toEqual(['a single line']);
    expect(splitSentences('   ')).toEqual([]);
  });
});

describe('firstSentence', () => {
  it('returns the opening sentence only', () => {
    expect(firstSentence('Lead sentence. Trailing detail.')).toBe('Lead sentence.');
    expect(firstSentence('')).toBe('');
  });
});

describe('tokenize / countWords', () => {
  it('counts word-like tokens and drops punctuation', () => {
    expect(tokenize('Hello, world!')).toEqual(['hello', 'world']);
    expect(countWords('one two three')).toBe(3);
  });

  it('segments Chinese into words rather than characters', () => {
    expect(tokenize('思维导图很有用').length).toBeGreaterThan(1);
  });
});

describe('shortenLabel', () => {
  it('leaves short labels untouched', () => {
    expect(shortenLabel('Short label')).toBe('Short label');
  });

  it('cuts English labels on a word boundary', () => {
    const label = shortenLabel(
      'one two three four five six seven eight nine ten eleven twelve thirteen',
    );
    expect(label.endsWith('…')).toBe(true);
    expect(label.split(' ')).toHaveLength(12);
  });

  it('cuts CJK labels by character count', () => {
    const label = shortenLabel('中'.repeat(80));
    expect([...label]).toHaveLength(41); // 40 characters plus the ellipsis
  });

  it('respects explicit budgets and collapses whitespace', () => {
    expect(shortenLabel('a b c d', { words: 2 })).toBe('a b…');
    expect(shortenLabel('  spaced   out  ')).toBe('spaced out');
    expect(shortenLabel('')).toBe('');
  });
});
