import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  looksLikeHeadingLine,
  parsePageRange,
  pdfBytesToDocument,
  pdfFileToDocument,
  resolveUserPath,
} from '../../src/extract/pdf.js';
import { MindlmError } from '../../src/util/errors.js';

const FIXTURE = join(import.meta.dirname, '../fixtures/sample.pdf');

describe('parsePageRange', () => {
  it('returns undefined for an empty selection', () => {
    expect(parsePageRange(undefined, 10)).toBeUndefined();
    expect(parsePageRange('  ', 10)).toBeUndefined();
  });

  it('expands ranges, single pages and open ends', () => {
    expect(parsePageRange('1-3', 10)).toEqual([1, 2, 3]);
    expect(parsePageRange('2', 10)).toEqual([2]);
    expect(parsePageRange('8-', 10)).toEqual([8, 9, 10]);
  });

  it('de-duplicates, sorts and clips to the document length', () => {
    expect(parsePageRange('3,1-2,3,4-20', 5)).toEqual([1, 2, 3, 4, 5]);
    // A range that starts past the last page contributes nothing.
    expect(parsePageRange('1,9-20', 5)).toEqual([1]);
  });

  it('rejects nonsense and empty selections', () => {
    expect(() => parsePageRange('abc', 5)).toThrow(MindlmError);
    expect(() => parsePageRange('5-2', 5)).toThrow(/Invalid page range/);
    expect(() => parsePageRange('99', 5)).toThrow(/selects no page/);
  });
});

describe('looksLikeHeadingLine', () => {
  it('accepts numbered and CJK chapter headings', () => {
    expect(looksLikeHeadingLine('1. Introduction', undefined)).toBe(true);
    expect(looksLikeHeadingLine('2.1 Limits', undefined)).toBe(true);
    expect(looksLikeHeadingLine('第三章 方法', undefined)).toBe(true);
    expect(looksLikeHeadingLine('一、背景', undefined)).toBe(true);
  });

  it('rejects sentences and accepts short standalone lines above prose', () => {
    expect(looksLikeHeadingLine('This is an ordinary sentence.', undefined)).toBe(false);
    expect(looksLikeHeadingLine('Background', 'x'.repeat(120))).toBe(true);
    expect(looksLikeHeadingLine('Background', 'short')).toBe(false);
  });
});

describe('resolveUserPath', () => {
  it('produces absolute paths', () => {
    expect(resolveUserPath('/tmp/a.pdf')).toBe('/tmp/a.pdf');
    expect(resolveUserPath('a.pdf').startsWith('/')).toBe(true);
    expect(resolveUserPath('~').startsWith('/')).toBe(true);
  });
});

describe('pdfFileToDocument', () => {
  it('reads every page, the bookmarks and the metadata title', async () => {
    const result = await pdfFileToDocument(FIXTURE);

    expect(result.source.totalPages).toBe(3);
    expect(result.source.hasOutline).toBe(true);
    expect(result.outline.map((entry) => entry.title)).toEqual(['1. Introduction', '2. Methods']);
    expect(result.document.title).toBe('mindlm-mcp PDF fixture');
    expect(result.pageTexts).toHaveLength(3);
    expect(result.pageTexts[0]?.text).toContain('Introduction');
  });

  it('turns numbered lines into headings and prose into paragraphs', async () => {
    const { document } = await pdfFileToDocument(FIXTURE);
    const headings = document.blocks
      .filter((block) => block.type === 'heading')
      .map((block) => block.text);

    expect(headings).toContain('1. Introduction');
    expect(headings).toContain('2. Methods');
    expect(headings).toContain('2.1 Limits');
    expect(document.blocks.some((block) => block.type === 'paragraph')).toBe(true);
    // Page 2 and 3 are separated by page-break markers.
    expect(document.blocks.filter((block) => block.type === 'pageBreak')).toHaveLength(2);
  });

  it('nests bookmark headings above heuristic ones', async () => {
    const { document } = await pdfFileToDocument(FIXTURE);
    const intro = document.blocks.find(
      (block) => block.type === 'heading' && block.text === '1. Introduction',
    );
    const limits = document.blocks.find(
      (block) => block.type === 'heading' && block.text === '2.1 Limits',
    );
    // The bookmark is level 1; the un-bookmarked "2.1" falls out of the numbering.
    expect(intro?.type === 'heading' && intro.level).toBe(1);
    expect(limits?.type === 'heading' && limits.level).toBe(3);
  });

  it('honours a page selection', async () => {
    const result = await pdfFileToDocument(FIXTURE, { pages: '3' });
    expect(result.pageTexts.map((entry) => entry.page)).toEqual([3]);
    expect(result.document.truncated).toBe(true);
    expect(result.source.pages).toBe('3');
  });

  it('reports a missing file as an input error', async () => {
    await expect(pdfFileToDocument(join(import.meta.dirname, 'nope.pdf'))).rejects.toThrow(
      /No such file/,
    );
  });
});

describe('pdfBytesToDocument', () => {
  it('rejects data that is not a PDF', async () => {
    await expect(pdfBytesToDocument(new TextEncoder().encode('hello'))).rejects.toThrow(
      /does not look like a PDF/,
    );
    await expect(pdfBytesToDocument(new Uint8Array(0))).rejects.toThrow(/empty/);
  });

  it('accepts bytes read straight off disk', async () => {
    const bytes = new Uint8Array(await readFile(FIXTURE));
    const result = await pdfBytesToDocument(bytes, { label: 'sample.pdf' });
    expect(result.source.totalPages).toBe(3);
    expect(result.source.path).toBeUndefined();
  });
});
