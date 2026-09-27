/**
 * Where an export lands on disk. Shared by the MCP `export_mindmap` tool and by
 * every CLI command that writes a file, so the naming, the overwrite rule and
 * the returned metadata are identical in both.
 */

import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveUserPath } from '../extract/pdf.js';
import { outputDir } from '../util/env.js';
import { outputError } from '../util/errors.js';

export interface WriteResult {
  path: string;
  fileUrl: string;
  bytes: number;
}

/**
 * A file-name-safe slug. Letters and digits of any script survive, so a Chinese
 * title stays readable instead of collapsing to "mindmap".
 */
export function slugify(title: string, maxLength = 48): string {
  const slug = title
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, maxLength)
    .replace(/-+$/, '');
  return slug === '' ? 'mindmap' : slug;
}

/** Local time, `YYYYMMDD-HHmmss` — sortable and unambiguous in a directory listing. */
export function timestamp(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

export function defaultFileName(title: string, extension = '.html'): string {
  return `${slugify(title)}-${timestamp()}${extension}`;
}

/**
 * Resolves the destination. A path ending in a separator, or pointing at an
 * existing directory, is treated as a directory and gets a generated name;
 * anything else is taken literally.
 */
export async function resolveOutputPath(
  requested: string | undefined,
  title: string,
  extension = '.html',
): Promise<string> {
  if (requested === undefined || requested.trim() === '') {
    // MINDMAP_OUTPUT_DIR is often written as "~/Documents/mindmaps".
    return join(resolveUserPath(outputDir()), defaultFileName(title, extension));
  }

  const raw = requested.trim();
  const path = resolveUserPath(raw);

  if (raw.endsWith('/') || raw.endsWith('\\') || extname(path) === '') {
    return join(path, defaultFileName(title, extension));
  }
  if (await isDirectory(path)) {
    return join(path, defaultFileName(title, extension));
  }
  return path;
}

export interface WriteOptions {
  overwrite?: boolean;
}

/** Creates the parent directory, refuses to clobber unless told to, then writes. */
export async function writeOutputFile(
  path: string,
  contents: string,
  options: WriteOptions = {},
): Promise<WriteResult> {
  const target = isAbsolute(path) ? path : resolve(path);

  if (!(options.overwrite ?? false) && (await exists(target))) {
    throw outputError(
      `${target} already exists.`,
      'Pass overwrite (--overwrite) to replace it, or choose another path.',
    );
  }

  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, 'utf8');
  } catch (cause) {
    throw outputError(`Could not write ${target}: ${messageOf(cause)}`);
  }

  return {
    path: target,
    fileUrl: pathToFileURL(target).href,
    bytes: Buffer.byteLength(contents, 'utf8'),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
