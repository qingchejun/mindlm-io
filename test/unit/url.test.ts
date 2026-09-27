import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { decodeBody, extractArticle, fetchUrlDocument } from '../../src/extract/url.js';
import { urlToOutline } from '../../src/index.js';
import { USER_AGENT } from '../../src/util/version.js';
import { startTestServer, type TestServer } from '../helpers/http-server.js';

/** Text of every block, page breaks excluded. */
const textsOf = (blocks: { type: string; text?: string }[]): string[] =>
  blocks.filter((block) => block.type !== 'pageBreak').map((block) => block.text ?? '');

/** "思维导图" encoded as GBK — the case a UTF-8-only decoder gets wrong. */
const GBK_TITLE = Uint8Array.from([0xcb, 0xbc, 0xce, 0xac, 0xb5, 0xbc, 0xcd, 0xbc]);

const ARTICLE_HTML = `<!doctype html>
<html lang="en">
<head><title>Site name — Article title</title></head>
<body>
  <nav><a href="/">Home</a><a href="/about">About</a></nav>
  <article>
    <h1>Article title</h1>
    <p>An opening paragraph with enough words in it that Readability is willing to
       treat this element as the main content of the page rather than boilerplate.</p>
    <h2>A section</h2>
    <p>A second paragraph, also comfortably long, so that the extracted article has
       real structure worth turning into an outline of its own.</p>
    <ul><li>first point</li><li>second point</li></ul>
  </article>
  <script>window.analytics = 1;</script>
  <footer>Copyright 2026</footer>
</body>
</html>`;

let server: TestServer;
let lastRequestHeaders: Record<string, string | string[] | undefined> = {};

beforeAll(async () => {
  process.env.MINDMAP_ALLOW_PRIVATE_HOSTS = 'true';
  server = await startTestServer((request, response) => {
    lastRequestHeaders = request.headers;
    const path = request.url ?? '/';

    if (path === '/article') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(ARTICLE_HTML);
      return;
    }
    if (path === '/gbk') {
      // No charset in the header: it can only be found in the meta tag.
      response.writeHead(200, { 'content-type': 'text/html' });
      const head = Buffer.from('<!doctype html><html><head><meta charset="gbk"><title>');
      const tail = Buffer.from('</title></head><body><h1>');
      const end = Buffer.from(
        '</h1><p>0123456789 0123456789 0123456789 0123456789 0123456789.</p></body></html>',
      );
      response.end(
        Buffer.concat([head, Buffer.from(GBK_TITLE), tail, Buffer.from(GBK_TITLE), end]),
      );
      return;
    }
    if (path === '/wiki') {
      void (async () => {
        const html = await readFile(
          join(import.meta.dirname, '../fixtures/mediawiki-article.html'),
        );
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(html);
      })();
      return;
    }
    if (path === '/plain') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('First paragraph here.\n\nSecond paragraph here.');
      return;
    }
    if (path === '/markdown') {
      response.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
      response.end('# From markdown\n\n## A\n- one\n');
      return;
    }
    if (path === '/pdf') {
      void (async () => {
        const bytes = await readFile(join(import.meta.dirname, '../fixtures/sample.pdf'));
        response.writeHead(200, { 'content-type': 'application/pdf' });
        response.end(bytes);
      })();
      return;
    }
    if (path === '/redirect') {
      response.writeHead(302, { location: '/article' });
      response.end();
      return;
    }
    if (path === '/loop') {
      response.writeHead(302, { location: '/loop' });
      response.end();
      return;
    }
    if (path === '/image') {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      return;
    }
    if (path === '/big') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('x'.repeat(200_000));
      return;
    }
    if (path === '/boom') {
      response.writeHead(500, { 'content-type': 'text/html' });
      response.end('<html><body>nope</body></html>');
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
  });
});

afterAll(async () => {
  await server.close();
  delete process.env.MINDMAP_ALLOW_PRIVATE_HOSTS;
});

afterEach(() => {
  lastRequestHeaders = {};
});

