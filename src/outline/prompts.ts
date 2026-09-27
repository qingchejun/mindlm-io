/**
 * The outline rules, written once. Three consumers share them: the `llm` mode
 * prompt, the `client` mode instructions handed back to the caller's model, and
 * the optional `mindmap_outline` MCP prompt. Keeping one source means a client
 * model and a server-side model are asked for exactly the same shape.
 */

import { DEFAULT_MAX_CHILDREN, DEFAULT_MAX_DEPTH } from './normalize.js';

export interface OutlineRuleOptions {
  maxDepth?: number;
  maxChildren?: number;
  /** Natural language for the node labels; undefined means "follow the source". */
  language?: string;
}

export function languageRule(language: string | undefined): string {
  return language && language.trim() !== ''
    ? `Write every node in ${language.trim()}.`
    : 'Write the outline in the same language as the source text.';
}

/** The numbered rules an outline must satisfy, as plain prose. */
export function outlineRules(options: OutlineRuleOptions = {}): string {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxChildren = options.maxChildren ?? DEFAULT_MAX_CHILDREN;

  return [
    '1. Output Markdown only — no prose before or after it, no code fences.',
    '2. Exactly one `# ` line, the root. It names the whole document.',
    '3. Use `## ` for level 2 and `### ` for level 3; use `-` bullets, indented two spaces per level, for anything deeper.',
    `4. At most ${maxDepth} levels including the root, and at most ${maxChildren} children under any one node.`,
    '5. Nodes are labels, not sentences: aim for under 12 words (or 40 characters in Chinese/Japanese/Korean) and drop trailing punctuation.',
    '6. Keep the order and the hierarchy of the source. Merge repetition, drop navigation, boilerplate and page furniture.',
    '7. Keep concrete specifics — names, numbers, dates, conclusions — in preference to generic headings like "Introduction".',
    `8. ${languageRule(options.language)}`,
  ].join('\n');
}

export const SYSTEM_PROMPT =
  'You turn documents into mind-map outlines in Markdown. You reply with the outline and nothing else.';

export interface OutlinePromptInput extends OutlineRuleOptions {
  /** The deterministic outline, offered as a starting point. */
  draft: string;
  /** Cleaned source material, already truncated by the caller. */
  sourceText: string;
  title?: string;
  /** True when `sourceText` was cut short. */
  truncated?: boolean;
}

/** The user message for `llm` mode. */
export function buildOutlinePrompt(input: OutlinePromptInput): string {
  return [
    'Rewrite the draft outline below into the best mind map you can make of the source text.',
    '',
    outlineRules(input),
    ...(input.title ? ['', `Suggested root title: ${input.title}`] : []),
    '',
    '--- DRAFT OUTLINE ---',
    input.draft,
    '',
    `--- SOURCE TEXT${input.truncated ? ' (truncated)' : ''} ---`,
    input.sourceText,
    '--- END ---',
  ].join('\n');
}
