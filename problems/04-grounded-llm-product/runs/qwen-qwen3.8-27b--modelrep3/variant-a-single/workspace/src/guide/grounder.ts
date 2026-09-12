import type { WikiSource } from './guide.types.js';

/**
 * Sentence-level grounding gate for the gameplay assistant.
 *
 * A sentence is grounded only if every detectable factual claim in it is
 * present in the provided wiki pages:
 *   1. quantity claims ("5 ember shards") must match number + unit words in a source,
 *   2. proper-noun claims ("Duskfang Warden") must appear in a source,
 *   3. at least half of the sentence's content words must appear in a source.
 *
 * The gate is a deterministic heuristic, not an NLP model: it catches invented
 * names and wrong quantities exactly, and filters sentences whose vocabulary
 * has no overlap with the sources. It is deliberately strict: a sentence that
 * cannot be verified is dropped, never kept.
 */

export interface GroundingVerdict {
  grounded: boolean;
  /** Why the sentence failed the gate; empty when grounded. */
  reasons: string[];
}

export interface QuantityClaim {
  /** Original claim text, e.g. "5 ember shards". */
  raw: string;
  /** Normalized value, e.g. "5" (word numbers normalized to digits). */
  number: string;
  /** Original numeric token, e.g. "five". */
  numberRaw: string;
  /** Unit words after the number, cleaned, e.g. ["ember", "shards"]. */
  unit: string[];
  /** Same unit words in original casing, used for redaction display. */
  unitRaw: string[];
}

export interface ProperNounClaim {
  /** Original phrase, e.g. "Duskfang Warden". */
  phrase: string;
  /** Cleaned words, e.g. ["duskfang", "warden"]. */
  words: string[];
  /** Token span in the sentence (end exclusive). */
  start: number;
  end: number;
}

const WORD_NUMBERS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
  eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13',
  fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18',
  nineteen: '19', twenty: '20',
};

const TOKEN_SPLIT = /[^A-Za-z0-9'\u2019-]+/;
const CAPITAL_TOKEN = /^[A-Z][A-Za-z'\u2019-]*$/;
const WORD_TOKEN = /^[A-Za-z][A-Za-z'\u2019-]*$/;
const BARE_NUMBER = /^[0-9]+(?:\.[0-9]+)?$/;

/** Lowercase, strip possessive 's, normalize word numbers to digits. */
export function cleanToken(token: string): string {
  let t = token.toLowerCase();
  if (t.endsWith("'s")) t = t.slice(0, -2);
  return WORD_NUMBERS[t] ?? t;
}

export function tokenize(text: string): string[] {
  return text.split(TOKEN_SPLIT).filter((t) => t.length > 0);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Splits on terminal punctuation; the sentence is the unit of the gate. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const CONTENT_STOP_WORDS = new Set([
  'the', 'and', 'that', 'this', 'these', 'those', 'with', 'from', 'your', 'yours', 'you',
  'have', 'has', 'had', 'are', 'was', 'were', 'been', 'being', 'can', 'could', 'would',
  'should', 'will', 'shall', 'may', 'might', 'must', 'need', 'needs', 'needed', 'do',
  'does', 'did', 'about', 'before', 'after', 'above', 'below', 'under', 'over', 'then',
  'than', 'when', 'where', 'what', 'which', 'who', 'whom', 'how', 'why', 'here', 'there',
  'out', 'off', 'up', 'down', 'into', 'onto', 'in', 'on', 'at', 'to', 'for', 'of', 'a',
  'an', 'it', 'its', 'they', 'them', 'their', 'he', 'she', 'his', 'her', 'our', 'us',
  'we', 'if', 'but', 'or', 'nor', 'so', 'not', 'no', 'yes', 'all', 'any', 'both', 'each',
  'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same', 'too', 'very',
  'just', 'also', 'way', 'make', 'makes', 'made', 'take', 'takes', 'taken', 'get', 'gets',
  'got', 'come', 'comes', 'back', 'first', 'last', 'new', 'old', 'long', 'short',
  'little', 'big', 'many', 'much', 'still', 'even', 'ever', 'never', 'always', 'often',
  'once', 'every',
]);

/** Capitalized words that commonly start a sentence but are not names. */
const COMMON_SENTENCE_STARTERS = new Set([
  'The', 'A', 'An', 'It', 'This', 'These', 'That', 'Those', 'If', 'When', 'While', 'You',
  'Your', 'He', 'She', 'They', 'We', 'I', 'Yes', 'No', 'So', 'And', 'But', 'Or', 'To',
  'Is', 'Are', 'Was', 'Were', 'Do', 'Does', 'Did', 'Can', 'Could', 'Should', 'Would',
  'May', 'Might', 'Note', 'Tip', 'Remember', 'In', 'On', 'At', 'With', 'Without',
  'After', 'Before', 'Once', 'Until',
]);

/** Words that end a quantity's unit phrase ("4 shards and ..." -> unit [shards]). */
const UNIT_TRIM = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'and', 'or', 'so', 'far',
  'more', 'left', 'yet', 'your', 'my', 'you', 'i', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'need', 'needs', 'needed', 'have', 'has', 'had', 'its', 'it', 'this',
  'that', 'them', 'then', 'all', 'about', 'around', 'over', 'under', 'across', 'along',
  'before', 'after', 'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must',
  'make', 'makes', 'made', 'take', 'takes', 'taken', 'get', 'gets', 'got', 'do', 'does',
  'did', 'not', 'no', 'yes', 'if', 'when', 'where', 'while', 'which', 'who', 'how', 'why',
  'as', 'but', 'also', 'only', 'very', 'too', 'just', 'such', 'each', 'few', 'many',
  'much', 'most', 'other', 'some', 'any', 'both', 'own', 'same', 'way', 'long', 'short',
  'little', 'big',
]);

interface SourceIndex {
  tokens: string[];
  set: Set<string>;
}

function indexSource(source: WikiSource): SourceIndex {
  const tokens = tokenize(source.text).map(cleanToken);
  return { tokens, set: new Set(tokens) };
}

export function extractQuantityClaims(sentence: string): QuantityClaim[] {
  const tokens = tokenize(sentence);
  const claims: QuantityClaim[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] ?? '';
    let number: string | null;
    if (BARE_NUMBER.test(t)) {
      number = t;
    } else {
      number = WORD_NUMBERS[t.toLowerCase()] ?? null;
    }
    if (number === null) continue;

    const unit: string[] = [];
    const unitRaw: string[] = [];
    for (let k = 1; k <= 3; k++) {
      const u = tokens[i + k];
      if (u === undefined || !WORD_TOKEN.test(u)) break;
      const cu = cleanToken(u);
      if (UNIT_TRIM.has(cu)) break;
      unit.push(cu);
      unitRaw.push(u);
    }

    claims.push({
      raw: [t, ...unitRaw].join(' '),
      number,
      numberRaw: t,
      unit,
      unitRaw,
    });
  }
  return claims;
}

export function extractProperNounClaims(sentence: string): ProperNounClaim[] {
  const tokens = tokenize(sentence);
  const claims: ProperNounClaim[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i] ?? '';
    if (!CAPITAL_TOKEN.test(t)) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < tokens.length && CAPITAL_TOKEN.test(tokens[j] ?? '')) j += 1;
    // A leading generic starter ("The Duskfang Warden ...") is not part of the name.
    const start = i === 0 && COMMON_SENTENCE_STARTERS.has(t) ? i + 1 : i;
    if (start < j) {
      const rawWords: string[] = [];
      for (let k = start; k < j; k++) rawWords.push(tokens[k] ?? '');
      claims.push({
        phrase: rawWords.join(' '),
        words: rawWords.map(cleanToken),
        start,
        end: j,
      });
    }
    i = j;
  }
  return claims;
}

