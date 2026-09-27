/**
 * Tool input schemas. Zod v4, which the MCP server package converts into the
 * JSON Schema advertised by `tools/list`, so every `.describe()` here is read by
 * the model choosing the call.
 */

import { z } from 'zod';
import { DEFAULT_MAX_CHILDREN, DEFAULT_MAX_DEPTH } from '../outline/normalize.js';

/** Shared by the three `*_to_mindmap` tools. */
export const commonOptions = {
  mode: z
    .enum(['auto', 'client', 'llm', 'heuristic'])
    .optional()
    .describe(
      'auto (default): use a configured API key if there is one, otherwise "client". ' +
        'client: get a draft plus the source text back and write the outline yourself. ' +
        'llm: the server calls the model configured by ANTHROPIC_API_KEY / OPENAI_API_KEY. ' +
        'heuristic: rule-based only, no model.',
    ),
  title: z
    .string()
    .max(200)
    .optional()
    .describe('Root node title. Derived from the source if omitted.'),
  maxDepth: z
    .int()
    .min(2)
    .max(6)
    .optional()
    .describe(`Levels including the root (default ${DEFAULT_MAX_DEPTH}).`),
  maxChildren: z
    .int()
    .min(3)
    .max(15)
    .optional()
    .describe(
      `Children kept per node before the rest collapse into "…(+N)" (default ${DEFAULT_MAX_CHILDREN}).`,
    ),
  language: z
    .string()
    .max(40)
    .optional()
    .describe(
      'Language for the node labels, e.g. "English" or "中文". Defaults to the source language.',
    ),
  export: z
    .boolean()
    .optional()
    .describe('Also render the outline to a standalone HTML file and return its path.'),
  outputPath: z
    .string()
    .optional()
    .describe(
      'Where to write the HTML when export is true. A directory gets a generated file name. ' +
        'Defaults to $MINDMAP_OUTPUT_DIR or ./mindmaps/.',
    ),
} as const;

export const textInputSchema = z.object({
  text: z
    .string()
    .min(1)
    .describe('The text or Markdown to map. Capped by MINDMAP_MAX_INPUT_CHARS (200k by default).'),
  ...commonOptions,
});

export const urlInputSchema = z.object({
  url: z
    .url()
    .describe(
      'An http(s) page or PDF. Server-rendered pages only — a JS-only SPA will come back empty.',
    ),
  ...commonOptions,
});

export const pdfInputSchema = z.object({
  path: z.string().min(1).describe('Path to a local PDF file. "~" is expanded.'),
  pages: z
    .string()
    .optional()
    .describe('Page selection, 1-based, e.g. "1-20", "3" or "1-5,9". All pages by default.'),
  ...commonOptions,
});

export const exportInputSchema = z.object({
  markdown: z
    .string()
    .min(1)
    .describe('The Markdown outline to render: one "# " root, "##"/"###", then "-" bullets.'),
  title: z.string().max(200).optional().describe('Page title. Defaults to the outline root.'),
  outputPath: z
    .string()
    .optional()
    .describe('Output file or directory. Defaults to $MINDMAP_OUTPUT_DIR or ./mindmaps/.'),
  offline: z
    .boolean()
    .optional()
    .describe('Inline every script so the file works with no network (default true).'),
  toolbar: z.boolean().optional().describe('Show the zoom / fit / expand toolbar (default true).'),
  initialExpandLevel: z
    .int()
    .min(-1)
    .max(6)
    .optional()
    .describe('Levels expanded on open; -1 expands everything.'),
  colorFreezeLevel: z
    .int()
    .min(0)
    .max(6)
    .optional()
    .describe('Stop changing branch colour below this level.'),
  maxWidth: z
    .int()
    .min(0)
    .max(2000)
    .optional()
    .describe('Maximum node width in pixels; 0 means unlimited.'),
  overwrite: z
    .boolean()
    .optional()
    .describe('Replace the file if it already exists (default false).'),
  returnHtml: z
    .boolean()
    .optional()
    .describe('Include the full HTML in the result. Only useful for small maps (default false).'),
  branding: z
    .boolean()
    .optional()
    .describe('Add a small "Made with mindlm-mcp" footer link (default false).'),
});

export type TextInput = z.infer<typeof textInputSchema>;
export type UrlInput = z.infer<typeof urlInputSchema>;
export type PdfInput = z.infer<typeof pdfInputSchema>;
export type ExportInput = z.infer<typeof exportInputSchema>;
