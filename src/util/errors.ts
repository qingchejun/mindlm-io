/**
 * Error codes are stable strings: the CLI maps them to exit codes and the MCP
 * server surfaces them to the client, so renaming one is a breaking change.
 */
export type MindlmErrorCode =
  /** Bad arguments / unusable option combination. */
  | 'usage'
  /** The input itself could not be turned into content (fetch failed, no text layer, …). */
  | 'input'
  /** An LLM call failed after retries. */
  | 'llm'
  /** Something went wrong while writing the output. */
  | 'output';

/** Exit codes from the plan: 0 ok, 1 usage, 2 input, 3 LLM. */
const EXIT_CODES: Record<MindlmErrorCode, number> = {
  usage: 1,
  input: 2,
  llm: 3,
  output: 2,
};

export class MindlmError extends Error {
  readonly code: MindlmErrorCode;
  /** Extra lines printed after the message — hints, not stack traces. */
  readonly hint: string | undefined;

  constructor(
    code: MindlmErrorCode,
    message: string,
    options: { hint?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'MindlmError';
    this.code = code;
    this.hint = options.hint;
  }

  get exitCode(): number {
    return EXIT_CODES[this.code];
  }
}

export function usageError(message: string, hint?: string): MindlmError {
  return new MindlmError('usage', message, hint === undefined ? {} : { hint });
}

export function inputError(message: string, hint?: string): MindlmError {
  return new MindlmError('input', message, hint === undefined ? {} : { hint });
}

export function outputError(message: string, hint?: string): MindlmError {
  return new MindlmError('output', message, hint === undefined ? {} : { hint });
}

/** Turns anything thrown into a printable one-liner without leaking stacks. */
export function describeError(error: unknown): string {
  if (error instanceof MindlmError) {
    return error.hint ? `${error.message}\n  ${error.hint}` : error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
