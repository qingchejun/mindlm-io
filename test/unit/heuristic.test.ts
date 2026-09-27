import { describe, expect, it } from 'vitest';
import { textToDocument } from '../../src/extract/text.js';
import { heuristicOutline, rankSentences, termFrequencies } from '../../src/outline/heuristic.js';
import { countNodes, outlineDepth, outlineToMarkdown } from '../../src/outline/normalize.js';

const ENGLISH_ARTICLE = `
Mind mapping is a way of laying information out so that structure is visible at a glance.
A reader who is handed twelve paragraphs of prose has to build that structure themselves.

Outlines are the intermediate form. An outline names the sections, then names what each
section actually claims, and stops there. Anything more detailed belongs in the source.

Automatic outlining has two honest strategies. The first is to trust the document's own
headings, which is reliable whenever the author bothered to write them. The second is to
infer sections from paragraph boundaries, which is a guess but a stable one.

Rendering is the easy part. A mind map is a tree, and a tree of short labels can be drawn
with no layout engine beyond a few hundred lines of code.
`;

const CHINESE_ARTICLE = `
思维导图的价值在于结构可见。读者拿到一段长文本时，需要自己在脑子里重建结构。

大纲是中间形态。大纲先给出章节名，再给出每个章节真正主张的内容，到此为止。

自动生成大纲有两种可靠做法。第一种是相信文档本身的标题层级。第二种是从段落边界推断章节。

渲染是最简单的一步。思维导图本质上是一棵树，短标签构成的树不需要复杂的排版引擎。
`;

describe('heuristicOutline with headings', () => {
  const markdown = [
    '# Deployment guide',
    '',
    '## Prerequisites',
    '',
    'You need Node 22 or newer. Older versions are out of support.',
    '',
    '- a package manager',
    '- write access to the output directory',
    '',
    '## Steps',
    '',
    '### Build',
    '',
    'Run the build once before publishing anything.',
  ].join('\n');

  it('uses the document structure as the tree', () => {
    const outline = heuristicOutline(textToDocument(markdown));

    expect(outline.title).toBe('Deployment guide');
    expect(outline.children.map((child) => child.text)).toEqual(['Prerequisites', 'Steps']);
    expect(outline.children[0]?.children.map((child) => child.text)).toEqual([
      'You need Node 22 or newer.',
      'a package manager',
      'write access to the output directory',
    ]);
    expect(outline.children[1]?.children[0]?.text).toBe('Build');
  });

  it('honours maxDepth', () => {
    const outline = heuristicOutline(textToDocument(markdown), { maxDepth: 2 });
    expect(outlineDepth(outline)).toBe(2);
    expect(outline.children.map((child) => child.text)).toEqual(['Prerequisites', 'Steps']);
  });

  it('collapses the extra children of a wide node', () => {
    const wide = ['# T', '', '## S', '', ...['a', 'b', 'c', 'd', 'e'].map((x) => `- ${x}`)].join(
      '\n',
    );
    const outline = heuristicOutline(textToDocument(wide), { maxChildren: 3 });
    expect(outline.children[0]?.children.map((child) => child.text)).toEqual([
      'a',
      'b',
      'c',
      '…(+2)',
    ]);
  });

  it('accepts an explicit title override', () => {
    expect(heuristicOutline(textToDocument(markdown), { title: 'Custom' }).title).toBe('Custom');
  });
});

describe('heuristicOutline without headings', () => {
  it('builds sections from English prose', () => {
    const outline = heuristicOutline(textToDocument(ENGLISH_ARTICLE));

    expect(outline.title).toMatch(/^Mind mapping is a way/);
    expect(outline.children.length).toBeGreaterThanOrEqual(2);
    expect(outline.children.length).toBeLessThanOrEqual(9);
    // root → section → key sentence
    expect(outlineDepth(outline)).toBe(3);
    expect(countNodes(outline)).toBeGreaterThan(3);
    for (const child of outline.children) {
      expect(child.text.length).toBeGreaterThan(0);
    }
  });

  it('builds sections from Chinese prose', () => {
    const outline = heuristicOutline(textToDocument(CHINESE_ARTICLE));

    expect(outline.title).toContain('思维导图');
    expect(outline.children.length).toBeGreaterThanOrEqual(2);
    // CJK labels are trimmed to roughly 40 characters.
    for (const child of outline.children) {
      expect([...child.text].length).toBeLessThanOrEqual(41);
    }
  });

  it('is deterministic', () => {
    const first = outlineToMarkdown(heuristicOutline(textToDocument(ENGLISH_ARTICLE)));
    const second = outlineToMarkdown(heuristicOutline(textToDocument(ENGLISH_ARTICLE)));
    expect(first).toBe(second);
  });

  it('never throws on degenerate input', () => {
    expect(heuristicOutline(textToDocument(''))).toEqual({ title: 'Mind map', children: [] });
    expect(heuristicOutline(textToDocument('one')).title).toBe('one');
    // A document that is one sentence long becomes its own title and nothing else.
    expect(heuristicOutline(textToDocument('Only one sentence here.')).children).toEqual([]);
  });

  it('branches as soon as there is a second sentence', () => {
    const outline = heuristicOutline(textToDocument('First sentence here. Second sentence here.'));
    expect(outline.title).toBe('First sentence here.');
    expect(outline.children.map((child) => child.text)).toEqual(['Second sentence here.']);
  });
});

describe('rankSentences', () => {
  it('prefers sentences carrying frequent terms', () => {
    const frequencies = termFrequencies('outline outline outline mindmap mindmap weather');
    const ranked = rankSentences(
      ['Nothing much happened today.', 'The outline and the mindmap agree on the outline.'],
      frequencies,
    );
    expect(ranked[0]).toBe('The outline and the mindmap agree on the outline.');
  });

  it('keeps the original order when nothing scores', () => {
    expect(rankSentences(['a', 'b'], new Map())).toEqual(['a', 'b']);
  });

  it('returns an empty list for no sentences', () => {
    expect(rankSentences([], new Map())).toEqual([]);
  });
});

describe('termFrequencies', () => {
  it('counts tokens and ignores single characters', () => {
    const counts = termFrequencies('alpha alpha beta a');
    expect(counts.get('alpha')).toBe(2);
    expect(counts.get('beta')).toBe(1);
    expect(counts.has('a')).toBe(false);
  });
});
