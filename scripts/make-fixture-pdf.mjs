#!/usr/bin/env node
/**
 * Writes test/fixtures/sample.pdf: a hand-assembled, three-page PDF with a real
 * text layer (Helvetica, no embedded font data), numbered headings and two
 * bookmarks whose titles match heading lines on the pages.
 *
 * Hand-assembling it keeps the fixture a few kilobytes and free of any tool
 * watermark or metadata we would not want in the repo. Re-run after editing:
 *   node scripts/make-fixture-pdf.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(dirname(fileURLToPath(import.meta.url))), 'test/fixtures/sample.pdf');

const PAGES = [
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
];

const BOOKMARKS = ['1. Introduction', '2. Methods'];

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

function build() {
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
  const SECOND_BOOKMARK = 6;
  const FIRST_PAGE = 7;
  const INFO = FIRST_PAGE + PAGES.length * 2;

  const pageRefs = PAGES.map((_page, index) => FIRST_PAGE + index * 2);

  add(
    `<< /Type /Catalog /Pages ${PAGES_NODE} 0 R /Outlines ${OUTLINES} 0 R /PageMode /UseOutlines >>`,
  );
  add(
    `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(' ')}] /Count ${PAGES.length} >>`,
  );
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add(
    `<< /Type /Outlines /First ${FIRST_BOOKMARK} 0 R /Last ${SECOND_BOOKMARK} 0 R /Count ${BOOKMARKS.length} >>`,
  );
  add(
    `<< /Title ${pdfString(BOOKMARKS[0])} /Parent ${OUTLINES} 0 R /Next ${SECOND_BOOKMARK} 0 R /Dest [${pageRefs[0]} 0 R /XYZ 72 792 0] >>`,
  );
  add(
    `<< /Title ${pdfString(BOOKMARKS[1])} /Parent ${OUTLINES} 0 R /Prev ${FIRST_BOOKMARK} 0 R /Dest [${pageRefs[1]} 0 R /XYZ 72 792 0] >>`,
  );

  for (const page of PAGES) {
    const contents = contentStream(page);
    const contentRef = objects.length + 2; // this page is next, its stream follows
    add(
      `<< /Type /Page /Parent ${PAGES_NODE} 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${FONT} 0 R >> >> /Contents ${contentRef} 0 R >>`,
    );
    add(`<< /Length ${Buffer.byteLength(contents, 'latin1')} >>\nstream\n${contents}\nendstream`);
  }

  add('<< /Title (mindlm-mcp PDF fixture) /Producer (scripts/make-fixture-pdf.mjs) >>');

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

const bytes = build();
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, bytes);
console.log(`wrote ${OUT} (${bytes.byteLength} bytes)`);
