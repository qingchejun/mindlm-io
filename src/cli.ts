#!/usr/bin/env node
/**
 * The `mindlm-mcp` command. Three jobs: run the MCP server over stdio, turn an
 * input into a mind map, and tell you why it did not work.
 *
 * Conventions: results a script might consume (a file path, an outline) go to
 * stdout; progress and diagnostics go to stderr; `--quiet` silences the latter.
 * Exit codes are 0 ok, 1 usage, 2 input, 3 LLM — see `src/util/errors.ts`.
 */

import { spawn } from 'node:child_process';
import { access, constants, readFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { Command, InvalidArgumentError, Option } from 'commander';
import { DEMO_MARKDOWN, DEMO_TITLE } from './demo.js';
import { pdfBytesToDocument, pdfFileToDocument, resolveUserPath } from './extract/pdf.js';
import { textToDocument } from './extract/text.js';
import { fetchUrlDocument } from './extract/url.js';
import { serveMindlmStdio } from './mcp/serve.js';
import type { Document } from './outline/blocks.js';
import { type GeneratedOutline, generateOutline } from './outline/generate.js';
import type { RequestedMode } from './outline/mode.js';
import { type ExportResult, exportMindmap } from './render/export.js';
import { resolveOutputPath, writeOutputFile } from './render/output.js';
import { llmEnv, outputDir } from './util/env.js';
import { describeError, MindlmError, usageError } from './util/errors.js';
import { VERSION } from './util/version.js';

/** Options that decide what is written and where. */
interface RenderOptions {
  output?: string;
  title?: string;
  offline: boolean;
  toolbar: boolean;
  open?: boolean;
  overwrite?: boolean;
  branding?: boolean;
  quiet?: boolean;
  envFile?: string;
}

/** Options that decide how the outline is produced. */
interface OutlineOptions extends RenderOptions {
  md?: boolean;
  mode?: RequestedMode;
  depth?: number;
  maxChildren?: number;
  lang?: string;
  provider?: 'anthropic' | 'openai';
  model?: string;
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('mindlm-mcp')
    .description(
      'Turn text, web pages and PDFs into interactive mind maps.\n' +
        'With no arguments and no terminal attached it starts the MCP stdio server,\n' +
        'which is what an MCP client wants.',
    )
    .version(VERSION, '-v, --version')
    .showHelpAfterError('(run `mindlm-mcp --help` for usage)')
    .argument('[command]', 'one of the commands below')
    .action(async (command: string | undefined) => {
      if (command !== undefined) {
        program.error(`error: unknown command '${command}'`, {
          exitCode: 1,
          code: 'commander.unknownCommand',
        });
      }
      if (process.stdin.isTTY) {
        program.outputHelp();
        return;
      }
      await runServe({});
    });

  program
    .command('serve')
    .description('start the MCP server on stdio (what an MCP client should run)')
    .option('--env-file <path>', 'load environment variables from a .env file first')
    .option('-q, --quiet', 'do not print the startup banner to stderr')
    .action(async (options: { envFile?: string; quiet?: boolean }) => {
      await withErrors(async () => {
        loadEnvFile(options.envFile);
        await runServe(options);
      });
    });

  addRenderOptions(
    program
      .command('demo')
      .description('render a built-in example mind map and open it')
      .option('--no-open', 'do not open the file in a browser'),
    { openFlag: false },
  ).action(async (options: RenderOptions & { open: boolean }) => {
    await withErrors(async () => {
      loadEnvFile(options.envFile);
      const written = await renderToFile(DEMO_MARKDOWN, options.title ?? DEMO_TITLE, options);
      announce(options, written, `demo · ${written.nodes} nodes`);
      if (options.open !== false) openFile(written.path, options);
    });
  });

  addOutlineOptions(
    program
      .command('text')
      .description('outline a text or Markdown file; use "-" to read stdin')
      .argument('<file>', 'path to a .txt/.md file, or - for stdin'),
  ).action(async (file: string, options: OutlineOptions) => {
    await withErrors(async () => {
      loadEnvFile(options.envFile);
      const raw = file === '-' ? await readStdin() : await readTextFile(file);
      const document = textToDocument(raw, options.title ? { title: options.title } : {});
      await finish(document, options);
    });
  });

  addOutlineOptions(
    program
      .command('url')
      .description('fetch a page and outline its main content')
      .argument('<url>', 'an http(s) URL'),
  ).action(async (url: string, options: OutlineOptions) => {
    await withErrors(async () => {
      loadEnvFile(options.envFile);
      const fetched = await fetchUrlDocument(url);
      const document =
        fetched.kind === 'pdf'
          ? (await pdfBytesToDocument(fetched.bytes, { label: fetched.source.finalUrl })).document
          : fetched.document;
      await finish(document, options);
    });
  });

  addOutlineOptions(
    program
      .command('pdf')
      .description('outline a local PDF (needs a text layer; no OCR)')
      .argument('<file>', 'path to a PDF file')
      .option('--pages <range>', 'pages to read, e.g. 1-20 or 1-5,9'),
  ).action(async (file: string, options: OutlineOptions & { pages?: string }) => {
    await withErrors(async () => {
      loadEnvFile(options.envFile);
      const result = await pdfFileToDocument(file, {
        ...(options.pages === undefined ? {} : { pages: options.pages }),
      });
      await finish(result.document, options);
    });
  });

  addRenderOptions(
    program
      .command('export')
      .description('render an existing Markdown outline to HTML')
      .argument('<outline>', 'path to a Markdown outline, or - for stdin'),
  ).action(async (outline: string, options: RenderOptions) => {
    await withErrors(async () => {
      loadEnvFile(options.envFile);
      const markdown = outline === '-' ? await readStdin() : await readTextFile(outline);
      const written = await renderToFile(markdown, options.title, options);
      announce(options, written, `${written.nodes} nodes`);
      if (options.open) openFile(written.path, options);
    });
  });

  program
    .command('doctor')
    .description('check the runtime, the LLM configuration and the output directory')
    .option('--env-file <path>', 'load environment variables from a .env file first')
    .action(async (options: { envFile?: string }) => {
      await withErrors(async () => {
        loadEnvFile(options.envFile);
        await runDoctor();
      });
    });

  return program;
}

function addRenderOptions(command: Command, config: { openFlag?: boolean } = {}): Command {
  const withOutput = command
    .option('-o, --output <path>', 'write here; .md writes the outline, .html the mind map')
    .option('--title <title>', 'root node title / page title')
    .option('--no-offline', 'link CDN assets instead of inlining them')
    .option('--no-toolbar', 'hide the mind map toolbar');

  // `demo` declares `--no-open` instead: there the default is to open.
  if (config.openFlag !== false) withOutput.option('--open', 'open the result in a browser');

  return withOutput
    .option('--overwrite', 'replace the output file if it already exists')
    .option('--branding', 'add a "Made with mindlm-mcp" footer link')
    .option('-q, --quiet', 'only print results, no progress')
    .option('--env-file <path>', 'load environment variables from a .env file first');
}

function addOutlineOptions(command: Command): Command {
  return addRenderOptions(command)
    .option('--md', 'print the Markdown outline to stdout')
    .addOption(
      new Option('--mode <mode>', 'how the outline is written').choices([
        'auto',
        'llm',
        'heuristic',
      ]),
    )
    .option('--depth <n>', 'maximum levels, 2-6', parseIntOption)
    .option('--max-children <n>', 'maximum children per node, 3-15', parseIntOption)
    .option('--lang <language>', 'language for the node labels')
    .addOption(new Option('--provider <name>', 'LLM provider').choices(['anthropic', 'openai']))
    .option('--model <name>', 'LLM model name');
}

async function runServe(options: { quiet?: boolean }): Promise<void> {
  serveMindlmStdio(options.quiet === undefined ? {} : { quiet: options.quiet });
  // Resolves when the client closes stdin, which is how it says it is done.
  await new Promise<void>((resolve) => process.stdin.once('close', resolve));
}

/** Outline a document, then write whatever the options asked for. */
async function finish(document: Document, options: OutlineOptions): Promise<void> {
  const generated = await generateOutline(document, 'cli', {
    ...(options.mode === undefined ? {} : { mode: options.mode }),
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.depth === undefined ? {} : { maxDepth: options.depth }),
    ...(options.maxChildren === undefined ? {} : { maxChildren: options.maxChildren }),
    ...(options.lang === undefined ? {} : { language: options.lang }),
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    ...(options.model === undefined ? {} : { model: options.model }),
  });

  if (generated.warning) report(options, generated.warning);
  if (options.md) process.stdout.write(generated.markdown);

  if (options.output !== undefined && extname(options.output) === '.md') {
    const path = await resolveOutputPath(options.output, generated.title, '.md');
    const written = await writeOutputFile(path, generated.markdown, {
      overwrite: options.overwrite ?? false,
    });
    describeOutline(options, generated);
    process.stdout.write(`${written.path}\n`);
    return;
  }

  // `--md` on its own is the one case where no file is written.
  if (options.md && options.output === undefined) {
    describeOutline(options, generated);
    return;
  }

  const written = await renderToFile(generated.markdown, generated.title, options);
  describeOutline(options, generated);
  process.stdout.write(`${written.path}\n`);
  if (options.open) openFile(written.path, options);
}

