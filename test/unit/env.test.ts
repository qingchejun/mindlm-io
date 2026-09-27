import { afterEach, describe, expect, it } from 'vitest';
import {
  allowPrivateHosts,
  clientMaxChars,
  DEFAULTS,
  llmEnv,
  maxInputChars,
  outputDir,
} from '../../src/util/env.js';

const KEYS = [
  'MINDMAP_MAX_INPUT_CHARS',
  'MINDMAP_CLIENT_MAX_CHARS',
  'MINDMAP_ALLOW_PRIVATE_HOSTS',
  'MINDMAP_OUTPUT_DIR',
  'MINDMAP_LLM_PROVIDER',
  'MINDMAP_LLM_MODEL',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
];

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe('numeric settings', () => {
  it('fall back to the documented defaults', () => {
    expect(maxInputChars()).toBe(DEFAULTS.maxInputChars);
    expect(clientMaxChars()).toBe(DEFAULTS.clientMaxChars);
    expect(outputDir()).toBe(DEFAULTS.outputDir);
  });

  it('read a valid override', () => {
    process.env.MINDMAP_MAX_INPUT_CHARS = '1234';
    expect(maxInputChars()).toBe(1234);
  });

  it('ignore junk and non-positive values', () => {
    process.env.MINDMAP_MAX_INPUT_CHARS = 'lots';
    expect(maxInputChars()).toBe(DEFAULTS.maxInputChars);
    process.env.MINDMAP_MAX_INPUT_CHARS = '0';
    expect(maxInputChars()).toBe(DEFAULTS.maxInputChars);
    process.env.MINDMAP_MAX_INPUT_CHARS = '  ';
    expect(maxInputChars()).toBe(DEFAULTS.maxInputChars);
  });
});

describe('allowPrivateHosts', () => {
  it('defaults to false and accepts the usual truthy spellings', () => {
    expect(allowPrivateHosts()).toBe(false);
    for (const value of ['true', 'TRUE', '1', 'yes', 'on']) {
      process.env.MINDMAP_ALLOW_PRIVATE_HOSTS = value;
      expect(allowPrivateHosts()).toBe(true);
    }
    for (const value of ['false', '0', 'no', '']) {
      process.env.MINDMAP_ALLOW_PRIVATE_HOSTS = value;
      expect(allowPrivateHosts()).toBe(false);
    }
  });
});

describe('llmEnv', () => {
  it('reports no provider when nothing is configured', () => {
    expect(llmEnv()).toEqual({
      provider: undefined,
      hasKey: false,
      baseUrl: undefined,
      model: undefined,
    });
  });

  it('infers the provider from whichever key is present', () => {
    process.env.OPENAI_API_KEY = 'placeholder';
    expect(llmEnv().provider).toBe('openai');
    expect(llmEnv().hasKey).toBe(true);

    process.env.ANTHROPIC_API_KEY = 'placeholder';
    expect(llmEnv().provider).toBe('anthropic');
  });

  it('honours an explicit provider even without its key', () => {
    process.env.MINDMAP_LLM_PROVIDER = 'openai';
    process.env.ANTHROPIC_API_KEY = 'placeholder';
    const env = llmEnv();
    expect(env.provider).toBe('openai');
    expect(env.hasKey).toBe(false);
  });

  it('passes the base URL and model through', () => {
    process.env.OPENAI_API_KEY = 'placeholder';
    process.env.OPENAI_BASE_URL = 'https://example.com/v1';
    process.env.MINDMAP_LLM_MODEL = 'some-model';
    expect(llmEnv()).toEqual({
      provider: 'openai',
      hasKey: true,
      baseUrl: 'https://example.com/v1',
      model: 'some-model',
    });
  });

  it('never returns the key itself', () => {
    process.env.ANTHROPIC_API_KEY = 'placeholder-value';
    expect(JSON.stringify(llmEnv())).not.toContain('placeholder-value');
  });
});
