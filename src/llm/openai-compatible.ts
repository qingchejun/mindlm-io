/**
 * Chat Completions over native fetch. Written against the OpenAI-compatible
 * shape rather than OpenAI itself, so any endpoint that speaks
 * `POST {base}/chat/completions` works by setting OPENAI_BASE_URL.
 */

import { LLM_MAX_OUTPUT_TOKENS, type LlmConfig, llmError } from './config.js';
import { postJson, transportOptions } from './http.js';
import type { CompletionOptions } from './types.js';

export async function completeWithOpenAi(
  config: LlmConfig,
  options: CompletionOptions,
): Promise<string> {
  const payload = await postJson({
    url: `${config.baseUrl}/chat/completions`,
    provider: 'openai',
    headers: { authorization: `Bearer ${config.apiKey}` },
    body: {
      model: config.model,
      max_tokens: options.maxTokens ?? LLM_MAX_OUTPUT_TOKENS,
      temperature: options.temperature ?? 0.2,
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.user },
      ],
    },
    ...transportOptions(options),
  });

  return readText(payload);
}

/** Reads `choices[0].message.content`, tolerating the array-of-parts variant. */
export function readText(payload: unknown): string {
  const choices = (payload as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw llmError('The endpoint returned no completion choices.');
  }

  const content = (choices[0] as { message?: { content?: unknown } })?.message?.content;
  const text = (typeof content === 'string' ? content : joinParts(content)).trim();

  if (text === '') throw llmError('The endpoint returned an empty completion.');
  return text;
}

function joinParts(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((part) =>
      typeof part === 'object' &&
      part !== null &&
      typeof (part as { text?: unknown }).text === 'string'
        ? (part as { text: string }).text
        : '',
    )
    .join('');
}