function quantityInSource(claim: QuantityClaim, index: SourceIndex): boolean {
  if (claim.unit.length === 0) {
    return index.set.has(claim.number);
  }
  for (let i = 0; i < index.tokens.length; i++) {
    if ((index.tokens[i] ?? '') !== claim.number) continue;
    let u = 0;
    const end = Math.min(index.tokens.length, i + 1 + claim.unit.length + 2);
    for (let j = i + 1; j < end && u < claim.unit.length; j++) {
      if ((index.tokens[j] ?? '') === (claim.unit[u] ?? '')) u += 1;
    }
    if (u === claim.unit.length) return true;
  }
  return false;
}

function properNounInSource(claim: ProperNounClaim, index: SourceIndex): boolean {
  return claim.words.length > 0 && claim.words.every((w) => index.set.has(w));
}

function contentWords(sentence: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const t of tokenize(sentence)) {
    const c = cleanToken(t);
    if (c.length < 4) continue;
    if (!/^[a-z]+$/.test(c)) continue;
    if (CONTENT_STOP_WORDS.has(c)) continue;
    if (seen.has(c)) continue;
    seen.add(c);
    words.push(c);
  }
  return words;
}

export function isSentenceGrounded(sentence: string, sources: WikiSource[]): GroundingVerdict {
  const trimmed = sentence.trim();
  if (trimmed.length === 0) return { grounded: true, reasons: [] };
  if (sources.length === 0) return { grounded: false, reasons: ['no sources provided'] };

  const indices = sources.map(indexSource);
  const reasons: string[] = [];

  for (const claim of extractQuantityClaims(trimmed)) {
    if (!indices.some((idx) => quantityInSource(claim, idx))) {
      reasons.push(`quantity "${claim.raw}" is not stated in any source`);
    }
  }
  for (const claim of extractProperNounClaims(trimmed)) {
    if (!indices.some((idx) => properNounInSource(claim, idx))) {
      reasons.push(`name "${claim.phrase}" does not appear in any source`);
    }
  }
  const words = contentWords(trimmed);
  if (words.length > 0) {
    const pool = new Set<string>();
    for (const idx of indices) for (const t of idx.set) pool.add(t);
    const hits = words.filter((w) => pool.has(w)).length;
    if (hits / words.length < 0.5) {
      reasons.push(`${words.length - hits} of ${words.length} content words are absent from the sources`);
    }
  }

  return { grounded: reasons.length === 0, reasons };
}
