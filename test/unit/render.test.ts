import { describe, expect, it } from 'vitest';
import { installedVersion, loadOfflineAssets, packageRoot } from '../../src/render/assets.js';
import { BRANDING_URL } from '../../src/render/branding.js';
import { escapeHtml, escapeScriptEnd, renderMindmapHtml } from '../../src/render/html.js';

const OUTLINE = ['# Root', '', '## Section A', '- one', '- two', '', '## Section B'].join('\n');

describe('offline rendering', () => {
  it('produces a single file with no remote script or stylesheet', async () => {
    const { html, offline } = await renderMindmapHtml({ markdown: OUTLINE });

    expect(offline).toBe(true);
    expect(html).not.toMatch(/<script[^>]+src=["']?http/i);
    // The strict form the brief asks for.
    expect(html.includes('<script src="http')).toBe(false);
    expect(html).not.toMatch(/<link[^>]+href=["']?http/i);
    expect(html).not.toContain('cdn.jsdelivr.net');
  });

  it('inlines d3, markmap-view and the toolbar', async () => {
    const { html } = await renderMindmapHtml({ markdown: OUTLINE });
    const assets = await loadOfflineAssets();

    expect(html.length).toBeGreaterThan(300_000);
    expect(html).toContain(assets.d3.slice(0, 200));
    expect(html).toContain(assets.view.slice(0, 200));
    expect(html).toContain('mm-toolbar');
    expect(html).toContain('markmap.Toolbar');
  });

  it('omits the toolbar when asked', async () => {
    const { html } = await renderMindmapHtml({ markdown: OUTLINE, toolbar: false });
    expect(html).not.toContain('markmap.Toolbar');
    expect(html).not.toContain('mm-toolbar');
  });

  it('keeps every script tag balanced', async () => {
    const { html } = await renderMindmapHtml({ markdown: OUTLINE });
    const opens = html.match(/<script\b/gi) ?? [];
    const closes = html.match(/<\/script>/gi) ?? [];
    expect(opens).toHaveLength(closes.length);
  });

  it('reports the node count and the resolved title', async () => {
    const result = await renderMindmapHtml({ markdown: OUTLINE });
    // root + 2 sections + 2 list items
    expect(result.nodes).toBe(5);
    expect(result.title).toBe('Root');
    expect(result.html).toContain('<title>Root</title>');
  });

  it('prefers an explicit title and escapes it', async () => {
    const { html, title } = await renderMindmapHtml({
      markdown: OUTLINE,
      title: 'A & B </script>',
    });
    expect(title).toBe('A & B </script>');
    expect(html).toContain('<title>A &amp; B &lt;/script&gt;</title>');
  });

  it('reads the title out of frontmatter', async () => {
    const { title } = await renderMindmapHtml({
      markdown: '---\ntitle: From frontmatter\n---\n\n# Root\n',
    });
    expect(title).toBe('From frontmatter');
  });

  it('stamps a generator meta tag', async () => {
    const { html } = await renderMindmapHtml({ markdown: OUTLINE });
    expect(html).toMatch(/<meta name="generator" content="mindlm-mcp \d+\.\d+\.\d+" \/>/);
  });

  it('passes display options through to markmap', async () => {
    const { html } = await renderMindmapHtml({
      markdown: OUTLINE,
      initialExpandLevel: 2,
      colorFreezeLevel: 3,
      maxWidth: 320,
    });
    expect(html).toContain('"initialExpandLevel":2');
    expect(html).toContain('"colorFreezeLevel":3');
    expect(html).toContain('"maxWidth":320');
  });
});

describe('XSS handling', () => {
  it('escapes raw HTML rather than rendering it', async () => {
    const { html } = await renderMindmapHtml({
      markdown: '# Root\n\n- <img src=x onerror=alert(1)>\n- <script>alert(2)</script>\n',
    });
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
    // No live tag was emitted from the outline content.
    expect(html).not.toMatch(/<img[^>]+onerror/i);
  });

  it('leaves a javascript: link as plain text', async () => {
    const { html } = await renderMindmapHtml({
      markdown: '# Root\n\n- [go](javascript:alert(1))\n',
    });
    expect(html).not.toMatch(/href=\\?"javascript:/i);
    expect(html).toContain('[go](javascript:alert(1))');
  });

  it('still linkifies an ordinary http link', async () => {
    const { html } = await renderMindmapHtml({
      markdown: '# Root\n\n- [ok](https://example.com/)\n',
    });
    expect(html).toContain('href=\\"https://example.com/\\">ok');
  });

  it('cannot be broken out of with a closing script tag', async () => {
    const { html } = await renderMindmapHtml({ markdown: '# Root\n\n- a</script><b>bold</b>\n' });
    const scriptBlocks = html.split(/<script\b[^>]*>/i).slice(1);
    // Every script block must end at its own </script>, with nothing stray before it.
    for (const block of scriptBlocks) {
      const end = block.indexOf('</script>');
      expect(end).toBeGreaterThanOrEqual(0);
      expect(block.slice(0, end)).not.toContain('</script');
    }
  });
});

describe('escapeScriptEnd', () => {
  it('neutralises a closing script tag without changing the code', () => {
    expect(escapeScriptEnd('var a = "</script>";')).toBe('var a = "<\\/script>";');
    expect(escapeScriptEnd('a < b')).toBe('a < b');
  });
});

describe('escapeHtml', () => {
  it('escapes the five dangerous characters', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
});

describe('CDN rendering', () => {
  it('references jsDelivr instead of inlining', async () => {
    const { html, offline } = await renderMindmapHtml({ markdown: OUTLINE, offline: false });

    expect(offline).toBe(false);
    expect(html.length).toBeLessThan(20_000);
    expect(html).toContain('<script src="https://cdn.jsdelivr.net/npm/d3@');
    expect(html).toContain('markmap-view@');
    expect(html).toContain('markmap-toolbar@');
  });

  it('uses the installed versions in the URLs', async () => {
    const { html } = await renderMindmapHtml({ markdown: OUTLINE, offline: false });
    expect(html).toContain(`d3@${await installedVersion('d3')}/dist/d3.min.js`);
  });
});

describe('branding footer', () => {
  it('is absent by default', async () => {
    const { html } = await renderMindmapHtml({ markdown: OUTLINE });
    expect(html.includes(BRANDING_URL)).toBe(false);
    expect(html.includes('Made with')).toBe(false);
    // The generator meta tag is the only mention of the tool, and it is not a link.
    expect(html.match(/mindlm/g)).toEqual(['mindlm']);
  });

  it('is added when explicitly enabled', async () => {
    const { html } = await renderMindmapHtml({ markdown: OUTLINE, branding: true });
    expect(html).toContain(`<a href="${escapeHtml(BRANDING_URL)}"`);
    expect(html).toContain('Made with mindlm-mcp');
  });
});

describe('asset resolution', () => {
  it('finds package roots for the inlined dependencies', () => {
    for (const specifier of ['d3', 'markmap-view', 'markmap-toolbar']) {
      expect(packageRoot(specifier).endsWith(specifier)).toBe(true);
    }
  });

  it('reads real versions off disk', async () => {
    expect(await installedVersion('markmap-view')).toMatch(/^\d+\.\d+\.\d+/);
  });
});
