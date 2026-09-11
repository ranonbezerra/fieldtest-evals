/**
 * Text primitives shared by the grounding gate, the hint redaction and the
 * eval judges: normalization, tokenization, sentence splitting, proper-noun
 * and quantity extraction.
 */

const NUMBER_WORDS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
  twenty: '20',
  thirty: '30',
  forty: '40',
  fifty: '50',
};

/**
 * Canonical form for containment checks: lowercase, punctuation stripped,
 * number words folded to digits, single spaces. "Four shards" and "4 shards"
 * normalize identically; "5 shards" and "4 shards" do not.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => NUMBER_WORDS[word] ?? word)
    .join(' ');
}

/** Normalized whitespace-separated tokens (numbers included). */
export function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(' ')
    .filter((token) => token.length > 0);
}

/** Split an answer into sentences on terminal punctuation followed by whitespace. */
export function splitSentences(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * Words that carry no claim on their own. Deliberately generous so the gate
 * judges content, not phrasing. The one- and two-letter entries absorb
 * apostrophe residue from normalization ("don't" -> "don t").
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'so', 'yet', 'if', 'as', 'than', 'then', 'once',
  'when', 'where', 'why', 'how', 'who', 'whom', 'which', 'what',
  'this', 'that', 'these', 'those',
  'i', 'we', 'you', 'he', 'she', 'it', 'they', 'them', 'him', 'her', 'his', 'their',
  'your', 'ours', 'our', 'its', 'us',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'do', 'does', 'did', 'done', 'doing', 'have', 'has', 'had', 'having',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must', 'need', 'needs',
  'let', 'lets', 'please',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'from', 'with', 'without', 'about', 'into', 'out',
  'over', 'under', 'up', 'down', 'across', 'along', 'through', 'during', 'while', 'since',
  'until', 'before', 'after', 'above', 'below', 'around', 'between', 'among',
  'not', 'no', 'yes', 'now', 'today', 'tomorrow', 'here', 'there',
  'more', 'most', 'less', 'least', 'much', 'many', 'enough', 'only', 'also', 'just', 'very',
  'too', 'each', 'every', 'any', 'all', 'some', 'such', 'other', 'another', 'own', 'same', 'else',
  's', 't', 'd', 'm', 'n', 're', 've', 'll',
]);

/** Tokens that actually carry a claim: normalized tokens minus stopwords. */
export function claimTokens(text: string): string[] {
  return tokenize(text).filter((token) => !STOPWORDS.has(token));
}

/**
 * Common capitalized sentence openers. A lone capitalized word counts as a
 * name only if it is not in this set, so "The altar..." yields no name while
 * "Gloomwing waits below" yields Gloomwing.
 */
const COMMON_OPENERS: ReadonlySet<string> = new Set([
  'The', 'A', 'An', 'I', 'We', 'You', 'Your', 'It', 'This', 'These', 'Those',
  'He', 'She', 'They', 'If', 'To', 'When', 'Where', 'Why', 'How',
  'After', 'Before', 'Once', 'Note', 'Remember', 'First', 'Next', 'Finally',
  'So', 'But', 'And', 'Or', 'Make', 'Find', 'Use', 'Bring', 'Take',
  'Beat', 'Defeat', 'Collect', 'Watch', 'Avoid', 'Stay', 'There', 'Here',
]);

const WORD_RE = /[A-Za-z][A-Za-z'’-]*/g;

/**
 * Proper-noun candidates: runs of capitalized words. The gate requires each
 * candidate to appear in the sources; hint redaction removes them, because
 * they are the boss names and locations that must not leak.
 */
export function extractProperNouns(text: string): string[] {
  const found: string[] = [];
  let run: string[] = [];
  const flush = (): void => {
    if (run.length > 0) {
      found.push(run.join(' '));
      run = [];
    }
  };
  for (const match of text.matchAll(WORD_RE)) {
    const word = match[0];
    if (/^[A-Z]/.test(word) && !COMMON_OPENERS.has(word)) {
      run.push(word);
    } else {
      flush();
    }
  }
  flush();
  return found;
}

export interface Span {
  start: number;
  end: number;
}

/** Character spans of the proper-noun runs in `text`. */
export function properNounSpans(text: string): Span[] {
  const words: Array<Span & { word: string }> = [];
  for (const match of text.matchAll(WORD_RE)) {
    if (match.index === undefined) continue;
    words.push({ word: match[0], start: match.index, end: match.index + match[0].length });
  }
  const runs: Span[] = [];
  let current: Span | null = null;
  const close = (): void => {
    if (current !== null) {
      runs.push(current);
      current = null;
    }
  };
  for (const word of words) {
    const isName = /^[A-Z]/.test(word.word) && !COMMON_OPENERS.has(word.word);
    if (isName) {
      if (current !== null && /^\s+$/.test(text.slice(current.end, word.start))) {
        current.end = word.end;
      } else {
        close();
        current = { start: word.start, end: word.end };
      }
    } else {
      close();
    }
  }
  close();
  return runs;
}

const QUANTITY_RE =
  /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)(?:\s+[A-Za-z][A-Za-z'’-]*){1,2}/g;

export interface QuantityMatch extends Span {
  value: number;
  /** The unit, lowercased and singularized ("4 sunshard keys" -> "key"). */
  unit: string;
}

/**
 * (number, unit) pairs. The unit is the last non-stopword after the number,
 * so both sides of a comparison normalize to the same key. The span covers
 * the number token only, which is what hint redaction replaces.
 */
export function quantityMatches(text: string): QuantityMatch[] {
  const out: QuantityMatch[] = [];
  for (const match of text.matchAll(QUANTITY_RE)) {
    if (match.index === undefined) continue;
    const head = match[1];
    const rest = match[0]
      .slice(head.length)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .filter((word) => !STOPWORDS.has(word.toLowerCase()));
    if (rest.length === 0) continue;
    const value = Number(NUMBER_WORDS[head.toLowerCase()] ?? head);
    if (!Number.isFinite(value)) continue;
    const unit = rest[rest.length - 1].toLowerCase().replace(/s$/, '');
    out.push({ start: match.index, end: match.index + head.length, value, unit });
  }
  return out;
}

/** "4 key" — the exact-match key for a (number, unit) pair. */
export function quantityKey(quantity: { value: number; unit: string }): string {
  return `${quantity.value} ${quantity.unit}`;
}
