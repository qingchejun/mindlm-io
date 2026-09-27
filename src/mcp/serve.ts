/**
 * stdio transport wiring. stdout belongs to the protocol, so every diagnostic
 * in this file — and in anything it calls — goes to stderr.
 */

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { llmEnv } from '../util/env.js';
import { VERSION } from '../util/version.js';
import { createMindlmServer } from './server.js';

export interface ServeOptions {
  /** Silences the two startup lines. */
  quiet?: boolean;
}

export interface ServeHandle {
  close(): Promise<void>;
}

/**
 * Starts the server and resolves when stdin closes, which is how an MCP client
 * says it is done. The factory is called per connection; registration is cheap
 * and holds no state between calls.
 */
export function serveMindlmStdio(options: ServeOptions = {}): ServeHandle {
  const handle = serveStdio(() => createMindlmServer(), {
    onerror: (error) => log(`error: ${error.message}`),
  });

  if (!options.quiet) {
    const env = llmEnv();
    log(`mindlm-mcp ${VERSION} listening on stdio`);
    log(
      env.hasKey
        ? `outline mode: auto → llm (${env.provider}${env.model ? `, ${env.model}` : ''})`
        : 'outline mode: auto → client (no API key configured; your model writes the outline)',
    );
  }

  return handle;
}

export function log(message: string): void {
  process.stderr.write(`[mindlm-mcp] ${message}\n`);
}
