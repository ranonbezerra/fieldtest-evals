import type { WikiPage } from './assistant.types';

/**
 * Sentence-level grounding gate.
 *
 * A sentence is grounded iff BOTH hold:
 *  1. at least GROUNDING_OVERLAP_THRESHOLD of its content words occur in the
 *     provided pages (union of titles and bodies);
 *  2. every "number + noun" quantity in it is stated with that exact value in
 *     the pages. A different number is a mismatch; a noun the pages never
 *     quantify is unsupported. Rule 2 exists to catch near-verbatim lies that
 *     change a single number, which rule 1 cannot tell apart.
 */

const GROUNDING_OVERLAP_THRESHOLD = 0.5;

export type GroundingIssue =
  | { kind: 'insufficient_overlap'; overlap: number }
  | { kind: 'quantity_mismatch'; unit: string; claimed: number; inSources: number[] }
  | { kind: 'quantity_unsupported'; unit: string; claimed: number };

export interface GroundingVerdict {
  sentence: string;
  grounded: boolean;
  /** Fraction of the sentence's content words found in the sources. */
  overlap: number;
  issues: GroundingIssue[];
}

export interface QuantityMention {
  value: number;
  unit: string;
}

/**
 * // ASSUMPTION: spelled-out quantities are only normalised for one..ten; the
 * wiki fixtures use digits, and answers are not expected to spell larger ones.
 */
export const WORD_NUMBERS: { [word: string]: number | undefined } = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/** Function words that carry no grounding signal. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'of', 'at', 'by', 'for', 'with',
  'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after', 'above',
  'below', 'up', 'down', 'out', 'off', 'over', 'under', 'again', 'further', 'once', 'here',
  'there', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'can', 'will',
  'shall', 'should', 'would', 'could', 'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'i', 'me', 'my', 'mine', 'you', 'your', 'yours',
  'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its', 'we', 'our', 'us', 'they', 'them',
  'their', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'whose', 'how',
  'why', 'where', 'when', 'while', 'also', 'within', 'upon', 'among', 'around', 'along',
  'across', 'behind', 'beside', 'though', 'although', 'because', 'since', 'enough',
]);

/** Lowercase word tokens: apostrophes dropped, spelled numbers normalised. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0)
    .map((token) => {
      const spelled = WORD_NUMBERS[token];
      return spelled === undefined ? token : String(spelled);
    });
}

/** Content words: tokens minus stopwords (the only grounding signal). */
export function contentWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const token of tokenize(text)) {
    if (!STOPWORDS.has(token)) words.add(token);
  }
  return words;
}

/** Splits prose into sentences on terminal punctuation. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

const QUANTITY_PATTERN = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+([a-z][a-z-]*)/g;

/** Finds "number + noun" mentions, e.g. "4 shards" or "five keys". */
export function quantityMentions(text: string): QuantityMention[] {
  const mentions: QuantityMention[] = [];
  for (const match of text.toLowerCase().matchAll(QUANTITY_PATTERN)) {
    const rawNumber = match[1];
    const unit = match[2];
    if (STOPWORDS.has(unit)) continue; // "one of", "two or three", ...
    const value = /^\d+$/.test(rawNumber) ? Number(rawNumber) : WORD_NUMBERS[rawNumber];
    if (value === undefined) continue;
    mentions.push({ value, unit });
  }
  return mentions;
}

/** 'shards' -> 'shard' so "4 shard" and "4 shards" compare equal. */
function singularize(unit: string): string {
  return unit.length > 1 && unit.endsWith('s') && !unit.endsWith('ss') ? unit.slice(0, -1) : unit;
}

function sourceWordUnion(sources: WikiPage[]): Set<string> {
  const words = new Set<string>();
  for (const page of sources) {
    for (const word of contentWords(`${page.title} ${page.text}`)) words.add(word);
  }
  return words;
}

function sourceQuantities(sources: WikiPage[]): Map<string, Set<number>> {
  const quantities = new Map<string, Set<number>>();
  for (const page of sources) {
    for (const mention of quantityMentions(`${page.title} ${page.text}`)) {
      const key = singularize(mention.unit);
      let values = quantities.get(key);
      if (values === undefined) {
        values = new Set<number>();
        quantities.set(key, values);
      }
      values.add(mention.value);
    }
  }
  return quantities;
}

/** Verifies one sentence against the sources. */
export function checkGrounding(sentence: string, sources: WikiPage[]): GroundingVerdict {
  const issues: GroundingIssue[] = [];

  const words = contentWords(sentence);
  const known = sourceWordUnion(sources);
  let hits = 0;
  for (const word of words) {
    if (known.has(word)) hits += 1;
  }
  const overlap = words.size === 0 ? 0 : hits / words.size;
  if (words.size === 0 || overlap < GROUNDING_OVERLAP_THRESHOLD) {
    issues.push({ kind: 'insufficient_overlap', overlap });
  }

  const quantities = sourceQuantities(sources);
  for (const mention of quantityMentions(sentence)) {
    const allowed = quantities.get(singularize(mention.unit));
    if (allowed === undefined) {
      issues.push({ kind: 'quantity_unsupported', unit: mention.unit, claimed: mention.value });
    } else if (!allowed.has(mention.value)) {
      issues.push({
        kind: 'quantity_mismatch',
        unit: mention.unit,
        claimed: mention.value,
        inSources: [...allowed].sort((a, b) => a - b),
      });
    }
  }

  return { sentence, grounded: issues.length === 0, overlap, issues };
}
