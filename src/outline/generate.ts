/**
 * The one pipeline both front ends call: document in, outline plus an honest
 * `mode` out. The MCP server and the CLI differ only in the `surface` they pass
 * and in how they present the result.
 */

import type { LlmOverrides } from '../llm/config.js';
import { countChars, type Document } from './blocks.js';
import { clientModePayload } from './client-mode.js';
import { heuristicOutline } from './heuristic.js';
import { llmOutline } from './llm.js';
import { type OutlineMode, type RequestedMode, resolveMode, type Surface } from './mode.js';
import { countNodes, type Outline, outlineDepth, outlineToMarkdown } from './normalize.js';

export interface OutlineStats {
  inputChars: number;
  nodes: number;
  depth: number;
  /** True when a size limit cut the source short. */
  truncated: boolean;
}

export function outlineStats(document: Document, outline: Outline): OutlineStats {
  return {
    inputChars: countChars(document.blocks),
    nodes: countNodes(outline),
    depth: outlineDepth(outline),
    truncated: document.truncated,
  };
}

export interface GenerateOptions extends LlmOverrides {
  mode?: RequestedMode;
  title?: string;
  maxDepth?: number;
  maxChildren?: number;
  language?: string;
  /** Test seams, passed straight through to the LLM transport. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  /** Overrides MINDMAP_CLIENT_MAX_CHARS in `client` mode. */
  clientMaxChars?: number;
}

export interface GeneratedOutline {
  title: string;
  /** Always a renderable Markdown outline, whichever mode ran. */
  markdown: string;
  outline: Outline;
  stats: OutlineStats;
  /** The mode that actually produced `markdown`, not the one that was asked for. */
  mode: OutlineMode;
  /** Set when a requested mode degraded, e.g. the model call failed. */
  warning?: string;
  /** `client` mode only: material for the caller's model. */
  sourceText?: string;
  /** `client` mode only: what the caller's model should do next. */
  instructions?: string;
}

export async function generateOutline(
  document: Document,
  surface: Surface,
  options: GenerateOptions = {},
): Promise<GeneratedOutline> {
  const mode = resolveMode(options.mode, surface);

  if (mode === 'llm') {
    const result = await llmOutline(document, options);
    return {
      title: result.outline.title,
      markdown: result.markdown,
      outline: result.outline,
      stats: outlineStats(document, result.outline),
      mode: result.mode,
      ...(result.warning === undefined ? {} : { warning: result.warning }),
    };
  }

  const outline = heuristicOutline(document, options);
  const base = {
    title: outline.title,
    markdown: outlineToMarkdown(outline),
    outline,
    stats: outlineStats(document, outline),
  };

  if (mode === 'heuristic') return { ...base, mode };

  const payload = clientModePayload(document, {
    ...options,
    ...(options.clientMaxChars === undefined ? {} : { maxChars: options.clientMaxChars }),
  });
  return {
    ...base,
    mode,
    sourceText: payload.sourceText,
    instructions: payload.instructions,
  };
}
