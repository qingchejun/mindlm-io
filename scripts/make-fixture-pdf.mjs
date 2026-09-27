#!/usr/bin/env node
/**
 * Writes the PDF fixtures used by the tests:
 *
 *   test/fixtures/sample.pdf   three pages, numbered headings, two bookmarks
 *                              whose titles match heading lines on the pages
 *   test/fixtures/wrapped.pdf  a "print to PDF" of an article: no bookmarks, the
 *                              title printed again on page 1, and every
 *                              paragraph broken into soft-wrapped visual lines
 *
 * Hand-assembling them keeps each fixture a few kilobytes and free of any tool
 * watermark or metadata we would not want in the repo. Re-run after editing:
 *   node scripts/make-fixture-pdf.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = join(dirname(dirname(fileURLToPath(import.meta.url))), 'test/fixtures');

/** A three-page report with real bookmarks. */
const SAMPLE = {
  file: 'sample.pdf',
  title: 'mindlm-mcp PDF fixture',
  bookmarks: ['1. Introduction', '2. Methods'],
  pages: [
    {
      heading: '1. Introduction',
      body: [
        'Mind maps turn a wall of prose into something you can scan in one glance,',
        'which is exactly what a reader needs when the source runs to many pages.',
        'This fixture exists so the PDF extractor can be tested without shipping a',
        'multi-megabyte sample document in the repository.',
      ],
    },
    {
      heading: '2. Methods',
      body: [
        'Text is pulled page by page, then the lines are classified: numbered or',
        'short lines become headings and everything else becomes a paragraph.',
        'Bookmarks, when the document has them, override that guess entirely.',
        'The outline generator only ever sees the resulting block structure.',
      ],
    },
    {
      heading: '2.1 Limits',
      body: [
        'Scanned documents have no text layer at all, so they are rejected with a',
        'clear error rather than silently producing an empty mind map.',
        'Optical character recognition is out of scope for this tool.',
      ],
    },
  ],
};

/**
 * A browser print-to-PDF: the document title is printed as the first line of
 * page 1 (so it arrives twice, once from the metadata and once as a heading),
 * there are no bookmarks, and each paragraph is a run of wrapped lines that stop
 * mid-sentence. Extracting this without rejoining the lines yields fragments
 * like "energy." or "releases oxygen." instead of sentences.
 */
const WRAPPED = {
  file: 'wrapped.pdf',
  title: 'Photosynthesis: A Short Primer',
  bookmarks: [],
  pages: [
    {
      heading: 'Photosynthesis: A Short Primer',
      body: [
        '1. Overview',
        'Photosynthesis is the process by which green plants and algae convert light',
        'energy into the chemical energy held in sugars. It draws in carbon dioxide',
        'and water, stores what it needs as glucose, and releases the rest as',
        'oxygen. Almost every food chain on the planet starts here.',
        '2. Inputs and outputs',
        'The reaction takes six molecules of carbon dioxide and six of water and',
        'rearranges them, with the help of sunlight caught by chlorophyll, into',
        'glucose. Six molecules of oxygen leave the leaf as a by-product.',
      ],
    },
    {
      heading: '3. Why it matters',
      body: [
        'Every gram of sugar a plant stores is energy that something else will',
        'eventually eat, which is why the productivity of a forest or an ocean is',
        'measured in carbon fixed per year.',
        'The same reaction is what keeps atmospheric oxygen where it is, and it is',
        'the reason a warming ocean with less plankton in it is a problem far',
        'beyond the plankton.',
      ],
    },
  ],
};

/** Escapes a PDF literal string. */
function pdfString(text) {
  return `(${text.replace(/[\\()]/g, (char) => `\\${char}`)})`;
}

function contentStream({ heading, body }) {
  const lines = [
    'BT',
    '/F1 18 Tf',
    '72 720 Td',
    '22 TL',
    `${pdfString(heading)} Tj`,
    'ET',
    'BT',
    '/F1 11 Tf',
    '72 684 Td',
    '16 TL',
  ];
  body.forEach((line, index) => {
    if (index > 0) lines.push('T*');
    lines.push(`${pdfString(line)} Tj`);
  });
  lines.push('ET');
  return lines.join('\n');
}

function build({ title, pages, bookmarks }) {
  /** 1-based object bodies; index 0 is object 1. */
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };

  // Reserve well-known numbers so cross references can be written up front.
  const CATALOG = 1;
  const PAGES_NODE = 2;
  const FONT = 3;
  const OUTLINES = 4;
  const FIRST_BOOKMARK = 5;
  const FIRST_PAGE = FIRST_BOOKMARK + bookmarks.length;
  const INFO = FIRST_PAGE + pages.length * 2;

  const pageRefs = pages.map((_page, index) => FIRST_PAGE + index * 2);
  const bookmarkRefs = bookmarks.map((_entry, index) => FIRST_BOOKMARK + index);

  add(
    `<< /Type /Catalog /Pages ${PAGES_NODE} 0 R /Outlines ${OUTLINES} 0 R /PageMode /UseOutlines >>`,
  );
  add(
    `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add(
    bookmarks.length === 0
      ? '<< /Type /Outlines /Count 0 >>'
      : `<< /Type /Outlines /First ${bookmarkRefs[0]} 0 R /Last ${bookmarkRefs.at(-1)} 0 R ` +
          `/Count ${bookmarks.length} >>`,
  );

  bookmarks.forEach((entry, index) => {
    const previous = bookmarkRefs[index - 1];
    const next = bookmarkRefs[index + 1];
    add(
      `<< /Title ${pdfString(entry)} /Parent ${OUTLINES} 0 R ` +
        (previous === undefined ? '' : `/Prev ${previous} 0 R `) +
        (next === undefined ? '' : `/Next ${next} 0 R `) +
        `/Dest [${pageRefs[Math.min(index, pageRefs.length - 1)]} 0 R /XYZ 72 792 0] >>`,
    );
  });

  for (const page of pages) {
    const contents = contentStream(page);
    const contentRef = objects.length + 2; // this page is next, its stream follows
    add(
      `<< /Type /Page /Parent ${PAGES_NODE} 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${FONT} 0 R >> >> /Contents ${contentRef} 0 R >>`,
    );
    add(`<< /Length ${Buffer.byteLength(contents, 'latin1')} >>\nstream\n${contents}\nendstream`);
  }

  add(`<< /Title ${pdfString(title)} /Producer (scripts/make-fixture-pdf.mjs) >>`);

  // Serialize with a classic cross-reference table.
  let pdf = '%PDF-1.4\n%âãÏÓ\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const startXref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${CATALOG} 0 R /Info ${INFO} 0 R >>\n`;
  pdf += `startxref\n${startXref}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

await mkdir(FIXTURES, { recursive: true });
for (const fixture of [SAMPLE, WRAPPED]) {
  const bytes = build(fixture);
  const path = join(FIXTURES, fixture.file);
  await writeFile(path, bytes);
  console.log(`wrote ${path} (${bytes.byteLength} bytes)`);
}
