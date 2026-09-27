import { afterEach, describe, expect, it } from 'vitest';
import {
  ANTHROPIC_BASE_URL,
  DEFAULT_MODELS,
  describeConfig,
  OPENAI_BASE_URL,
  resolveLlmConfig,
} from '../../src/llm/config.js';
import type { MindlmError } from '../../src/util/errors.js';

/** Deliberately not key-shaped: nothing in this repo should look like a real secret. */
const PLACEHOLDER = 'placeholder-value';

afterEach(() => {
  for (const key of [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'MINDMAP_LLM_PROVIDER',
    'MINDMAP_LLM_MODEL',
  ]) {
    delete process.env[key];
  }
});

describe('resolveLlmConfig', () => {
  it('needs a provider', () => {
    expect(() => resolveLlmConfig()).toThrow(/No LLM provider is configured/);
  });

  it('picks anthropic from its key and supplies a documented default model', () => {
    process.env.ANTHROPIC_API_KEY = PLACEHOLDER;
    const config = resolveLlmConfig();
    expect(config).toEqual({
      provider: 'anthropic',
      model: DEFAULT_MODELS.anthropic,
      baseUrl: ANTHROPIC_BASE_URL,
      apiKey: PLACEHOLDER,
    });
  });

  it('insists on a model name for OpenAI-compatible endpoints', () => {
    process.env.OPENAI_API_KEY = PLACEHOLDER;
    try {
      resolveLlmConfig();
      expect.unreachable();
    } catch (error) {
      expect((error as MindlmError).code).toBe('usage');
      expect((error as MindlmError).hint).toMatch(/MINDMAP_LLM_MODEL/);
    }
  });

  it('takes the model and base URL from the environment', () => {
    process.env.OPENAI_API_KEY = PLACEHOLDER;
    process.env.MINDMAP_LLM_MODEL = 'some-model';
    process.env.OPENAI_BASE_URL = 'https://gateway.example.com/v1/';
    expect(resolveLlmConfig()).toMatchObject({
      provider: 'openai',
      model: 'some-model',
      baseUrl: 'https://gateway.example.com/v1',
    });
  });

  it('lets explicit overrides win over the environment', () => {
    process.env.ANTHROPIC_API_KEY = PLACEHOLDER;
    process.env.OPENAI_API_KEY = PLACEHOLDER;
    process.env.MINDMAP_LLM_MODEL = 'from-env';
    const config = resolveLlmConfig({ provider: 'openai', model: 'from-flag' });
    expect(config.provider).toBe('openai');
    expect(config.model).toBe('from-flag');
    expect(config.baseUrl).toBe(OPENAI_BASE_URL);
  });

  it('names the missing variable when a provider is forced without its key', () => {
    process.env.MINDMAP_LLM_PROVIDER = 'openai';
    process.env.ANTHROPIC_API_KEY = PLACEHOLDER;
    expect(() => resolveLlmConfig()).toThrow(/OPENAI_API_KEY is not set/);
  });
});

describe('describeConfig', () => {
  it('describes the call without the key', () => {
    process.env.ANTHROPIC_API_KEY = PLACEHOLDER;
    const description = describeConfig(resolveLlmConfig());
    expect(description).toBe('anthropic · claude-sonnet-5 · api.anthropic.com');
    expect(description).not.toContain(PLACEHOLDER);
  });
});