describe('fetchUrlDocument (HTML)', () => {
  it('extracts the article body and drops the chrome', async () => {
    const result = await fetchUrlDocument(server.url('/article'));

    expect(result.kind).toBe('document');
    if (result.kind !== 'document') return;

    const texts = textsOf(result.document.blocks);
    expect(texts.join(' ')).toContain('An opening paragraph');
    expect(texts.join(' ')).not.toContain('Copyright 2026');
    expect(texts.join(' ')).not.toContain('window.analytics');
    expect(result.document.blocks.some((block) => block.type === 'listItem')).toBe(true);
    expect(result.source.title).toContain('Article title');
    expect(result.source.contentType).toBe('text/html');
    expect(result.source.finalUrl).toBe(server.url('/article'));
  });

  it('identifies itself with the project user agent', async () => {
    await fetchUrlDocument(server.url('/article'));
    expect(lastRequestHeaders['user-agent']).toBe(USER_AGENT);
  });

  it('follows a redirect and reports the final URL', async () => {
    const result = await fetchUrlDocument(server.url('/redirect'));
    expect(result.source.url).toBe(server.url('/redirect'));
    expect(result.source.finalUrl).toBe(server.url('/article'));
  });

  it('gives up on a redirect loop', async () => {
    await expect(fetchUrlDocument(server.url('/loop'), { maxRedirects: 2 })).rejects.toThrow(
      /Too many redirects/,
    );
  });

  it('keeps every section of a wiki-shaped page and drops its furniture', async () => {
    const result = await fetchUrlDocument(server.url('/wiki'));
    expect(result.kind).toBe('document');
    if (result.kind !== 'document') return;

    // Every section title survives, not just the first one: the [edit] link next
    // to it used to make the whole heading look like a low-content block.
    const headings = result.document.blocks
      .filter((block) => block.type === 'heading')
      .map((block) => block.text);
    expect(headings).toContain('Origins');
    expect(headings).toContain('Estate plans');
    expect(headings).toContain('Regional styles');
    expect(headings).toContain('Tools');

    const all = textsOf(result.document.blocks).join('\n');
    expect(all).not.toContain('[edit]');
    expect(all).not.toContain('[1]');
    expect(all).not.toContain('From Testipedia, the free encyclopedia');
    expect(all).not.toContain('This article is about the');
    expect(all).not.toContain('A hand-drawn map');
    expect(all).not.toContain('Jump to content');
    // Trailing citation and link sections are dropped by default.
    expect(headings).not.toContain('See also');
    expect(headings).not.toContain('References');
    expect(headings).not.toContain('External links');
  });

  it('outlines that page with one branch per section', async () => {
    const result = await urlToOutline(server.url('/wiki'));
    expect(result.title).toBe('Cartography of tea');
    expect(result.markdown).toContain('## Origins');
    expect(result.markdown).toContain('### Estate plans');
    expect(result.markdown).toContain('## Regional styles');
    expect(result.markdown).toContain('## Tools');
    expect(result.markdown).not.toContain('edit');
  });

  it('decodes a GBK page declared only in a meta tag', async () => {
    const result = await fetchUrlDocument(server.url('/gbk'));
    expect(result.kind).toBe('document');
    if (result.kind !== 'document') return;
    expect(textsOf(result.document.blocks)).toContain('思维导图');
  });
});

