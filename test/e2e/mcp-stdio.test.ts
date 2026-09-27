import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from '../helpers/http-server.js';

const CLI = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const PAGE = `<!doctype html>
<html lang="en">
<head><title>Tide tables</title></head>
<body>
  <article>
    <h1>Tide tables</h1>
    <p>Spring tides happen when the sun and the moon pull along the same line, and the
       difference between high and low water is at its largest of the whole month.</p>
    <h2>Neap tides</h2>
    <p>Neap tides happen when the sun and the moon pull at right angles to each other,
       so the two bulges partly cancel and the range is at its smallest.</p>
  </article>
</body>
</html>`;

let client: Client;
let transport: StdioClientTransport;
let directory: string;
let page: TestServer;

/** Every tool result carries a text block; this is the readable half. */
function textOf(result: { content?: unknown }): string {
  const content = (result.content ?? []) as { type: string; text?: string }[];
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

function structured(result: { structuredContent?: unknown }): Record<string, unknown> {
  expect(result.structuredContent).toBeTypeOf('object');
  return result.structuredContent as Record<string, unknown>;
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mindlm-mcp-'));
  page = await startTestServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(PAGE);
  });

  transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI, 'serve', '--quiet'],
    cwd: ROOT,
    stderr: 'pipe',
    env: {
      PATH: process.env.PATH ?? '',
      // The test server is on loopback, which the SSRF guard blocks by default.
      MINDMAP_ALLOW_PRIVATE_HOSTS: 'true',
      MINDMAP_OUTPUT_DIR: directory,
      MINDMAP_CLIENT_MAX_CHARS: '5000',
    },
  });

  client = new Client({ name: 'mindlm-e2e', version: '0.0.0' });
  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  await client?.close();
  await page?.close();
  await rm(directory, { recursive: true, force: true });
});

describe('tools/list', () => {
  it('returns exactly the four tools, in the documented order', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      'text_to_mindmap',
      'url_to_mindmap',
      'pdf_to_mindmap',
      'export_mindmap',
    ]);
  });

  it('describes each input schema and annotates the behaviour', async () => {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.type).toBe('object');
    }

    expect(byName.get('text_to_mindmap')?.inputSchema.required).toContain('text');
    expect(byName.get('url_to_mindmap')?.annotations).toMatchObject({
      readOnlyHint: true,
      openWorldHint: true,
    });
    expect(byName.get('pdf_to_mindmap')?.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.get('export_mindmap')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
  });
});

