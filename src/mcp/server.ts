/**
 * The MCP server: four tools, registered in a fixed order because `tools/list`
 * returns them in registration order and the spec asks servers to keep that
 * stable.
 *
 * Two rules hold for every handler here: nothing is written to stdout (it
 * carries the protocol), and nothing throws — a failure comes back as an
 * `isError` result the model can read and act on.
 */

import type { CallToolResult } from '@modelcontextprotocol/server';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { pdfBytesToDocument, pdfFileToDocument } from '../extract/pdf.js';
import { textToDocument } from '../extract/text.js';
import { fetchUrlDocument } from '../extract/url.js';
import type { Document } from '../outline/blocks.js';
import { type GeneratedOutline, generateOutline } from '../outline/generate.js';
import { outlineRules } from '../outline/prompts.js';
import { exportMindmap } from '../render/export.js';
import { describeError } from '../util/errors.js';
import { VERSION } from '../util/version.js';
import {
  type ExportInput,
  exportInputSchema,
  pdfInputSchema,
  textInputSchema,
  urlInputSchema,
} from './schemas.js';

/** The advertised order. `test/e2e/mcp-stdio.test.ts` asserts it. */
export const TOOL_NAMES = [
  'text_to_mindmap',
  'url_to_mindmap',
  'pdf_to_mindmap',
  'export_mindmap',
] as const;

const SERVER_INSTRUCTIONS = [
  'mindlm-mcp turns text, web pages and PDFs into mind maps.',
  '',
  'The usual flow: call one of text_to_mindmap / url_to_mindmap / pdf_to_mindmap, read the',
  '`mode` field in the result, then call export_mindmap to render a standalone HTML file.',
  '',
  'When `mode` is "client" the result also carries `sourceText` and `instructions`: the outline',
  'you got is a rule-based draft, and you are expected to rewrite it before exporting.',
  'When `mode` is "llm" or "heuristic" the outline is ready to export as it stands.',
].join('\n');

/** Shared by the three outline tools; a subset of each tool's parsed input. */
interface CommonArgs {
  mode?: 'auto' | 'client' | 'llm' | 'heuristic';
  title?: string;
  maxDepth?: number;
  maxChildren?: number;
  language?: string;
  export?: boolean;
  outputPath?: string;
}