describe('fetchUrlDocument (other content types)', () => {
  it('reads plain text as paragraphs', async () => {
    const result = await fetchUrlDocument(server.url('/plain'));
    expect(result.kind).toBe('document');
    if (result.kind !== 'document') return;
    expect(result.document.blocks).toEqual([
      { type: 'paragraph', text: 'First paragraph here.' },
      { type: 'paragraph', text: 'Second paragraph here.' },
    ]);
  });

  it('reads Markdown as structure', async () => {
    const result = await fetchUrlDocument(server.url('/markdown'));
    expect(result.kind).toBe('document');
    if (result.kind !== 'document') return;
    expect(result.document.title).toBe('From markdown');
    expect(result.document.blocks[1]).toEqual({ type: 'heading', level: 2, text: 'A' });
  });

  it('hands a PDF response back as bytes', async () => {
    const result = await fetchUrlDocument(server.url('/pdf'));
    expect(result.kind).toBe('pdf');
    if (result.kind !== 'pdf') return;
    expect(result.source.contentType).toBe('application/pdf');
    expect(new TextDecoder('latin1').decode(result.bytes.subarray(0, 5))).toBe('%PDF-');
  });

  it('rejects an unsupported content type', async () => {
    await expect(fetchUrlDocument(server.url('/image'))).rejects.toThrow(
      /Unsupported content type "image\/png"/,
    );
  });
});

describe('fetchUrlDocument (failures)', () => {
  it('rejects a malformed URL', async () => {
    await expect(fetchUrlDocument('not a url')).rejects.toThrow(/is not a valid URL/);
  });

  it('reports a non-2xx status', async () => {
    await expect(fetchUrlDocument(server.url('/boom'))).rejects.toThrow(/returned HTTP 500/);
  });

  it('enforces the size limit', async () => {
    await expect(fetchUrlDocument(server.url('/big'), { maxBytes: 1024 })).rejects.toThrow(
      /larger than/,
    );
  });

  it('refuses a private host when the opt-in is off', async () => {
    delete process.env.MINDMAP_ALLOW_PRIVATE_HOSTS;
    try {
      await expect(fetchUrlDocument(server.url('/article'))).rejects.toThrow(/private or loopback/);
    } finally {
      process.env.MINDMAP_ALLOW_PRIVATE_HOSTS = 'true';
    }
  });
});

describe('decodeBody', () => {
  it('honours an explicit charset', () => {
    expect(decodeBody(GBK_TITLE, 'gbk')).toBe('思维导图');
  });

  it('strips a UTF-8 BOM', () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, 0x68, 0x69]);
    expect(decodeBody(bytes)).toBe('hi');
  });

  it('reads UTF-16 from its BOM', () => {
    const bytes = Uint8Array.from([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]);
    expect(decodeBody(bytes)).toBe('hi');
  });

  it('falls back to UTF-8 for an unknown label', () => {
    expect(decodeBody(new TextEncoder().encode('hi'), 'no-such-encoding')).toBe('hi');
  });
});

describe('extractArticle', () => {
  it('keeps the document title and falls back to the host as a site name', () => {
    const result = extractArticle(
      '<!doctype html><html><head><title>Tiny</title></head><body><h1>Just a heading</h1></body></html>',
      'https://example.com/x',
    );
    // Readability demotes the leading h1 to h2 when it duplicates the title.
    expect(result.blocks).toContainEqual({ type: 'heading', level: 2, text: 'Just a heading' });
    expect(result.meta.title).toBe('Tiny');
    expect(result.meta.siteName).toBe('example.com');
  });

  it('returns an empty block list rather than throwing on junk', () => {
    expect(extractArticle('', 'https://example.com/').blocks).toEqual([]);
    expect(extractArticle('<<<>>>', 'not a url').meta.siteName).toBeUndefined();
  });
});

describe('urlToOutline', () => {
  it('outlines a fetched page and keeps the source metadata', async () => {
    const result = await urlToOutline(server.url('/article'));

    expect(result.title).toContain('Article title');
    expect(result.markdown.startsWith('# ')).toBe(true);
    expect(result.source.finalUrl).toBe(server.url('/article'));
    expect(result.stats.nodes).toBeGreaterThan(1);
    expect(result.pdf).toBeUndefined();
  });

  it('hands a PDF URL over to the PDF pipeline', async () => {
    const result = await urlToOutline(server.url('/pdf'));

    expect(result.source.contentType).toBe('application/pdf');
    expect(result.pdf?.totalPages).toBe(3);
    expect(result.markdown).toContain('Introduction');
  });
});