describe('text_to_mindmap', () => {
  it('returns a client-mode draft with source text and instructions', async () => {
    const result = await client.callTool({
      name: 'text_to_mindmap',
      arguments: {
        text: '# Tides\n\nSpring tides are the largest.\n\n## Neap\n\nNeap tides are the smallest.\n',
      },
    });

    expect(result.isError).toBeFalsy();
    const data = structured(result);
    expect(data.mode).toBe('client');
    expect(String(data.markdown)).toMatch(/^# Tides/);
    expect(String(data.instructions)).toContain('export_mindmap');
    expect(String(data.sourceText)).toContain('Neap tides are the smallest.');
    expect(data.stats).toMatchObject({ truncated: false });

    // The text half must be usable on its own: some clients show only that.
    expect(textOf(result)).toContain('mode: client');
    expect(textOf(result)).toContain('DRAFT OUTLINE');
  });

  it('honours an explicit heuristic mode and can export in the same call', async () => {
    const result = await client.callTool({
      name: 'text_to_mindmap',
      arguments: {
        text: '# Rivers\n\n## Source\n\nA spring in the hills.\n\n## Mouth\n\nA delta.\n',
        mode: 'heuristic',
        maxDepth: 3,
        export: true,
      },
    });

    const data = structured(result);
    expect(data.mode).toBe('heuristic');
    expect(data.sourceText).toBeUndefined();
    expect(String(data.htmlPath)).toMatch(/\.html$/);
    expect((await readFile(String(data.htmlPath), 'utf8')).length).toBeGreaterThan(100_000);
  });

  it('reports a bad argument as an error result rather than crashing', async () => {
    const result = await client.callTool({
      name: 'text_to_mindmap',
      arguments: { text: 'hello', maxDepth: 99 },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/maxDepth|less than or equal/i);
  });
});

describe('url_to_mindmap', () => {
  it('fetches a local page and reports where it came from', async () => {
    const result = await client.callTool({
      name: 'url_to_mindmap',
      arguments: { url: page.url('/tides'), mode: 'heuristic' },
    });

    expect(result.isError).toBeFalsy();
    const data = structured(result);
    expect(data.title).toBe('Tide tables');
    expect(String(data.markdown)).toContain('Neap tides');
    expect(data.source).toMatchObject({ contentType: 'text/html' });
  });

  it('returns an error result for an unreachable host', async () => {
    const result = await client.callTool({
      name: 'url_to_mindmap',
      arguments: { url: 'http://127.0.0.1:1/nothing' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/could not fetch/i);
  });
});

describe('pdf_to_mindmap', () => {
  it('reads the committed fixture', async () => {
    const result = await client.callTool({
      name: 'pdf_to_mindmap',
      arguments: { path: join(ROOT, 'test/fixtures/sample.pdf'), mode: 'heuristic' },
    });

    expect(result.isError).toBeFalsy();
    const data = structured(result);
    expect(String(data.markdown)).toMatch(/^# /);
    expect(data.source).toMatchObject({ totalPages: expect.any(Number) });
    expect((data.stats as { nodes: number }).nodes).toBeGreaterThan(1);
  });

  it('explains a missing file instead of throwing', async () => {
    const result = await client.callTool({
      name: 'pdf_to_mindmap',
      arguments: { path: join(directory, 'missing.pdf') },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('No such file');
  });
});

describe('export_mindmap', () => {
  it('writes a standalone file into the configured output directory', async () => {
    const result = await client.callTool({
      name: 'export_mindmap',
      arguments: { markdown: '# Tides\n\n## Spring\n\n## Neap\n', title: 'Tides' },
    });

    expect(result.isError).toBeFalsy();
    const data = structured(result);
    expect(String(data.path).startsWith(directory)).toBe(true);
    expect(data.offline).toBe(true);
    expect(data.nodes).toBe(3);
    expect(data.html).toBeUndefined();

    const html = await readFile(String(data.path), 'utf8');
    expect(html).toContain('<title>Tides</title>');
    expect(html).not.toMatch(/<script[^>]+src="https?:/);
  });

  it('returns the HTML inline on request and refuses to clobber a file', async () => {
    const path = join(directory, 'explicit.html');
    const first = await client.callTool({
      name: 'export_mindmap',
      arguments: { markdown: '# One\n\n## Two\n', outputPath: path, returnHtml: true },
    });
    expect(String(structured(first).html)).toContain('<title>One</title>');

    const second = await client.callTool({
      name: 'export_mindmap',
      arguments: { markdown: '# One\n\n## Two\n', outputPath: path },
    });
    expect(second.isError).toBe(true);
    expect(textOf(second)).toContain('already exists');

    const third = await client.callTool({
      name: 'export_mindmap',
      arguments: { markdown: '# One\n\n## Two\n', outputPath: path, overwrite: true },
    });
    expect(third.isError).toBeFalsy();
  });
});

describe('prompts', () => {
  it('offers the outline rules as a prompt', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toContain('mindmap_outline');

    const prompt = await client.getPrompt({
      name: 'mindmap_outline',
      arguments: { language: '中文' },
    });
    const text = prompt.messages
      .map((message) => (message.content.type === 'text' ? message.content.text : ''))
      .join('\n');
    expect(text).toContain('Write every node in 中文.');
    expect(text).toContain('export_mindmap');
  });
});
