#!/usr/bin/env node
/**
 * Guards the one promise the Pages site makes about outbound links: every
 * mindlm.io URL under docs/ must be a plain, followable `<a href>` carrying the
 * github-pages campaign tag.
 *
 * Concretely, a link is only allowed if all of this holds:
 *   - it lives in the `href` of an `<a>` tag, not in text, a `<meta>` or a script;
 *   - the URL contains `utm_source=github-pages`;
 *   - the anchor has no `rel` with nofollow / sponsored / ugc, no `target`, and
 *     no inline event handler;
 *   - nothing redirects to mindlm.io via `<meta http-equiv="refresh">`,
 *     `window.location` or an `onclick`.
 *
 * Markdown under docs/ is checked too, but only for the campaign tag and for the
 * anchor rules above, since a Markdown link is plain by construction.
 *
 * Run it with `npm run check:links`. It scans docs/**\/*.html and docs/**\/*.md,
 * including the generated docs/demo/ when a build has produced it, prints what
 * it looked at, and exits non-zero on the first file with a violation.
 */

import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Matches an absolute or protocol-relative mindlm.io URL. Bare prose ("visit mindlm.io") is not a link. */
const URL_PATTERN = /(?:https?:)?\/\/(?:[a-z0-9-]+\.)*mindlm\.io(?:[/?#][^\s"'<>)\]]*)?/gi;
const REQUIRED_UTM = 'utm_source=github-pages';
const BANNED_REL = /\b(?:nofollow|sponsored|ugc)\b/i;
const HANDLER_ATTRIBUTE = /\son[a-z]+\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

export const RULES = [
  `every mindlm.io URL sits in a plain <a href> carrying ${REQUIRED_UTM}`,
  'no rel="nofollow" / "sponsored" / "ugc", no target, no inline handler',
  'no mindlm.io URL inside <script>/<style>, a <meta>, or a JS redirect',
];

// ---------------------------------------------------------------------------
// scanning
// ---------------------------------------------------------------------------

/** Every mindlm.io URL in `text`, with the offset it starts at. */
export function findUrls(text) {
  URL_PATTERN.lastIndex = 0;
  return [...text.matchAll(URL_PATTERN)].map((match) => ({ url: match[0], index: match.index }));
}

/** The body ranges of `<tag>…</tag>`, excluding the tags themselves. */
function bodyRanges(text, tag) {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, 'gi');
  return [...text.matchAll(pattern)].map((match) => {
    const bodyStart = match.index + match[0].indexOf('>') + 1;
    return [bodyStart, bodyStart + match[1].length];
  });
}

/**
 * Attributes of one tag, keyed by lower-case name, each with the absolute
 * offsets of its value so a URL can be attributed to the attribute holding it.
 */
function parseAttributes(source, offset) {
  const pattern = /([a-zA-Z_:][-\w:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const attributes = new Map();
  for (const match of source.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (attributes.has(name)) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    const local = value === '' ? match[0].length : match[0].indexOf(value, match[1].length);
    attributes.set(name, {
      value,
      start: offset + match.index + local,
      end: offset + match.index + local + value.length,
    });
  }
  return attributes;
}

/** Every `<a …>` opening tag, with its parsed attributes. */
function findAnchors(text) {
  return [...text.matchAll(/<a\b([^>]*)>/gi)].map((match) => ({
    index: match.index,
    // +2 skips "<a", which is where the attribute text begins.
    attributes: parseAttributes(match[1], match.index + 2),
  }));
}

// ---------------------------------------------------------------------------
// rules
// ---------------------------------------------------------------------------

function anchorProblems(text, claimed, problems) {
  for (const anchor of findAnchors(text)) {
    const href = anchor.attributes.get('href');
    if (!href || findUrls(href.value).length === 0) continue;
    claimed.push([href.start, href.end]);

    if (!href.value.includes(REQUIRED_UTM)) {
      problems.push({
        index: anchor.index,
        rule: 'utm',
        message: `link to mindlm.io is missing ${REQUIRED_UTM}: ${href.value}`,
      });
    }
    const rel = anchor.attributes.get('rel');
    if (rel && BANNED_REL.test(rel.value)) {
      problems.push({
        index: anchor.index,
        rule: 'rel',
        message: `link to mindlm.io has rel="${rel.value}" — nofollow/sponsored/ugc are not allowed here`,
      });
    }
    if (anchor.attributes.has('target')) {
      problems.push({
        index: anchor.index,
        rule: 'target',
        message: 'link to mindlm.io sets target — the Pages links must be plain <a href>',
      });
    }
  }
}

/** Checks a full HTML document. Returns a (possibly empty) list of problems. */
export function checkHtml(text) {
  const problems = [];
  /** Ranges already explained by a rule above; anything left over is a bare URL. */
  const claimed = [];

  for (const [start, end] of [...bodyRanges(text, 'script'), ...bodyRanges(text, 'style')]) {
    claimed.push([start, end]);
    for (const { url, index } of findUrls(text.slice(start, end))) {
      problems.push({
        index: start + index,
        rule: 'script',
        message: `mindlm.io URL inside a <script>/<style> block (scripted redirects do not count as links): ${url}`,
      });
    }
  }

  HANDLER_ATTRIBUTE.lastIndex = 0;
  for (const match of text.matchAll(HANDLER_ATTRIBUTE)) {
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    claimed.push([match.index, match.index + match[0].length]);
    if (findUrls(value).length > 0) {
      problems.push({
        index: match.index,
        rule: 'handler',
        message: `mindlm.io URL inside an inline event handler:${match[0].trim().slice(0, 60)}`,
      });
    }
  }

  for (const match of text.matchAll(/<meta\b[^>]*>/gi)) {
    if (findUrls(match[0]).length === 0) continue;
    claimed.push([match.index, match.index + match[0].length]);
    const refresh = /http-equiv\s*=\s*["']?refresh/i.test(match[0]);
    problems.push({
      index: match.index,
      rule: refresh ? 'meta-refresh' : 'meta',
      message: refresh
        ? 'a <meta http-equiv="refresh"> redirects to mindlm.io'
        : `mindlm.io URL in a <meta> tag rather than an <a href>: ${match[0].slice(0, 80)}`,
    });
  }

  anchorProblems(text, claimed, problems);

  for (const { url, index } of findUrls(text)) {
    if (claimed.some(([start, end]) => index >= start && index < end)) continue;
    problems.push({
      index,
      rule: 'not-a-link',
      message: `mindlm.io URL that is not the href of an <a> tag: ${url}`,
    });
  }

  return problems.sort((a, b) => a.index - b.index);
}

/** Checks Markdown. A `[text](url)` link is plain already, so only the tag and raw HTML matter. */
export function checkMarkdown(text) {
  const problems = [];
  for (const { url, index } of findUrls(text)) {
    if (url.includes(REQUIRED_UTM)) continue;
    problems.push({
      index,
      rule: 'utm',
      message: `link to mindlm.io is missing ${REQUIRED_UTM}: ${url}`,
    });
  }
  anchorProblems(text, [], problems);
  return problems.sort((a, b) => a.index - b.index);
}

export function checkSource(path, text) {
  return extname(path).toLowerCase() === '.md' ? checkMarkdown(text) : checkHtml(text);
}

export function lineOf(text, index) {
  let line = 1;
  for (let at = text.indexOf('\n'); at !== -1 && at < index; at = text.indexOf('\n', at + 1)) {
    line += 1;
  }
  return line;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const CHECKED_EXTENSIONS = new Set(['.html', '.htm', '.md']);

async function collect(directory) {
  const found = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return found;
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await collect(path)));
    else if (CHECKED_EXTENSIONS.has(extname(entry.name).toLowerCase())) found.push(path);
  }
  return found;
}

async function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const docs = join(root, 'docs');
  const files = await collect(docs);

  if (files.length === 0) {
    console.error(
      `check-pages-links: no HTML or Markdown found under ${relative(root, docs)}${sep}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`check-pages-links: ${files.length} file(s) under docs/`);
  for (const rule of RULES) console.log(`  rule · ${rule}`);
  console.log('');

  let failures = 0;
  for (const file of files) {
    const name = relative(root, file);
    const text = await readFile(file, 'utf8');
    const links = findUrls(text);
    const problems = checkSource(file, text);
    failures += problems.length;

    const count = `${links.length} mindlm.io link(s)`;
    console.log(`  ${problems.length === 0 ? 'ok  ' : 'FAIL'} ${name} — ${count}`);
    for (const problem of problems) {
      console.log(
        `       ${name}:${lineOf(text, problem.index)} [${problem.rule}] ${problem.message}`,
      );
    }
  }

  console.log('');
  if (failures > 0) {
    console.error(`check-pages-links: ${failures} violation(s).`);
    process.exitCode = 1;
    return;
  }
  console.log('check-pages-links: no violations.');
}

// Only run when invoked directly; the unit test imports the functions above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
