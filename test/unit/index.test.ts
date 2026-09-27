import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { textToDocument } from '../../src/extract/text.js';
import {
  OUTLINE_DEFAULTS,
  outlineFromDocument,
  pdfToOutline,
  textToMindmapHtml,
  textToOutline,
} from '../../src/index.js';

const FIXTURE = join(import.meta.dirname, '../fixtures/sample.pdf');

const ARTICLE = ['# Release notes', '', '## Added', '- offline export', '- page ranges'].join('\n');

describe('textToOutline', () => {
  it('returns markdown, the tree and stats together', () => {
    const result = textToOutline(ARTICLE);

    expect(result.title).toBe('Release notes');
    expect(result.markdown.startsWith('# Release notes')).toBe(true);
    expect(result.outline.children.map((child) => child.text)).toEqual(['Added']);
    expect(result.stats).toEqual({
      inputChars: expect.any(Number),
      nodes: 4,
      depth: 3,
      truncated: false,
    });
  });

  it('accepts a title override', () => {
    expect(textToOutline(ARTICLE, { title: 'Custom' }).title).toBe('Custom');
  });

  it('exposes the documented defaults', () => {
    expect(OUTLINE_DEFAULTS).toEqual({ maxDepth: 4, maxChildren: 8 });
  });
});

describe('outlineFromDocument', () => {
  it('reports truncation from the document', () => {
    const document = textToDocument('a'.repeat(50), { maxChars: 10 });
    expect(outlineFromDocument(document).stats.truncated).toBe(true);
  });
});

describe('pdfToOutline', () => {
  it('outlines the committed fixture', async () => {
    const result = await pdfToOutline(FIXTURE);
    expect(result.source.totalPages).toBe(3);
    expect(result.markdown).toContain('Introduction');
    expect(result.outline.children.length).toBeGreaterThan(0);
  });
});

describe('textToMindmapHtml', () => {
  it('outlines and renders in one call', async () => {
    const { outline, html } = await textToMindmapHtml(ARTICLE);
    expect(outline.title).toBe('Release notes');
    expect(html).toContain('<title>Release notes</title>');
    expect(html.includes('<script src="http')).toBe(false);
  });

  it('passes render flags through', async () => {
    const { html } = await textToMindmapHtml(ARTICLE, { offline: false, toolbar: false });
    expect(html).toContain('cdn.jsdelivr.net');
    expect(html).not.toContain('markmap.Toolbar');
  });
});
