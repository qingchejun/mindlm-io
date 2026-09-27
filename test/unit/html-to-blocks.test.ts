import { describe, expect, it } from 'vitest';
import { htmlToBlocks } from '../../src/extract/html-to-blocks.js';

describe('htmlToBlocks', () => {
  it('keeps headings, paragraphs and list nesting', () => {
    const blocks = htmlToBlocks(`
      <h1>Guide</h1>
      <p>An opening paragraph that is long enough to stand on its own.</p>
      <h2>Setup</h2>
      <ul>
        <li>first
          <ul><li>nested</li></ul>
        </li>
        <li>second</li>
      </ul>
    `);

    expect(blocks).toEqual([
      { type: 'heading', level: 1, text: 'Guide' },
      { type: 'paragraph', text: 'An opening paragraph that is long enough to stand on its own.' },
      { type: 'heading', level: 2, text: 'Setup' },
      { type: 'listItem', depth: 0, text: 'first' },
      { type: 'listItem', depth: 1, text: 'nested' },
      { type: 'listItem', depth: 0, text: 'second' },
    ]);
  });

  it('drops scripts, styles and chrome', () => {
    const blocks = htmlToBlocks(`
      <nav><a href="/">Home</a></nav>
      <script>alert('x')</script>
      <style>body{color:red}</style>
      <article><p>Real content lives here and is reasonably long.</p></article>
      <footer>© 2026</footer>
    `);

    expect(blocks).toEqual([
      { type: 'paragraph', text: 'Real content lives here and is reasonably long.' },
    ]);
  });

  it('keeps inline markup as text', () => {
    const blocks = htmlToBlocks(
      '<p>a <strong>bold</strong> and <a href="/x">linked</a> phrase</p>',
    );
    expect(blocks).toEqual([{ type: 'paragraph', text: 'a bold and linked phrase' }]);
  });

  it('flattens table rows', () => {
    const blocks = htmlToBlocks('<table><tr><th>Name</th><th>Role</th></tr></table>');
    expect(blocks).toEqual([{ type: 'paragraph', text: 'Name · Role' }]);
  });

  it('unwraps a full document', () => {
    const blocks = htmlToBlocks(
      '<!doctype html><html><head><title>T</title></head><body><h1>Hi</h1></body></html>',
    );
    expect(blocks).toEqual([{ type: 'heading', level: 1, text: 'Hi' }]);
  });

  it('skips preformatted code', () => {
    const blocks = htmlToBlocks('<pre><code>const secret = 1;</code></pre><p>after the code.</p>');
    expect(blocks).toEqual([{ type: 'paragraph', text: 'after the code.' }]);
  });

  it('rejoins inline-split fragments into one paragraph', () => {
    const blocks = htmlToBlocks('<div><p>A short lead</p><p>that continues right here.</p></div>');
    expect(blocks).toEqual([
      { type: 'paragraph', text: 'A short lead that continues right here.' },
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(htmlToBlocks('')).toEqual([]);
    expect(htmlToBlocks('   ')).toEqual([]);
  });
});
