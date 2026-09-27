import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ARTICLE = join(ROOT, 'examples/article.txt');

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs the built CLI. Never rejects — the exit code is part of the contract. */
async function cli(args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}) {
  const child = execFile(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...options.env },
    maxBuffer: 20 * 1024 * 1024,
  });

  // Commands that do not read stdin still need it closed, or `-` would hang.
  child.stdin?.end(options.input ?? '');

  return await new Promise<Run>((resolve) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mindlm-cli-'));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('metadata commands', () => {
  it('print the version', async () => {
    const result = await cli(['--version']);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('list every documented command in the help', async () => {
    const { stdout, code } = await cli(['--help']);
    expect(code).toBe(0);
    for (const command of ['serve', 'demo', 'text', 'url', 'pdf', 'export', 'doctor']) {
      expect(stdout).toContain(command);
    }
  });

  it('print one usage line, with [command] only once', async () => {
    const { stdout, code } = await cli(['--help']);
    expect(code).toBe(0);
    expect(stdout.split('\n')[0]).toBe('Usage: mindlm-mcp [options] [command]');
  });

  it('name the model doctor would use, default or not', async () => {
    const withDefault = await cli(['doctor'], {
      env: { ANTHROPIC_API_KEY: 'placeholder-value', MINDMAP_OUTPUT_DIR: directory },
    });
    expect(withDefault.code).toBe(0);
    expect(withDefault.stdout).toContain('model claude-sonnet-5 (default)');

    const withOverride = await cli(['doctor'], {
      env: {
        ANTHROPIC_API_KEY: 'placeholder-value',
        MINDMAP_LLM_MODEL: 'some-other-model',
        MINDMAP_OUTPUT_DIR: directory,
      },
    });
    expect(withOverride.stdout).toContain('model some-other-model');
    expect(withOverride.stdout).not.toContain('(default)');
  });

  it('report the zero-key configuration in doctor', async () => {
    const { stdout, code } = await cli(['doctor'], {
      env: { ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', MINDMAP_OUTPUT_DIR: directory },
    });
    expect(code).toBe(0);
    expect(stdout).toContain('zero-key mode');
    expect(stdout).toContain('cli → heuristic');
    expect(stdout).toContain(directory);
  });

  it('exit 1 on an unknown command', async () => {
    const { code, stderr } = await cli(['nonsense']);
    expect(code).toBe(1);
    expect(stderr).toContain('unknown command');
  });
});

describe('demo', () => {
  it('writes a self-contained HTML file', async () => {
    const output = join(directory, 'demo.html');
    const { stdout, code } = await cli(['demo', '--no-open', '-o', output]);

    expect(code).toBe(0);
    expect(stdout.trim()).toBe(output);

    const html = await readFile(output, 'utf8');
    expect(html).toContain('<title>mindlm-mcp</title>');
    expect(html).toContain('<meta name="generator" content="mindlm-mcp');
    // Offline is the default: no remote script may appear.
    expect(html).not.toMatch(/<script[^>]+src="https?:/);
    expect(html).not.toContain('mindlm.io');
  });

  it('adds the footer link only with --branding', async () => {
    const output = join(directory, 'branded.html');
    await cli(['demo', '--no-open', '--branding', '-o', output]);
    expect(await readFile(output, 'utf8')).toContain('Made with mindlm-mcp');
  });
});

describe('text', () => {
  it('prints an outline with --md and writes nothing', async () => {
    const { stdout, stderr, code } = await cli(['text', ARTICLE, '--md', '--depth', '3']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^# Why note-taking tools keep reinventing the outline/);
    expect(stderr).toContain('mode: heuristic');
  });

  it('reads stdin and writes a Markdown outline to -o *.md', async () => {
    const output = join(directory, 'stdin.md');
    const { code, stdout } = await cli(['text', '-', '-o', output, '--title', 'From stdin'], {
      input: '# Ignored heading\n\nA paragraph about tides.\n\n- one\n- two\n',
    });

    expect(code).toBe(0);
    expect(stdout.trim()).toBe(output);
    expect(await readFile(output, 'utf8')).toMatch(/^# From stdin/);
  });

  it('refuses to overwrite unless asked, with exit code 2', async () => {
    const output = join(directory, 'twice.html');
    expect((await cli(['text', ARTICLE, '-o', output, '-q'])).code).toBe(0);

    const second = await cli(['text', ARTICLE, '-o', output, '-q']);
    expect(second.code).toBe(2);
    expect(second.stderr).toContain('already exists');

    expect((await cli(['text', ARTICLE, '-o', output, '--overwrite', '-q'])).code).toBe(0);
  });

  it('exits 2 on a missing file', async () => {
    const { code, stderr } = await cli(['text', join(directory, 'nope.txt')]);
    expect(code).toBe(2);
    expect(stderr).toContain('No such file');
  });

  it('exits 1 when a mode needs a key that is not configured', async () => {
    const { code, stderr } = await cli(['text', ARTICLE, '--mode', 'llm', '--md'], {
      env: { ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' },
    });
    expect(code).toBe(1);
    expect(stderr).toContain('needs an API key');
  });

  it('rejects a mode the CLI cannot run', async () => {
    const { code, stderr } = await cli(['text', ARTICLE, '--mode', 'client']);
    expect(code).toBe(1);
    expect(stderr).toContain('Allowed choices are auto, llm, heuristic');
  });
});

describe('url', () => {
  it('exits 2 when the host is blocked by the SSRF guard', async () => {
    const { code, stderr } = await cli(['url', 'http://127.0.0.1:9/page'], {
      env: { MINDMAP_ALLOW_PRIVATE_HOSTS: 'false' },
    });
    expect(code).toBe(2);
    expect(stderr).toMatch(/private|loopback|not allowed/i);
  });
});

describe('pdf', () => {
  it('outlines the fixture', async () => {
    const output = join(directory, 'fixture.html');
    const { code, stdout } = await cli([
      'pdf',
      join(ROOT, 'test/fixtures/sample.pdf'),
      '-o',
      output,
      '-q',
    ]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe(output);
    expect((await readFile(output, 'utf8')).length).toBeGreaterThan(100_000);
  });
});

describe('export', () => {
  it('renders an existing outline and can skip the toolbar and go online', async () => {
    const source = join(directory, 'outline.md');
    await writeFile(source, '# Tides\n\n## Spring\n\n## Neap\n', 'utf8');

    const output = join(directory, 'outline.html');
    const { code } = await cli([
      'export',
      source,
      '-o',
      output,
      '--no-offline',
      '--no-toolbar',
      '-q',
    ]);

    expect(code).toBe(0);
    const html = await readFile(output, 'utf8');
    expect(html).toContain('<title>Tides</title>');
    expect(html).toMatch(/<script[^>]+src="https:\/\/cdn\.jsdelivr\.net/);
    expect(html).not.toContain('markmap-toolbar');
  });
});
