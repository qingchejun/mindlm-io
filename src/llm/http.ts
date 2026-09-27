/**
 * The one place an LLM HTTP request is made. Both providers share the timeout,
 * the retry policy and — importantly — the error formatting, which quotes the
 * response body but never the request headers.
 */

import {
  llmError,
  MAX_RETRIES,
  type Provider,
  REQUEST_TIMEOUT_MS,
  RETRY_BASE_DELAY_MS,
} from './config.js';
import type { CompletionOptions } from './types.js';

export interface LlmRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  provider: Provider;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  /** Delay before the first retry; doubles after that. Tests set it to 0. */
  retryDelayMs?: number;
}

/** The transport knobs a caller may override, lifted off a completion request. */
export function transportOptions(
  options: CompletionOptions,
): Pick<LlmRequest, 'fetchImpl' | 'timeoutMs' | 'maxRetries' | 'retryDelayMs'> {
  return {
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    ...(options.retryDelayMs === undefined ? {} : { retryDelayMs: options.retryDelayMs }),
  };
}

/** 429 and 5xx are worth retrying; a 400 or a 401 will fail the same way twice. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * POSTs JSON and returns the parsed response. Throws a `MindlmError` with code
 * `llm` on any failure, including a non-2xx status after the retries are spent.
 */
export async function postJson(request: LlmRequest): Promise<unknown> {
  const doFetch = request.fetchImpl ?? fetch;
  const timeoutMs = request.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxRetries = request.maxRetries ?? MAX_RETRIES;
  const baseDelay = request.retryDelayMs ?? RETRY_BASE_DELAY_MS;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    // A fresh budget per attempt: a retry after a timeout needs its own clock.
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;

    try {
      response = await doFetch(request.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...request.headers },
        body: JSON.stringify(request.body),
        signal,
      });
    } catch (cause) {
      lastError = llmError(
        signal.aborted
          ? `${request.provider} request timed out after ${timeoutMs}ms.`
          : `Could not reach the ${request.provider} endpoint: ${messageOf(cause)}`,
        undefined,
        cause,
      );
      if (attempt < maxRetries) {
        await delay(baseDelay * 2 ** attempt);
        continue;
      }
      throw lastError;
    }

    if (response.ok) {
      try {
        return await response.json();
      } catch (cause) {
        throw llmError(
          `${request.provider} returned a response that is not JSON.`,
          undefined,
          cause,
        );
      }
    }

    const detail = await readErrorBody(response);
    lastError = llmError(
      `${request.provider} returned HTTP ${response.status}${detail ? `: ${detail}` : '.'}`,
      response.status === 401 || response.status === 403
        ? 'Check that the configured API key is valid and has access to the model.'
        : undefined,
    );

    if (isRetryableStatus(response.status) && attempt < maxRetries) {
      await delay(retryDelay(response, baseDelay * 2 ** attempt));
      continue;
    }
    throw lastError;
  }

  /* c8 ignore next -- the loop always returns or throws */
  throw lastError ?? llmError(`The ${request.provider} request failed.`);
}

/** Honours a sane `retry-after`; ignores anything absurd so a header cannot stall us. */
function retryDelay(response: Response, fallbackMs: number): number {
  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number.parseFloat(header);
    if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 30) return seconds * 1000;
  }
  return fallbackMs;
}

/** Truncated so a long HTML error page cannot flood a tool result. */
async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim().replace(/\s+/g, ' ');
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
  } catch {
    return '';
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function delay(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}
