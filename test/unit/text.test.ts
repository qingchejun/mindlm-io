import { describe, expect, it } from 'vitest';
import { looksLikeMarkdown, stripInlineMarkdown, textToDocument } from '../../src/extract/text.js';

describe('looksLikeMarkdown', () => {
  it('recognises ATX headings and fenced code', () => {
    expect(looksLikeMarkdown('# Title\n\nbody')).toBe(true);
    expect(looksLikeMarkdown('```js\nconst a = 1;\n```')).toBe(true);
  });

  it('recognises a document that is mostly a list', () => {
    expect(looksLikeMarkdown('- one\n- two\n- three\n- four')).toBe(true);
  });

  it('treats prose as plain text', () => {
    expect(looksLikeMarkdown('Hello there.\n\nThis is prose - with a dash.')).toBe(false);
  });
});

describe('stripInlineMarkdown', () => {
  it('unwraps links, emphasis and code spans', () => {
    expect(stripInlineMarkdown('see [the docs](https://example.com/x) now')).toBe(
      'see the docs now',
    );
    expect(stripInlineMarkdown('**bold** and *italic* and `code`')).toBe(
      'bold and italic and code',
    );
    expect(stripInlineMarkdown('![alt text](img.png)')).toBe('alt text');
    expect(stripInlineMarkdown('~~gone~~')).toBe('gone');
  });

  it('keeps escaped markers as literal characters', () => {
    expect(stripInlineMarkdown('2 \\* 3')).toBe('2 * 3');
  });

  it('removes inline HTML tags', () => {
    expect(stripInlineMarkdown('a <em>b</em> c')).toBe('a b c');
  });
});

describe('textToDocument (markdown)', () => {
  it('captures heading levels and list nesting', () => {
    const { blocks, title } = textToDocument(
      ['# Guide', '', '## Setup', '', 'Install it first.', '', '- one', '  - one a', '- two'].join(
        '\n',
      ),
    );

    expect(title).toBe('Guide');
    expect(blocks).toEqual([
      { type: 'heading', level: 1, text: 'Guide' },
      { type: 'heading', level: 2, text: 'Setup' },
      { type: 'paragraph', text: 'Install it first.' },
      { type: 'listItem', depth: 0, text: 'one' },
      { type: 'listItem', depth: 1, text: 'one a' },
      { type: 'listItem', depth: 0, text: 'two' },
    ]);
  });

  it('handles setext headings', () => {
    const { blocks } = textToDocument('Title\n=====\n\nSub\n---\n\nbody text here');
    expect(blocks[0]).toEqual({ type: 'heading', level: 1, text: 'Title' });
    expect(blocks[1]).toEqual({ type: 'heading', level: 2, text: 'Sub' });
  });

  it('drops fenced code blocks and thematic breaks', () => {
    const { blocks } = textToDocument('# T\n\n```\nsecret code\n```\n\n---\n\nafter');
    expect(
      blocks.some((block) => block.type !== 'pageBreak' && block.text.includes('secret code')),
    ).toBe(false);
    expect(blocks.at(-1)).toEqual({ type: 'paragraph', text: 'after' });
  });

  it('flattens block quotes and tables', () => {
    const { blocks } = textToDocument(
      '# T\n\n> quoted line\n\n| a | b |\n| --- | --- |\n| 1 | 2 |',
    );
    expect(blocks).toContainEqual({ type: 'paragraph', text: 'quoted line' });
    expect(blocks).toContainEqual({ type: 'paragraph', text: 'a · b' });
    expect(blocks).toContainEqual({ type: 'paragraph', text: '1 · 2' });
  });

  it('joins a wrapped paragraph into one block', () => {
    const { blocks } = textToDocument('# T\n\nfirst line\nsecond line\n\nnext');
    expect(blocks[1]).toEqual({ type: 'paragraph', text: 'first line second line' });
  });

  it('folds an indented continuation into the list item above it', () => {
    const { blocks } = textToDocument('# T\n\n- item one\n  continued here\n- item two');
    expect(blocks[1]).toEqual({ type: 'listItem', depth: 0, text: 'item one continued here' });
  });
});

describe('textToDocument (plain text)', () => {
  it('splits on blank lines', () => {
    const { blocks } = textToDocument('First paragraph.\n\nSecond paragraph.');
    expect(blocks).toEqual([
      { type: 'paragraph', text: 'First paragraph.' },
      { type: 'paragraph', text: 'Second paragraph.' },
    ]);
  });

  it('derives a title from the first sentence', () => {
    const { title } = textToDocument('A short opener. Then more prose follows here.');
    expect(title).toBe('A short opener.');
  });

  it('strips a BOM and normalises CRLF', () => {
    const { blocks } = textToDocument('﻿one\r\n\r\ntwo');
    expect(blocks).toEqual([
      { type: 'paragraph', text: 'one' },
      { type: 'paragraph', text: 'two' },
    ]);
  });

  it('marks truncation when the input exceeds the limit', () => {
    const document = textToDocument('a'.repeat(100), { maxChars: 20 });
    expect(document.truncated).toBe(true);
    expect(document.blocks[0]).toEqual({ type: 'paragraph', text: 'a'.repeat(20) });
  });
});