export function createMindlmServer(): McpServer {
  const server = new McpServer(
    { name: 'mindlm-mcp', title: 'mindlm-mcp', version: VERSION },
    { capabilities: { tools: {}, prompts: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    'text_to_mindmap',
    {
      title: 'Text to mind map',
      description:
        'Turn text or Markdown into a mind-map outline. Use this for content you already have — ' +
        'a draft, notes, a transcript, a chunk of a document. Returns a Markdown outline; pass ' +
        'export: true, or call export_mindmap afterwards, to get an HTML file.',
      inputSchema: textInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      return guard(async () => {
        const document = textToDocument(
          args.text,
          args.title === undefined ? {} : { title: args.title },
        );
        return await outlineResult(document, args, {});
      });
    },
  );

  server.registerTool(
    'url_to_mindmap',
    {
      title: 'URL to mind map',
      description:
        'Fetch an http(s) page (or a PDF served over http) and turn its main content into a ' +
        'mind-map outline. Article text is extracted with Readability; navigation and boilerplate ' +
        'are dropped. Pages that render entirely in JavaScript will come back empty — paste the ' +
        'text into text_to_mindmap instead.',
      inputSchema: urlInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      return guard(async () => {
        const fetched = await fetchUrlDocument(args.url);
        if (fetched.kind === 'pdf') {
          const pdf = await pdfBytesToDocument(fetched.bytes, { label: fetched.source.finalUrl });
          return await outlineResult(pdf.document, args, {
            source: { ...fetched.source, totalPages: pdf.source.totalPages },
          });
        }
        return await outlineResult(fetched.document, args, { source: fetched.source });
      });
    },
  );

  server.registerTool(
    'pdf_to_mindmap',
    {
      title: 'PDF to mind map',
      description:
        'Read a local PDF and turn it into a mind-map outline, using its bookmarks as the skeleton ' +
        'when it has them. Scanned PDFs with no text layer are rejected — there is no OCR. Use ' +
        'pages to limit long documents.',
      inputSchema: pdfInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      return guard(async () => {
        const result = await pdfFileToDocument(args.path, {
          ...(args.pages === undefined ? {} : { pages: args.pages }),
        });
        return await outlineResult(result.document, args, { source: result.source });
      });
    },
  );

  server.registerTool(
    'export_mindmap',
    {
      title: 'Export a mind map',
      description:
        'Render a Markdown outline into a standalone HTML mind map — interactive, single file, no ' +
        'network needed. Call this after you have written or refined an outline. Returns the file ' +
        'path; it does not overwrite an existing file unless you ask it to.',
      inputSchema: exportInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => guard(() => exportResult(args)),
  );

  server.registerPrompt(
    'mindmap_outline',
    {
      title: 'Mind map outline rules',
      description: 'The rules an outline must follow before export_mindmap renders it.',
      argsSchema: z.object({
        language: z.string().max(40).optional().describe('Language for the node labels.'),
      }),
    },
    (args) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              'Write a mind-map outline in Markdown, following these rules:',
              '',
              outlineRules({
                ...(args.language === undefined ? {} : { language: args.language }),
              }),
              '',
              'Then call the export_mindmap tool with the outline.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  return server;
}

async function outlineResult(
  document: Document,
  args: CommonArgs,
  extra: Record<string, unknown>,
): Promise<CallToolResult> {
  const generated = await generateOutline(document, 'mcp', args);

  let exported: { htmlPath: string; fileUrl: string } | undefined;
  if (args.export) {
    const written = await exportMindmap({
      markdown: generated.markdown,
      title: generated.title,
      ...(args.outputPath === undefined ? {} : { outputPath: args.outputPath }),
    });
    exported = { htmlPath: written.path, fileUrl: written.fileUrl };
  }

  const structuredContent = {
    title: generated.title,
    markdown: generated.markdown,
    mode: generated.mode,
    stats: generated.stats,
    ...(generated.warning === undefined ? {} : { warning: generated.warning }),
    ...(generated.sourceText === undefined ? {} : { sourceText: generated.sourceText }),
    ...(generated.instructions === undefined ? {} : { instructions: generated.instructions }),
    ...(exported === undefined ? {} : exported),
    ...extra,
  };

  return {
    content: [{ type: 'text', text: outlineText(generated, exported) }],
    structuredContent,
  };
}

/**
 * The human-readable half of the result. In `client` mode it carries the whole
 * working set — instructions, draft, source — because many clients show the
 * model the text content and nothing else.
 */
function outlineText(
  generated: GeneratedOutline,
  exported: { htmlPath: string } | undefined,
): string {
  const header = [
    `mode: ${generated.mode}`,
    `${generated.stats.nodes} nodes`,
    `depth ${generated.stats.depth}`,
    `${generated.stats.inputChars} source characters${generated.stats.truncated ? ' (truncated)' : ''}`,
  ].join(' · ');

  const parts = [header];
  if (generated.warning) parts.push(`warning: ${generated.warning}`);
  if (exported) parts.push(`exported: ${exported.htmlPath}`);

  if (generated.mode === 'client' && generated.instructions) {
    parts.push('', generated.instructions);
    parts.push('', '--- DRAFT OUTLINE ---', generated.markdown.trim());
    parts.push('', '--- SOURCE TEXT ---', generated.sourceText ?? '', '--- END ---');
  } else {
    parts.push('', generated.markdown.trim());
  }

  return parts.join('\n');
}

async function exportResult(args: ExportInput): Promise<CallToolResult> {
  const written = await exportMindmap({
    markdown: args.markdown,
    ...(args.title === undefined ? {} : { title: args.title }),
    ...(args.outputPath === undefined ? {} : { outputPath: args.outputPath }),
    ...(args.offline === undefined ? {} : { offline: args.offline }),
    ...(args.toolbar === undefined ? {} : { toolbar: args.toolbar }),
    ...(args.branding === undefined ? {} : { branding: args.branding }),
    ...(args.initialExpandLevel === undefined
      ? {}
      : { initialExpandLevel: args.initialExpandLevel }),
    ...(args.colorFreezeLevel === undefined ? {} : { colorFreezeLevel: args.colorFreezeLevel }),
    ...(args.maxWidth === undefined ? {} : { maxWidth: args.maxWidth }),
    overwrite: args.overwrite ?? false,
  });

  const structuredContent = {
    path: written.path,
    fileUrl: written.fileUrl,
    bytes: written.bytes,
    nodes: written.nodes,
    offline: written.offline,
    ...(args.returnHtml ? { html: written.html } : {}),
  };

  const summary = [
    `Wrote ${written.path}`,
    `${written.nodes} nodes · ${Math.round(written.bytes / 1024)} KB · ${
      written.offline ? 'offline single file' : 'CDN assets'
    }`,
    `Open it with: ${written.fileUrl}`,
  ].join('\n');

  return { content: [{ type: 'text', text: summary }], structuredContent };
}

/** Turns any failure into an `isError` result. Tool handlers never throw. */
async function guard(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text', text: describeError(error) }],
    };
  }
}
