import { afterEach, describe, expect, it } from 'vitest';
import { CLI_MODES, MCP_MODES, resolveMode } from '../../src/outline/mode.js';
import { MindlmError } from '../../src/util/errors.js';

const withKey = {
  provider: 'anthropic' as const,
  hasKey: true,
  baseUrl: undefined,
  model: undefined,
};
const withoutKey = { provider: undefined, hasKey: false, baseUrl: undefined, model: undefined };

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

describe('auto', () => {
  it('prefers a configured model on both surfaces', () => {
    expect(resolveMode('auto', 'mcp', withKey)).toBe('llm');
    expect(resolveMode('auto', 'cli', withKey)).toBe('llm');
  });

  it('falls back to the client model over MCP and to the heuristic on the CLI', () => {
    expect(resolveMode('auto', 'mcp', withoutKey)).toBe('client');
    expect(resolveMode('auto', 'cli', withoutKey)).toBe('heuristic');
  });

  it('is what an omitted mode means', () => {
    expect(resolveMode(undefined, 'mcp', withoutKey)).toBe('client');
    expect(resolveMode(undefined, 'cli', withoutKey)).toBe('heuristic');
  });

  it('reads the environment when no override is passed', () => {
    expect(resolveMode('auto', 'cli')).toBe('heuristic');
    process.env.OPENAI_API_KEY = 'placeholder';
    expect(resolveMode('auto', 'cli')).toBe('llm');
  });
});

describe('explicit modes', () => {
  it('pass through when they can be honoured', () => {
    expect(resolveMode('heuristic', 'cli', withoutKey)).toBe('heuristic');
    expect(resolveMode('client', 'mcp', withoutKey)).toBe('client');
    expect(resolveMode('llm', 'mcp', withKey)).toBe('llm');
  });

  it('refuse llm without a key rather than quietly downgrading', () => {
    expect(() => resolveMode('llm', 'mcp', withoutKey)).toThrow(MindlmError);
    try {
      resolveMode('llm', 'cli', withoutKey);
      expect.unreachable();
    } catch (error) {
      expect((error as MindlmError).code).toBe('usage');
      expect((error as MindlmError).exitCode).toBe(1);
      expect((error as MindlmError).hint).toMatch(/ANTHROPIC_API_KEY/);
    }
  });

  it('refuse client on the CLI, where there is no client model', () => {
    expect(() => resolveMode('client', 'cli', withoutKey)).toThrow(/only works over MCP/);
  });
});

describe('advertised choices', () => {
  it('offer client over MCP only', () => {
    expect(MCP_MODES).toContain('client');
    expect(CLI_MODES).not.toContain('client');
  });
});
