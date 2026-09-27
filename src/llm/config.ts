/**
 * Turns environment variables (plus CLI overrides) into a concrete LLM call
 * configuration. The API key is read here and nowhere else; it is never logged,
 * never echoed into a tool result, and never stored on an object that gets
 * serialized.
 */

import { llmEnv } from '../util/env.js';
import { MindlmError, usageError } from '../util/errors.js';

export type Provider = 'anthropic' | 'openai';

/**
 * Anthropic ships a stable, documented model alias, so the tool works with a
 * key and nothing else. "openai" covers every OpenAI-compatible endpoint
 * (DeepSeek, Qwen, vLLM, a local gateway…) where no name is portable, so there
 * the model has to be named explicitly.
 */
export const DEFAULT_MODELS: Record<Provider, string | undefined> = {
  anthropic: 'claude-sonnet-5',
  openai: undefined,
};

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

/** Whole-call budget, per the plan. */
export const REQUEST_TIMEOUT_MS = 60_000;
/** Retries after the first attempt, for 429 and 5xx only. */
export const MAX_RETRIES = 2;
/** Doubles on each retry. */
export const RETRY_BASE_DELAY_MS = 500;

/** Rough ceiling on the source text a single call gets; the rest is truncated. */
export const LLM_MAX_SOURCE_CHARS = 24_000;
export const LLM_MAX_OUTPUT_TOKENS = 4_000;

export interface LlmConfig {
  provider: Provider;
  model: string;
  baseUrl: string;
  /** Kept out of `toJSON`-able shapes on purpose — see `describeConfig`. */
  apiKey: string;
}

export interface LlmOverrides {
  provider?: Provider;
  model?: string;
  baseUrl?: string;
}

/**
 * Resolves the configuration, or throws a usage error explaining exactly which
 * variable is missing. Never includes any part of a key in its messages.
 */
export function resolveLlmConfig(overrides: LlmOverrides = {}): LlmConfig {
  const env = llmEnv();
  const provider = overrides.provider ?? env.provider;

  if (provider === undefined) {
    throw usageError(
      'No LLM provider is configured.',
      'Set ANTHROPIC_API_KEY or OPENAI_API_KEY (and optionally MINDMAP_LLM_PROVIDER).',
    );
  }

  const apiKey = readKey(provider);
  if (apiKey === undefined) {
    throw usageError(
      `Provider "${provider}" is selected but ${keyName(provider)} is not set.`,
      'Set the key, or unset MINDMAP_LLM_PROVIDER to auto-detect from whichever key exists.',
    );
  }

  const model = overrides.model?.trim() || env.model || DEFAULT_MODELS[provider];
  if (!model) {
    throw usageError(
      'No model name is configured for an OpenAI-compatible endpoint.',
      'Set MINDMAP_LLM_MODEL (or pass --model), e.g. the model id your endpoint documents.',
    );
  }

  const baseUrl = (
    overrides.baseUrl?.trim() ||
    (provider === 'openai' ? env.baseUrl : undefined) ||
    defaultBaseUrl(provider)
  ).replace(/\/+$/, '');

  return { provider, model, baseUrl, apiKey };
}

function defaultBaseUrl(provider: Provider): string {
  return provider === 'anthropic' ? ANTHROPIC_BASE_URL : OPENAI_BASE_URL;
}

function keyName(provider: Provider): string {
  return provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
}

function readKey(provider: Provider): string | undefined {
  const raw = process.env[keyName(provider)]?.trim();
  return raw === undefined || raw === '' ? undefined : raw;
}

/** A safe one-liner for logs and `doctor` output: provider, model, host — no key. */
export function describeConfig(config: LlmConfig): string {
  return `${config.provider} · ${config.model} · ${hostOf(config.baseUrl)}`;
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export function llmError(message: string, hint?: string, cause?: unknown): MindlmError {
  return new MindlmError('llm', message, {
    ...(hint === undefined ? {} : { hint }),
    ...(cause === undefined ? {} : { cause }),
  });
}
