import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_URL, USER_AGENT, VERSION } from '../../src/util/version.js';

describe('VERSION', () => {
  it('matches package.json', async () => {
    const manifest = JSON.parse(
      await readFile(join(import.meta.dirname, '../../package.json'), 'utf8'),
    );
    expect(VERSION).toBe(manifest.version);
  });
});

describe('USER_AGENT', () => {
  it('names the tool and links to the repository', () => {
    expect(USER_AGENT).toBe(`mindlm-mcp/${VERSION} (+${REPO_URL})`);
    expect(REPO_URL).toMatch(/^https:\/\/github\.com\//);
  });
});
