/**
 * The Pages link rules exist to protect something a reviewer cannot see by
 * reading the HTML once: that no later edit quietly turns the one outbound link
 * into a nofollow, a script redirect or an untagged URL. So the checker itself
 * gets tests.
 *
 * Plain JavaScript on purpose — it imports the .mjs script the CI job runs,
 * rather than a TypeScript copy of it that could drift.
 */

import { describe, expect, it } from 'vitest';
import {
  checkHtml,
  checkMarkdown,
  checkSource,
  findUrls,
  lineOf,
} from '../../scripts/check-pages-links.mjs';

const GOOD_URL =
  'https://mindlm.io/?utm_source=github-pages&utm_medium=referral&utm_campaign=mindlm-mcp';

const GOOD_PAGE = `<!doctype html>
<html lang="en">
<head><title>mindlm-mcp</title></head>
<body>
  <h2>Want a full editor?</h2>
  <p>That is what <a href="${GOOD_URL}">mindlm.io</a> is for.</p>
  <p>Source on <a href="https://github.com/qingchejun/mindlm-io">GitHub</a>.</p>
</body>
</html>`;

/** Returns the rule names reported for a document, which is what each case asserts on. */
function rules(problems) {
  return problems.map((problem) => problem.rule);
}

describe('findUrls', () => {
  it('finds absolute and protocol-relative URLs', () => {
    const found = findUrls(`a ${GOOD_URL} b //mindlm.io/pricing c http://www.mindlm.io/x`);
    expect(found.map((hit) => hit.url)).toEqual([
      GOOD_URL,
      '//mindlm.io/pricing',
      'http://www.mindlm.io/x',
    ]);
  });

  it('ignores bare prose, so anchor text may say the name', () => {
    expect(findUrls('<a href="/x">mindlm.io</a> is a website')).toEqual([]);
  });

  it('does not match a lookalike domain', () => {
    expect(findUrls('https://notmindlm.iowa.example/')).toEqual([]);
  });
});

describe('checkHtml — the page we actually ship', () => {
  it('accepts a plain, tagged, followable link', () => {
    expect(checkHtml(GOOD_PAGE)).toEqual([]);
  });

  it('accepts an href written with HTML entities', () => {
    const entity = GOOD_PAGE.replace(GOOD_URL, GOOD_URL.replaceAll('&', '&amp;'));
    expect(checkHtml(entity)).toEqual([]);
  });

  it('accepts single-quoted attributes', () => {
    expect(checkHtml(`<p><a href='${GOOD_URL}'>mindlm.io</a></p>`)).toEqual([]);
  });
});

