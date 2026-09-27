/** Shared shape of a single completion call, provider-independent. */
export interface CompletionOptions {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}
