/**
 * Every setting is optional and read lazily from `process.env`, so tests can
 * flip a variable between cases without reloading the module.
 */

export const DEFAULTS = {
  maxInputChars: 200_000,
  clientMaxChars: 60_000,
  outputDir: 'mindmaps',
  /** Hard ceiling on a fetched response body. */
  urlMaxBytes: 5 * 1024 * 1024,
  /** Whole-request timeout for a URL fetch. */
  urlTimeoutMs: 15_000,
  urlMaxRedirects: 5,
  pdfMaxBytes: 50 * 1024 * 1024,
  pdfMaxPages: 300,
} as const;

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBool(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

export function maxInputChars(): number {
  return readInt('MINDMAP_MAX_INPUT_CHARS', DEFAULTS.maxInputChars);
}

export function clientMaxChars(): number {
  return readInt('MINDMAP_CLIENT_MAX_CHARS', DEFAULTS.clientMaxChars);
}

export function allowPrivateHosts(): boolean {
  return readBool('MINDMAP_ALLOW_PRIVATE_HOSTS');
}

export function outputDir(): string {
  const raw = process.env.MINDMAP_OUTPUT_DIR;
  return raw && raw.trim() !== '' ? raw.trim() : DEFAULTS.outputDir;
}

export interface LlmEnv {
  provider: 'anthropic' | 'openai' | undefined;
  hasKey: boolean;
  baseUrl: string | undefined;
  model: string | undefined;
}

/**
 * Reports *whether* an LLM is configured and which provider to use. It never
 * returns the key itself — callers that need it read the variable directly, so
 * the value cannot accidentally end up in a log line or a tool response.
 */
export function llmEnv(): LlmEnv {
  const explicit = process.env.MINDMAP_LLM_PROVIDER?.trim().toLowerCase();
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const hasOpenai = Boolean(process.env.OPENAI_API_KEY?.trim());

  let provider: 'anthropic' | 'openai' | undefined;
  if (explicit === 'anthropic' || explicit === 'openai') {
    provider = explicit;
  } else if (hasAnthropic) {
    provider = 'anthropic';
  } else if (hasOpenai) {
    provider = 'openai';
  }

  const hasKey =
    provider === 'anthropic' ? hasAnthropic : provider === 'openai' ? hasOpenai : false;

  return {
    provider,
    hasKey,
    baseUrl: process.env.OPENAI_BASE_URL?.trim() || undefined,
    model: process.env.MINDMAP_LLM_MODEL?.trim() || undefined,
  };
}
