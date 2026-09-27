import { describe, expect, it, vi } from 'vitest';
import { textToDocument } from '../../src/extract/text.js';
import { ANTHROPIC_VERSION, completeWithAnthropic } from '../../src/llm/anthropic.js';
import type { LlmConfig } from '../../src/llm/config.js';
import { completeWithOpenAi } from '../../src/llm/openai-compatible.js';
import { llmOutline, stripCodeFence } from '../../src/outline/llm.js';
import type { MindlmError } from '../../src/util/errors.js';

const PLACEHOLDER = 'placeholder-value';

const ANTHROPIC: LlmConfig = {
  provider: 'anthropic',
  model: 'test-model',
  baseUrl: 'https://api.example.com',
  apiKey: PLACEHOLDER,
};

const OPENAI: LlmConfig = {
  ...ANTHROPIC,
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
};

const DOCUMENT = textToDocument(`# Tide tables

## Spring tides

The range is largest when the sun and moon pull together.

## Neap tides

The range is smallest when they pull at right angles.
`);

/** Replies with the given responses in order; records every call. */
function fetchStub(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (next instanceof Error) throw next;
    // A Response body can only be read once, so hand out a fresh clone.
    return (next as Response).clone();
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const anthropicOk = (text: string) =>
  new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 });

const openaiOk = (text: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });

const body = (call: { init: RequestInit }) => JSON.parse(String(call.init.body));

describe('anthropic requests', () => {
  it('post the documented shape to /v1/messages', async () => {
    const { impl, calls } = fetchStub(anthropicOk('# Root'));
    const text = await completeWithAnthropic(ANTHROPIC, {
      system: 'sys',
      user: 'usr',
      fetchImpl: impl,
    });

    expect(text).toBe('# Root');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.example.com/v1/messages');
    expect(calls[0]?.init.method).toBe('POST');

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(PLACEHOLDER);
    expect(headers['anthropic-version']).toBe(ANTHROPIC_VERSION);
    expect(headers['content-type']).toBe('application/json');

    expect(body(calls[0]!)).toMatchObject({
      model: 'test-model',
      system: 'sys',
      messages: [{ role: 'user', content: 'usr' }],
    });
    expect(body(calls[0]!).max_tokens).toBeGreaterThan(0);
  });

  it('join text blocks and ignore the others', async () => {
    const payload = new Response(
      JSON.stringify({ content: [{ type: 'thinking' }, { type: 'text', text: '# A' }] }),
      { status: 200 },
    );
    const { impl } = fetchStub(payload);
    await expect(
      completeWithAnthropic(ANTHROPIC, { system: 's', user: 'u', fetchImpl: impl }),
    ).resolves.toBe('# A');
  });

  it('reject an empty message', async () => {
    const { impl } = fetchStub(new Response(JSON.stringify({ content: [] }), { status: 200 }));
    await expect(
      completeWithAnthropic(ANTHROPIC, { system: 's', user: 'u', fetchImpl: impl }),
    ).rejects.toThrow(/no content array|empty message/);
  });
});

