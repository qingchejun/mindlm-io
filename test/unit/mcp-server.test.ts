import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMindlmServer, TOOL_NAMES } from '../../src/mcp/server.js';

/**
 * In-process counterpart to `test/e2e/mcp-stdio.test.ts`: same server, no child
 * process, so the handlers are instrumented and a reordered registration is
 * caught here first.
 */
let client: Client;
let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mindlm-inmemory-'));
  process.env.MINDMAP_OUTPUT_DIR = directory;

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMindlmServer();
  client = new Client({ name: 'mindlm-unit', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  delete process.env.MINDMAP_OUTPUT_DIR;
  await client?.close();
  await rm(directory, { recursive: true, force: true });
});

const structured = (result: { structuredContent?: unknown }) =>
  result.structuredContent as Record<string, unknown>;

describe('tool registration', () => {
  it('advertises exactly TOOL_NAMES, in that order', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
  });
});

describe('text_to_mindmap', () => {
  it('writes into MINDMAP_OUTPUT_DIR when asked to export', async () => {
    const result = await client.callTool({
      name: 'text_to_mindmap',
      arguments: {
        text: '# Tides\n\n## Spring\n\nLargest range.\n\n## Neap\n\nSmallest range.\n',
        mode: 'heuristic',
        export: true,
      },
    });

    const data = structured(result);
    expect(String(data.htmlPath).startsWith(directory)).toBe(true);
    expect(await readFile(String(data.htmlPath), 'utf8')).toContain('<title>Tides</title>');
  });

  it('keeps the requested title and depth', async () => {
    const result = await client.callTool({
      name: 'text_to_mindmap',
      arguments: {
        text: '# Ignored\n\n## A\n\n### B\n\n#### C\n',
        mode: 'heuristic',
        title: 'Pinned',
        maxDepth: 2,
      },
    });

    const data = structured(result);
    expect(data.title).toBe('Pinned');
    expect(String(data.markdown)).not.toContain('### B');
    expect((data.stats as { depth: number }).depth).toBeLessThanOrEqual(2);
  });
});

describe('export_mindmap', () => {
  it('reports the file it wrote', async () => {
    const result = await client.callTool({
      name: 'export_mindmap',
      arguments: { markdown: '# Root\n\n## A\n', toolbar: false, initialExpandLevel: 1 },
    });

    const data = structured(result);
    expect(data.nodes).toBe(2);
    expect(String(data.fileUrl).startsWith('file://')).toBe(true);

    const html = await readFile(String(data.path), 'utf8');
    expect(html).toContain('{"initialExpandLevel":1}');
    expect(html).not.toContain('markmap-toolbar');
  });
});
