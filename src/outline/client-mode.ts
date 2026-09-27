/**
 * Zero-key mode for MCP: instead of calling a model ourselves, hand the caller's
 * model everything it needs — a deterministic draft, the cleaned source text,
 * and instructions to rewrite the draft and render it with `export_mindmap`.
 */

import { clientMaxChars } from '../util/env.js';
import { blocksToText, type Document } from './blocks.js';
import { outlineRules } from './prompts.js';

export interface ClientModeOptions {
  maxDepth?: number;
  maxChildren?: number;
  language?: string;
  /** Overrides MINDMAP_CLIENT_MAX_CHARS; mainly a test seam. */
  maxChars?: number;
}

export interface ClientModePayload {
  /** Source material for the client model, truncated to the character budget. */
  sourceText: string;
  /** True when `sourceText` is shorter than the document. */
  sourceTruncated: boolean;
  instructions: string;
}

/**
 * Truncates on a paragraph boundary when there is one nearby, so the material
 * does not end mid-sentence. Falls back to a hard cut.
 */
export function truncateSource(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const paragraph = cut.lastIndexOf('\n\n');
  return paragraph > limit * 0.6 ? cut.slice(0, paragraph) : cut;
}

export function buildClientInstructions(
  options: ClientModeOptions & { truncated: boolean },
): string {
  return [
    'This is a DRAFT outline produced by a rule-based algorithm. Do not show it to the user as the final result.',
    '',
    'Do this now, in order:',
    '',
    '1. Read `sourceText` and rewrite `markdown` into a better outline. Keep what the draft got right; fix what it got wrong.',
    '2. Follow these rules exactly:',
    '',
    indent(outlineRules(options), '   '),
    '',
    '3. Call the `export_mindmap` tool with your rewritten Markdown to render the mind map, then tell the user where the file is.',
    '',
    options.truncated
      ? 'Note: `sourceText` was truncated to fit. Outline what is there and say so if it matters.'
      : '',
    'Do not paste the whole outline into the chat unless the user asks — the exported HTML is the deliverable.',
  ]
    .filter((line, index, all) => !(line === '' && all[index - 1] === ''))
    .join('\n')
    .trim();
}

/** Builds the `client` mode extras that ride along with the common tool output. */
export function clientModePayload(
  document: Document,
  options: ClientModeOptions = {},
): ClientModePayload {
  const limit = options.maxChars ?? clientMaxChars();
  const full = blocksToText(document.blocks);
  const sourceText = truncateSource(full, limit);
  const sourceTruncated = sourceText.length < full.length || document.truncated;

  return {
    sourceText,
    sourceTruncated,
    instructions: buildClientInstructions({ ...options, truncated: sourceTruncated }),
  };
}

function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? line : prefix + line))
    .join('\n');
}
