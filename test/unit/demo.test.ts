import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEMO_MARKDOWN, DEMO_TITLE } from '../../src/demo.js';
import { parseOutlineMarkdown } from '../../src/outline/normalize.js';

const EXAMPLE = fileURLToPath(new URL('../../examples/quickstart.md', import.meta.url));

describe('the bundled demo', () => {
  it('matches examples/quickstart.md byte for byte', async () => {
    // The published package ships only dist/, so the demo is embedded rather
    // than read from disk — this keeps the two copies honest.
    await expect(readFile(EXAMPLE, 'utf8')).resolves.toBe(DEMO_MARKDOWN);
  });

  it('is a valid outline with the declared title', () => {
    const outline = parseOutlineMarkdown(DEMO_MARKDOWN);
    expect(outline.title).toBe(DEMO_TITLE);
    expect(outline.children.length).toBeGreaterThanOrEqual(3);
  });
});