describe('checkHtml — violations', () => {
  it('rejects a missing campaign tag', () => {
    const problems = checkHtml('<a href="https://mindlm.io/">mindlm.io</a>');
    expect(rules(problems)).toEqual(['utm']);
    expect(problems[0].message).toContain('utm_source=github-pages');
  });

  it('rejects the wrong campaign tag', () => {
    expect(rules(checkHtml(`<a href="https://mindlm.io/?utm_source=github">x</a>`))).toEqual([
      'utm',
    ]);
  });

  it.each(['nofollow', 'sponsored', 'ugc', 'noopener nofollow'])('rejects rel="%s"', (rel) => {
    expect(rules(checkHtml(`<a rel="${rel}" href="${GOOD_URL}">mindlm.io</a>`))).toEqual(['rel']);
  });

  it('accepts a rel that is merely noisy', () => {
    expect(checkHtml(`<a rel="noopener" href="${GOOD_URL}">mindlm.io</a>`)).toEqual([]);
  });

  it('rejects target, because a plain link has none', () => {
    expect(rules(checkHtml(`<a target="_blank" href="${GOOD_URL}">mindlm.io</a>`))).toEqual([
      'target',
    ]);
  });

  it('reports every broken rule on one anchor', () => {
    const bad = '<a rel="nofollow" target="_blank" href="https://mindlm.io/">mindlm.io</a>';
    expect(rules(checkHtml(bad)).sort()).toEqual(['rel', 'target', 'utm']);
  });

  it('rejects a URL inside a script', () => {
    const page = `<script>const site = "${GOOD_URL}";</script>`;
    expect(rules(checkHtml(page))).toEqual(['script']);
  });

  it('rejects a scripted redirect', () => {
    const page = `<script>\nwindow.location.href = "${GOOD_URL}";\n</script>`;
    const problems = checkHtml(page);
    expect(rules(problems)).toEqual(['script']);
    expect(lineOf(page, problems[0].index)).toBe(2);
  });

  it('rejects a URL inside a stylesheet', () => {
    expect(rules(checkHtml(`<style>a::after{content:"${GOOD_URL}"}</style>`))).toEqual(['script']);
  });

  it('rejects an inline event handler', () => {
    const page = `<button onclick="location.href='${GOOD_URL}'">Go</button>`;
    expect(rules(checkHtml(page))).toEqual(['handler']);
  });

  it('rejects a handler on the anchor itself', () => {
    const page = `<a onclick="location='${GOOD_URL}'" href="${GOOD_URL}">mindlm.io</a>`;
    expect(rules(checkHtml(page))).toEqual(['handler']);
  });

  it('rejects a meta refresh', () => {
    const page = `<meta http-equiv="refresh" content="0; url=${GOOD_URL}">`;
    expect(rules(checkHtml(page))).toEqual(['meta-refresh']);
  });

  it('rejects the URL hiding in other metadata', () => {
    expect(rules(checkHtml(`<meta property="og:url" content="${GOOD_URL}">`))).toEqual(['meta']);
  });

  it('rejects a bare URL in body text', () => {
    const problems = checkHtml(`<p>See ${GOOD_URL} for more.</p>`);
    expect(rules(problems)).toEqual(['not-a-link']);
    expect(problems[0].message).toContain('not the href of an <a> tag');
  });

  it('rejects a link built with something other than an anchor', () => {
    expect(rules(checkHtml(`<link rel="canonical" href="${GOOD_URL}">`))).toEqual(['not-a-link']);
  });

  it('counts each offending link once', () => {
    const page = `<p><a href="https://mindlm.io/a">one</a> and <a href="https://mindlm.io/b">two</a></p>`;
    expect(rules(checkHtml(page))).toEqual(['utm', 'utm']);
  });

  it('reports problems in document order', () => {
    const page = `<a href="https://mindlm.io/first">a</a>\n<a target="_self" href="${GOOD_URL}">b</a>`;
    expect(rules(checkHtml(page))).toEqual(['utm', 'target']);
  });
});

describe('checkMarkdown', () => {
  it('accepts a tagged Markdown link', () => {
    expect(checkMarkdown(`See [mindlm.io](${GOOD_URL}) for the editor.`)).toEqual([]);
  });

  it('rejects an untagged one', () => {
    expect(rules(checkMarkdown('See [mindlm.io](https://mindlm.io/) for the editor.'))).toEqual([
      'utm',
    ]);
  });

  it('still applies the anchor rules to raw HTML in Markdown', () => {
    expect(rules(checkMarkdown(`<a rel="nofollow" href="${GOOD_URL}">mindlm.io</a>`))).toEqual([
      'rel',
    ]);
  });

  it('accepts a file that never mentions the site', () => {
    expect(checkMarkdown('# Launch checklist\n\nNothing here yet.\n')).toEqual([]);
  });
});

describe('checkSource', () => {
  it('reads Markdown rules for .md and HTML rules for everything else', () => {
    const bare = `See ${GOOD_URL}`;
    // A bare URL is a plain-text link in Markdown and a broken one in HTML.
    expect(checkSource('docs/launch.md', bare)).toEqual([]);
    expect(rules(checkSource('docs/index.html', bare))).toEqual(['not-a-link']);
  });
});

describe('lineOf', () => {
  it('is 1-based and counts newlines before the offset', () => {
    const text = 'a\nb\nc';
    expect(lineOf(text, 0)).toBe(1);
    expect(lineOf(text, 2)).toBe(2);
    expect(lineOf(text, 4)).toBe(3);
  });
});
