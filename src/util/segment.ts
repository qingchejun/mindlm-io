/**
 * Sentence/word segmentation built on the runtime's own ICU data via
 * `Intl.Segmenter`. Node 22 official builds ship full-icu, so this handles CJK
 * and Latin scripts without pulling in an NLP dependency.
 */

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/u;

let sentenceSegmenter: Intl.Segmenter | undefined;
let wordSegmenter: Intl.Segmenter | undefined;

function sentences(): Intl.Segmenter {
  sentenceSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'sentence' });
  return sentenceSegmenter;
}

function words(): Intl.Segmenter {
  wordSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'word' });
  return wordSegmenter;
}

/** True when the text is predominantly CJK, which changes length budgets. */
export function isCjk(text: string): boolean {
  const sample = text.slice(0, 400);
  if (!CJK.test(sample)) return false;
  let cjk = 0;
  let letters = 0;
  for (const ch of sample) {
    if (CJK.test(ch)) cjk += 1;
    if (/\p{L}/u.test(ch)) letters += 1;
  }
  return letters > 0 && cjk / letters > 0.3;
}

/**
 * Splits into sentences. `Intl.Segmenter` keeps trailing whitespace inside each
 * segment, so every piece is trimmed and empties are dropped.
 */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized === '') return [];
  const out: string[] = [];
  for (const { segment } of sentences().segment(normalized)) {
    const piece = segment.trim();
    if (piece !== '') out.push(piece);
  }
  return out.length > 0 ? out : [normalized];
}

/** The first sentence, or the whole (normalized) text when it has just one. */
export function firstSentence(text: string): string {
  return splitSentences(text)[0] ?? '';
}

/** Word-like tokens, lowercased. Used for the keyword scoring in the heuristic. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const part of words().segment(text)) {
    if (!part.isWordLike) continue;
    const token = part.segment.toLowerCase();
    if (token.trim() !== '') out.push(token);
  }
  return out;
}

export function countWords(text: string): number {
  return tokenize(text).length;
}

/**
 * Trims a node label to roughly one glance: ~40 characters for CJK, ~12 words
 * for space-separated scripts. Cuts on a token boundary when possible.
 */
export function shortenLabel(
  text: string,
  options: { cjkChars?: number; words?: number } = {},
): string {
  const label = text.replace(/\s+/g, ' ').trim();
  if (label === '') return '';

  if (isCjk(label)) {
    const limit = options.cjkChars ?? 40;
    const chars = [...label];
    if (chars.length <= limit) return label;
    return `${chars
      .slice(0, limit)
      .join('')
      .replace(/[\s，,、。；;：:]+$/u, '')}…`;
  }

  const limit = options.words ?? 12;
  const parts = label.split(' ');
  if (parts.length <= limit) return label;
  return `${parts
    .slice(0, limit)
    .join(' ')
    .replace(/[\s,;:.]+$/u, '')}…`;
}