function describeOutline(options: OutlineOptions, generated: GeneratedOutline): void {
  report(
    options,
    `mode: ${generated.mode} · ${generated.stats.nodes} nodes · depth ${generated.stats.depth}` +
      (generated.stats.truncated ? ' · input truncated' : ''),
  );
}

function announce(options: RenderOptions, written: ExportResult, summary: string): void {
  report(options, `${summary} · ${Math.round(written.bytes / 1024)} KB`);
  process.stdout.write(`${written.path}\n`);
}

function renderToFile(
  markdown: string,
  title: string | undefined,
  options: RenderOptions,
): Promise<ExportResult> {
  return exportMindmap({
    markdown,
    ...(title === undefined ? {} : { title }),
    ...(options.output === undefined ? {} : { outputPath: options.output }),
    offline: options.offline,
    toolbar: options.toolbar,
    branding: options.branding ?? false,
    overwrite: options.overwrite ?? false,
  });
}

async function runDoctor(): Promise<void> {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const nodeOk = major > 22 || (major === 22 && minor >= 12);
  const env = llmEnv();
  const directory = resolveUserPath(outputDir());

  const lines = [
    `version     mindlm-mcp ${VERSION}`,
    `node        ${process.version} ${nodeOk ? '(ok)' : '(TOO OLD — needs >=22.12)'}`,
    env.hasKey
      ? `llm         configured: ${env.provider}${env.model ? `, model ${env.model}` : ', default model'}`
      : 'llm         not configured — zero-key mode',
    `auto mode   cli → ${env.hasKey ? 'llm' : 'heuristic'} · mcp → ${env.hasKey ? 'llm' : 'client'}`,
    `output dir  ${directory} (${await describeWritable(directory)})`,
  ];

  process.stdout.write(`${lines.join('\n')}\n`);
  if (!nodeOk) process.exitCode = 2;
}

