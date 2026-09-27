/**
 * Anthropic Messages API over native fetch — no SDK. One non-streaming call,
 * system prompt separate from the user turn, text blocks concatenated.
 */

import { LLM_MAX_OUTPUT_TOKENS, type LlmConfig, llmError } from './config.js';
import { postJson, transportOptions } from './http.js';
import type { CompletionOptions } from './types.js';

/** Pinned; Anthropic requires the header and treats it as the API contract. */
export const ANTHROPIC_VERSION = '2023-06-01';

export async function completeWithAnthropic(
  config: LlmConfig,
  options: CompletionOptions,
): Promise<string> {
  const payload = await postJson({
    url: `${config.baseUrl}/v1/messages`,
    provider: 'anthropic',
    headers: {
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: {
      model: config.model,
      max_tokens: options.maxTokens ?? LLM_MAX_OUTPUT_TOKENS,
      temperature: options.temperature ?? 0.2,
      system: options.system,
      messages: [{ role: 'user', content: options.user }],
    },
    ...transportOptions(options),
  });

  return readText(payload);
}

/** Pulls the text out of `content: [{ type: 'text', text }]`, ignoring other blocks. */
export function readText(payload: unknown): string {
  const content = (payload as { content?: unknown })?.content;
  if (!Array.isArray(content)) {
    throw llmError('Anthropic returned a message with no content array.');
  }

  const text = content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string',
    )
    .map((block) => block.text)
    .join('')
    .trim();

  if (text === '') throw llmError('Anthropic returned an empty message.');
  return text;
}