describe('openai-compatible requests', () => {
  it('post to {base}/chat/completions with a bearer token', async () => {
    const { impl, calls } = fetchStub(openaiOk('# Root'));
    const text = await completeWithOpenAi(OPENAI, {
      system: 'sys',
      user: 'usr',
      fetchImpl: impl,
    });

    expect(text).toBe('# Root');
    expect(calls[0]?.url).toBe('https://api.example.com/v1/chat/completions');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${PLACEHOLDER}`,
    );
    expect(body(calls[0]!).messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' },
    ]);
  });

  it('accept content returned as parts', async () => {
    const payload = new Response(
      JSON.stringify({ choices: [{ message: { content: [{ text: '# A' }, { text: 'B' }] } }] }),
      { status: 200 },
    );
    const { impl } = fetchStub(payload);
    await expect(
      completeWithOpenAi(OPENAI, { system: 's', user: 'u', fetchImpl: impl }),
    ).resolves.toBe('# AB');
  });
});

describe('retries', () => {
  const call = (impl: typeof fetch) =>
    completeWithAnthropic(ANTHROPIC, {
      system: 's',
      user: 'u',
      fetchImpl: impl,
      retryDelayMs: 0,
    });

  it('retry a 429 and use the eventual success', async () => {
    const { impl, calls } = fetchStub(
      new Response('slow down', { status: 429 }),
      anthropicOk('# Root'),
    );
    await expect(call(impl)).resolves.toBe('# Root');
    expect(calls).toHaveLength(2);
  });

  it('give up after two retries on 5xx', async () => {
    const { impl, calls } = fetchStub(new Response('boom', { status: 503 }));
    await expect(call(impl)).rejects.toThrow(/HTTP 503/);
    expect(calls).toHaveLength(3);
  });

  it('do not retry a 400', async () => {
    const { impl, calls } = fetchStub(new Response('bad request', { status: 400 }));
    await expect(call(impl)).rejects.toThrow(/HTTP 400/);
    expect(calls).toHaveLength(1);
  });

  it('retry a transport failure', async () => {
    const { impl, calls } = fetchStub(new Error('ECONNRESET'), anthropicOk('# Root'));
    await expect(call(impl)).resolves.toBe('# Root');
    expect(calls).toHaveLength(2);
  });

  it('report an auth failure without echoing the key', async () => {
    const { impl } = fetchStub(new Response('invalid x-api-key', { status: 401 }));
    try {
      await call(impl);
      expect.unreachable();
    } catch (error) {
      const failure = error as MindlmError;
      expect(failure.code).toBe('llm');
      expect(failure.exitCode).toBe(3);
      expect(`${failure.message}${failure.hint}`).not.toContain(PLACEHOLDER);
    }
  });
});

describe('stripCodeFence', () => {
  it('unwraps a fenced block', () => {
    expect(stripCodeFence('Here you go:\n```markdown\n# Root\n## A\n```\n')).toBe('# Root\n## A');
  });

  it('drops a preamble before the first heading', () => {
    expect(stripCodeFence('Sure thing!\n# Root\n## A')).toBe('# Root\n## A');
  });

  it('leaves a bare outline alone', () => {
    expect(stripCodeFence('# Root\n## A')).toBe('# Root\n## A');
  });
});

describe('llmOutline', () => {
  it('uses the model output and normalizes it', async () => {
    const { impl, calls } = fetchStub(
      anthropicOk('```markdown\n# Tides\n## Spring\n### Largest range\n#### Too deep\n```'),
    );
    const result = await llmOutline(DOCUMENT, {
      config: ANTHROPIC,
      fetchImpl: impl,
      maxDepth: 3,
      retryDelayMs: 0,
    });

    expect(result.mode).toBe('llm');
    expect(result.warning).toBeUndefined();
    expect(result.markdown).toContain('# Tides');
    expect(result.markdown).not.toContain('Too deep');

    // The prompt carries both the draft and the source material.
    const prompt = body(calls[0]!).messages[0].content as string;
    expect(prompt).toContain('DRAFT OUTLINE');
    expect(prompt).toContain('sun and moon pull together');
    expect(prompt).toContain('At most 3 levels');
  });

  it('honours a requested title even if the model ignores it', async () => {
    const { impl } = fetchStub(anthropicOk('# Something else\n## A\n## B'));
    const result = await llmOutline(DOCUMENT, {
      config: ANTHROPIC,
      fetchImpl: impl,
      title: 'Pinned',
      retryDelayMs: 0,
    });
    expect(result.markdown.startsWith('# Pinned')).toBe(true);
  });

  it('falls back to the heuristic when the call fails, and says so', async () => {
    const { impl } = fetchStub(new Response('nope', { status: 500 }));
    const result = await llmOutline(DOCUMENT, {
      config: ANTHROPIC,
      fetchImpl: impl,
      retryDelayMs: 0,
    });

    expect(result.mode).toBe('heuristic');
    expect(result.warning).toMatch(/Fell back to the heuristic outline/);
    expect(result.warning).toContain('HTTP 500');
    expect(result.warning).not.toContain(PLACEHOLDER);
    expect(result.markdown).toContain('Tide tables');
  });

  it('falls back when the model returns something unusable', async () => {
    const { impl } = fetchStub(anthropicOk('I cannot help with that.'));
    const result = await llmOutline(DOCUMENT, {
      config: ANTHROPIC,
      fetchImpl: impl,
      retryDelayMs: 0,
    });
    expect(result.mode).toBe('heuristic');
    expect(result.warning).toMatch(/too little/);
  });

  it('falls back when no provider is configured at all', async () => {
    const result = await llmOutline(DOCUMENT, { fetchImpl: fetchStub().impl });
    expect(result.mode).toBe('heuristic');
    expect(result.warning).toMatch(/No LLM provider is configured/);
  });
});