/** Reports on the nearest existing ancestor: the directory itself is created on demand. */
async function describeWritable(directory: string): Promise<string> {
  let current = directory;
  for (let depth = 0; depth < 32; depth += 1) {
    try {
      await access(current, constants.W_OK);
      return current === directory ? 'writable' : 'will be created';
    } catch {
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return 'NOT WRITABLE';
}

async function readTextFile(file: string): Promise<string> {
  const path = resolveUserPath(file);
  try {
    return await readFile(path, 'utf8');
  } catch (cause) {
    const missing = (cause as { code?: string }).code === 'ENOENT';
    throw new MindlmError(
      'input',
      missing ? `No such file: ${path}` : `Could not read ${path}: ${describeError(cause)}`,
    );
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw usageError('Nothing on stdin.', 'Pipe text in, or pass a file path instead of "-".');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') throw usageError('stdin was empty.');
  return text;
}

/**
 * Hands the file to the platform's own opener. Detached and ignored, so the CLI
 * never waits on a browser; a failure is a note, not an error.
 */
function openFile(path: string, options: RenderOptions): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  const miss = () => report(options, `Could not open a browser. The file is at ${path}`);
  try {
    const child = spawn(command, [path], {
      detached: true,
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
    child.on('error', miss);
    child.unref();
  } catch {
    miss();
  }
}

function loadEnvFile(path: string | undefined): void {
  if (path === undefined) return;
  try {
    process.loadEnvFile(resolveUserPath(path));
  } catch (cause) {
    throw usageError(`Could not load env file ${path}: ${describeError(cause)}`);
  }
}

function parseIntOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new InvalidArgumentError('expected a number');
  return parsed;
}

function report(options: { quiet?: boolean }, message: string): void {
  if (!options.quiet) process.stderr.write(`${message}\n`);
}

/** The single place a thrown error becomes an exit code. */
async function withErrors(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    process.stderr.write(`${describeError(error)}\n`);
    process.exitCode = error instanceof MindlmError ? error.exitCode : 2;
  }
}

await buildProgram().parseAsync(process.argv);
