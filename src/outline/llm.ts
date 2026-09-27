/**
 * `llm` mode: one call to the configured provider, then the same normalization
 * every other mode goes through. A model that fails, stalls or returns
 * something unusable never breaks the request — the heuristic draft is always
 * there, and the reported mode says which one the caller actually got.
 */

import { completeWithAnthropic } from '../llm/anthropic.js';
import {
  LLM_MAX_SOURCE_CHARS,
  type LlmConfig,
  type LlmOverrides,
  resolveLlmConfig,
} from '../llm/config.js';
import { completeWithOpenAi } from '../llm/openai-compatible.js';
import type { CompletionOptions } from '../llm/types.js';
import { describeError } from '../util/errors.js';
import { blocksToText, type Document } from './blocks.js';
import { truncateSource } from './client-mode.js';
import { heuristicOutline } from './heuristic.js';
import {
  countNodes,
  normalizeOutline,
  type Outline,
  outlineToMarkdown,
  parseOutlineMarkdown,
} from './normalize.js';
import { buildOutlinePrompt, SYSTEM_PROMPT } from './prompts.js';

export interface LlmOutlineOptions extends LlmOverrides {
  title?: string;
  maxDepth?: number;
  maxChildren?: number;
  language?: string;
  /** Characters of source text sent to the model. Defaults to LLM_MAX_SOURCE_CHARS. */
  maxSourceChars?: number;
  /** Pre-resolved config; resolved from the environment when absent. */
  config?: LlmConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface LlmOutlineResult {
  outline: Outline;
  markdown: string;
  /** `llm` when the model's outline was used, `heuristic` when we fell back. */
  mode: 'llm' | 'heuristic';
  /** Why the fallback happened, phrased for a human. Never contains the key. */
  warning?: string;
}

/** A model reply this short is a refusal or an apology, not an outline. */
const MIN_NODES = 3;

export async function llmOutline(
  document: Document,
  options: LlmOutlineOptions = {},
): Promise<LlmOutlineResult> {
  const draft = heuristicOutline(document, options);
  const draftMarkdown = outlineToMarkdown(draft);

  try {
    const config = options.config ?? resolveLlmConfig(options);
    const full = blocksToText(document.blocks);
    const sourceText = truncateSource(full, options.maxSourceChars ?? LLM_MAX_SOURCE_CHARS);

    const reply = await complete(config, {
      system: SYSTEM_PROMPT,
      user: buildOutlinePrompt({
        draft: draftMarkdown,
        sourceText,
        title: options.title ?? draft.title,
        truncated: sourceText.length < full.length || document.truncated,
        ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
        ...(options.maxChildren === undefined ? {} : { maxChildren: options.maxChildren }),
        ...(options.language === undefined ? {} : { language: options.language }),
      }),
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
      ...(options.retryDelayMs === undefined ? {} : { retryDelayMs: options.retryDelayMs }),
    });

    const outline = normalizeOutline(
      parseOutlineMarkdown(stripCodeFence(reply), options.title ?? draft.title),
      {
        ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
        ...(options.maxChildren === undefined ? {} : { maxChildren: options.maxChildren }),
      },
    );

    if (countNodes(outline) < MIN_NODES) {
      return fallback(draft, draftMarkdown, 'the model returned too little to draw a map from');
    }
    // A model asked for a title usually honours it; when it does not, ours wins.
    const titled = options.title ? { ...outline, title: options.title } : outline;

    return { outline: titled, markdown: outlineToMarkdown(titled), mode: 'llm' };
  } catch (cause) {
    return fallback(draft, draftMarkdown, describeError(cause));
  }
}

function fallback(outline: Outline, markdown: string, reason: string): LlmOutlineResult {
  return {
    outline,
    markdown,
    mode: 'heuristic',
    warning: `Fell back to the heuristic outline: ${reason}`,
  };
}

function complete(config: LlmConfig, options: CompletionOptions): Promise<string> {
  return config.provider === 'anthropic'
    ? completeWithAnthropic(config, options)
    : completeWithOpenAi(config, options);
}

/**
 * Models wrap Markdown in ```` ```markdown ```` more often than they should.
 * Anything before the first fence (a "Here is your outline:" line) goes too.
 */
export function stripCodeFence(reply: string): string {
  const fenced = /```(?:[\w-]*)\n([\s\S]*?)```/.exec(reply);
  if (fenced?.[1]) return fenced[1].trim();

  const heading = reply.indexOf('\n# ');
  return (heading >= 0 ? reply.slice(heading + 1) : reply).trim();
}
