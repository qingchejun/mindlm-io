/**
 * Which outline generator runs, and why. `auto` means different things on the
 * two surfaces: an MCP client always has a model of its own to lean on, a
 * terminal does not.
 */

import { type LlmEnv, llmEnv } from '../util/env.js';
import { usageError } from '../util/errors.js';

/** A mode the pipeline can actually run. */
export type OutlineMode = 'llm' | 'client' | 'heuristic';

/** What a caller may ask for. */
export type RequestedMode = OutlineMode | 'auto';

/** Where the request came from — it decides what `auto` resolves to. */
export type Surface = 'mcp' | 'cli';

export const MCP_MODES: RequestedMode[] = ['auto', 'client', 'llm', 'heuristic'];
/** The CLI has no client model to delegate to, so `client` is not offered. */
export const CLI_MODES: RequestedMode[] = ['auto', 'llm', 'heuristic'];

/**
 * Resolves a requested mode against the environment.
 *
 * - `auto` → `llm` when a key is configured; otherwise `client` on MCP and
 *   `heuristic` on the CLI.
 * - `llm` without a key is a usage error rather than a silent downgrade: the
 *   caller asked for a model, and pretending otherwise would misreport quality.
 * - `client` on the CLI is a usage error for the same reason.
 */
export function resolveMode(
  requested: RequestedMode | undefined,
  surface: Surface,
  env: LlmEnv = llmEnv(),
): OutlineMode {
  const mode = requested ?? 'auto';

  if (mode === 'auto') {
    if (env.hasKey) return 'llm';
    return surface === 'mcp' ? 'client' : 'heuristic';
  }

  if (mode === 'llm' && !env.hasKey) {
    throw usageError(
      'Mode "llm" needs an API key, and none is configured.',
      'Set ANTHROPIC_API_KEY or OPENAI_API_KEY, or use mode "auto" to run without one.',
    );
  }

  if (mode === 'client' && surface === 'cli') {
    throw usageError(
      'Mode "client" only works over MCP, where a client model can refine the draft.',
      'From the command line use "heuristic", or configure a key and use "llm".',
    );
  }

  return mode;
}
