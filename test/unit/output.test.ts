import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { exportMindmap } from '../../src/render/export.js';
import {
  defaultFileName,
  resolveOutputPath,
  slugify,
  timestamp,
  writeOutputFile,
} from '../../src/render/output.js';
import type { MindlmError } from '../../src/util/errors.js';

let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mindlm-output-'));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

afterEach(() => {
  delete process.env.MINDMAP_OUTPUT_DIR;
});

describe('slugify', () => {
  it('keeps letters and digits of any script', () => {
    expect(slugify('Tide tables: spring & neap')).toBe('tide-tables-spring-neap');
    expect(slugify('思维导图 v2')).toBe('思维导图-v2');
  });

  it('falls back when nothing survives', () => {
    expect(slugify('!!! ???')).toBe('mindmap');
    expect(slugify('')).toBe('mindmap');
  });

  it('trims to the requested length and never ends on a dash', () => {
    expect(slugify('a-very-long-title-indeed', 8)).toBe('a-very-l');
    expect(slugify('a very long title indeed', 7)).toBe('a-very');
  });
});

describe('names', () => {
  it('timestamp a file so two runs do not collide', () => {
    expect(timestamp(new Date(2026, 8, 27, 18, 5, 3))).toBe('20260927-180503');
    expect(defaultFileName('Tide tables')).toMatch(/^tide-tables-\d{8}-\d{6}\.html$/);
  });
});

describe('resolveOutputPath', () => {
  it('uses MINDMAP_OUTPUT_DIR when nothing is requested', async () => {
    process.env.MINDMAP_OUTPUT_DIR = directory;
    const path = await resolveOutputPath(undefined, 'Tides');
    expect(dirname(path)).toBe(directory);
    expect(path).toMatch(/tides-\d{8}-\d{6}\.html$/);
  });

  it('defaults to ./mindmaps', async () => {
    const path = await resolveOutputPath(undefined, 'Tides');
    expect(dirname(path)).toBe(join(process.cwd(), 'mindmaps'));
  });

  it('takes an explicit file name literally', async () => {
    const path = await resolveOutputPath(join(directory, 'out.html'), 'Tides');
    expect(path).toBe(join(directory, 'out.html'));
  });

  it('generates a name inside an existing directory', async () => {
    const path = await resolveOutputPath(directory, 'Tides');
    expect(dirname(path)).toBe(directory);
  });

  it('honours the requested extension', async () => {
    const path = await resolveOutputPath(undefined, 'Tides', '.md');
    expect(path.endsWith('.md')).toBe(true);
  });
});

describe('writeOutputFile', () => {
  it('creates missing parent directories and reports the file URL', async () => {
    const path = join(directory, 'nested', 'deeper', 'note.md');
    const written = await writeOutputFile(path, '# hello\n');

    expect(written.path).toBe(path);
    expect(written.fileUrl.startsWith('file://')).toBe(true);
    expect(written.bytes).toBe(8);
    await expect(readFile(path, 'utf8')).resolves.toBe('# hello\n');
  });

  it('refuses to clobber an existing file unless told to', async () => {
    const path = join(directory, 'twice.md');
    await writeOutputFile(path, 'first');

    try {
      await writeOutputFile(path, 'second');
      expect.unreachable();
    } catch (error) {
      expect((error as MindlmError).code).toBe('output');
      expect((error as MindlmError).exitCode).toBe(2);
    }

    await writeOutputFile(path, 'second', { overwrite: true });
    await expect(readFile(path, 'utf8')).resolves.toBe('second');
  });
});

describe('exportMindmap', () => {
  it('renders and writes in one step', async () => {
    const result = await exportMindmap({
      markdown: '# Tides\n\n## Spring\n\n## Neap\n',
      outputPath: join(directory, 'export.html'),
    });

    expect(result.path).toBe(join(directory, 'export.html'));
    expect(result.title).toBe('Tides');
    expect(result.nodes).toBe(3);
    expect(result.offline).toBe(true);
    expect(result.bytes).toBeGreaterThan(100_000);

    const html = await readFile(result.path, 'utf8');
    expect(html).toContain('<title>Tides</title>');
    expect(html).not.toMatch(/<script[^>]+src="http/);
  });
});
