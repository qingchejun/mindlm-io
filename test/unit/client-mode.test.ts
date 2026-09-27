import { afterEach, describe, expect, it } from 'vitest';
import { textToDocument } from '../../src/extract/text.js';
import {
  buildClientInstructions,
  clientModePayload,
  truncateSource,
} from '../../src/outline/client-mode.js';
import { generateOutline } from '../../src/outline/generate.js';

const ARTICLE = `# Field notes

## Morning

The tide was out and the mud smelled of iron. Three herons stood in the channel.

## Afternoon

- counted 14 oystercatchers
- the wind turned south
`;

afterEach(() => {
  delete process.env.MINDMAP_CLIENT_MAX_CHARS;
});

describe('truncateSource', () => {
  it('leaves short text alone', () => {
    expect(truncateSource('short', 100)).toBe('short');
  });

  it('cuts on a paragraph boundary when one is close enough to the limit', () => {
    const text = `${'a'.repeat(80)}\n\n${'b'.repeat(80)}`;
    expect(truncateSource(text, 100)).toBe('a'.repeat(80));
  });

  it('falls back to a hard cut when the only break is too early', () => {
    const text = `ab\n\n${'c'.repeat(200)}`;
    expect(truncateSource(text, 100)).toHaveLength(100);
  });
});

describe('clientModePayload', () => {
  it('hands over the cleaned source text and says it is complete', () => {
    const payload = clientModePayload(textToDocument(ARTICLE));
    expect(payload.sourceText).toContain('Three herons stood in the channel.');
    expect(payload.sourceText).toContain('- counted 14 oystercatchers');
    expect(payload.sourceTruncated).toBe(false);
    expect(payload.instructions).not.toMatch(/truncated/);
  });

  it('respects MINDMAP_CLIENT_MAX_CHARS and admits the truncation', () => {
    process.env.MINDMAP_CLIENT_MAX_CHARS = '40';
    const payload = clientModePayload(textToDocument(ARTICLE));
    expect(payload.sourceText.length).toBeLessThanOrEqual(40);
    expect(payload.sourceTruncated).toBe(true);
    expect(payload.instructions).toMatch(/truncated/);
  });

  it('prefers an explicit limit over the environment', () => {
    process.env.MINDMAP_CLIENT_MAX_CHARS = '40';
    const payload = clientModePayload(textToDocument(ARTICLE), { maxChars: 10_000 });
    expect(payload.sourceTruncated).toBe(false);
  });
});

describe('instructions', () => {
  it('name the next tool call and carry the shape rules', () => {
    const instructions = buildClientInstructions({ truncated: false, maxDepth: 5, maxChildren: 6 });
    expect(instructions).toContain('export_mindmap');
    expect(instructions).toContain('At most 5 levels');
    expect(instructions).toContain('at most 6 children');
    expect(instructions).toMatch(/same language as the source/);
  });

  it('pin the language when one is requested', () => {
    expect(buildClientInstructions({ truncated: false, language: '中文' })).toContain(
      'Write every node in 中文.',
    );
  });
});

describe('client mode end to end', () => {
  it('returns a renderable draft alongside the material', async () => {
    const generated = await generateOutline(textToDocument(ARTICLE), 'mcp', { mode: 'client' });
    expect(generated.mode).toBe('client');
    expect(generated.markdown).toMatch(/^# Field notes/);
    expect(generated.instructions).toContain('export_mindmap');
    expect(generated.sourceText).toContain('oystercatchers');
    expect(generated.stats.nodes).toBeGreaterThan(2);
  });

  it('omits the client extras in heuristic mode', async () => {
    const generated = await generateOutline(textToDocument(ARTICLE), 'cli', { mode: 'heuristic' });
    expect(generated.mode).toBe('heuristic');
    expect(generated.sourceText).toBeUndefined();
    expect(generated.instructions).toBeUndefined();
  });
});
