/**
 * Pure text analysis shared by the grounding gate, the hint redactor and the
 * eval judges: sentence splitting, number/quantity extraction, proper noun
 * extraction and source containment checks.
 */

export const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
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

export const NUMBER_WORD_BY_VALUE: Record<number, string> = {
  0: 'zero',
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  10: 'ten',
};

export const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'of', 'at', 'by', 'for',
  'from', 'in', 'into', 'on', 'onto', 'over', 'under', 'up', 'down', 'out', 'off',
  'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did',
  'done', 'have', 'has', 'had', 'having', 'will', 'would', 'shall', 'should', 'can',
  'could', 'may', 'might', 'must', 'to', 'that', 'this', 'these', 'those', 'it',
  'its', 'you', 'your', 'yours', 'we', 'our', 'ours', 'i', 'me', 'my', 'mine', 'he',
  'she', 'they', 'them', 'his', 'her', 'their', 'so', 'such', 'than', 'too', 'very',
  'just', 'not', 'no', 'nor', 'any', 'all', 'each', 'few', 'more', 'most', 'other',
  'some', 'until', 'against', 'between', 'through', 'during', 'before', 'after',
  'above', 'below', 'again', 'further', 'once', 'here', 'there', 'why', 'how',
  'what', 'which', 'who', 'whom', 'where', 'because', 'about',
]);

/** Split on sentence-final punctuation followed by whitespace. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Words and digits, punctuation stripped. */
export function tokenize(text: string): string[] {
  return text.match(/[A-Za-z0-9]+(?:'[A-Za-z]+)?/g) ?? [];
}

/** A token's numeric value if it is a small digit or number word. */
export function toNumber(token: string): number | null {
  if (/^\d{1,3}$/.test(token)) return parseInt(token, 10);
  return NUMBER_WORDS[token.toLowerCase()] ?? null;
}

/** Every number (digit or small number word) in the text. */
export function extractNumbers(text: string): number[] {
  const found: number[] = [];
  for (const t of tokenize(text)) {
    const n = toNumber(t);
    if (n !== null) found.push(n);
  }
  return found;
}

export function singularize(word: string): string {
  return word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word;
}

export interface QuantityPair {
  quantity: number;
  /** Singularised head noun, lowercased, e.g. "shard". */
  noun: string;
  /** The raw phrase, e.g. "five moon shards". */
  raw: string;
}

/**
 * "quantity + noun" phrases, with at most one modifier word
 * ("five moon shards" -> { quantity: 5, noun: "shard" }). A bare number
 * followed by stopwords yields no pair — it is still checked via extractNumbers.
 */
export function extractQuantityPairs(text: string): QuantityPair[] {
  const tokens = tokenize(text);
  const pairs: QuantityPair[] = [];
  const isContentWord = (t: string): boolean =>
    /^[A-Za-z][A-Za-z'-]*$/.test(t) && !STOPWORDS.has(t.toLowerCase());

  for (let i = 0; i < tokens.length; i++) {
    const numberToken = tokens[i];
    if (numberToken === undefined) continue;
    const quantity = toNumber(numberToken);
    if (quantity === null) continue;

    const a = tokens[i + 1];
    const b = tokens[i + 2];
    let modifier: string | undefined;
    let noun: string | undefined;
    if (isContentWord(a ?? '') && isContentWord(b ?? '')) {
      modifier = a;
      noun = b;
    } else if (isContentWord(a ?? '')) {
      noun = a;
    }
    // "four braziers. The" -> the would-be noun is a stopword; fall back to the modifier slot.
    if (noun !== undefined && STOPWORDS.has(noun.toLowerCase()) && modifier !== undefined) {
      noun = modifier;
      modifier = undefined;
    }
    if (noun === undefined || STOPWORDS.has(noun.toLowerCase())) continue;

    pairs.push({
      quantity,
      noun: singularize(noun.toLowerCase()),
      raw: `${numberToken}${modifier !== undefined ? ` ${modifier}` : ''} ${noun}`,
    });
  }
  return pairs;
}

/**
 * Proper nouns in one sentence: multi-word capitalised sequences
 * ("Ember Gate", "Dusk Caverns") plus single capitalised words of 3+ letters
 * that are not the first token (a sentence-initial word is ambiguous with
 * ordinary capitalisation and is left to the containment check).
 */
export function extractProperNouns(sentence: string): string[] {
  const found = new Set<string>();
  const sequences = sentence.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) ?? [];
  for (const s of sequences) found.add(s);

  const tokens = sentence.replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g, ' ').split(/\s+/);
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === undefined) continue;
    const bare = t.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '');
    if (/^[A-Z][a-z]{2,}$/.test(bare)) found.add(bare);
  }
  return [...found];
}

/** Unique content words of a text (lowercased, stopwords and numbers removed). */
export function contentWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const t of tokenize(text)) {
    const w = t.toLowerCase();
    if (w.length <= 2 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    words.add(w);
  }
  return words;
}

/** Fraction of the sentence's unique content words that appear in the sources. */
export function vocabularyContainment(sentence: string, sources: string[]): number {
  const words = contentWords(sentence);
  if (words.size === 0) return 1;
  const sourceWords = new Set(sources.flatMap((s) => [...contentWords(s)]));
  let hits = 0;
  for (const w of words) if (sourceWords.has(w)) hits += 1;
  return hits / words.size;
}

export interface QuantityCheck {
  pair: QuantityPair;
  grounded: boolean;
  /** Why the pair is unsupported (undefined when grounded). */
  reason: string | undefined;
  /** Quantities the sources attach to the same noun. */
  sourceQuantities: number[];
  nounInSources: boolean;
}

/**
 * Exact quantity checking: a "N noun" claim is grounded only when the sources
 * themselves say "N noun" for that same noun. "5 shards" against sources that
 * say 4 is a mismatch, and a noun the sources never quantify is unsupported.
 */
export function checkQuantities(sentence: string, sources: string[]): QuantityCheck[] {
  const sourcePairs = sources.flatMap((s) => extractQuantityPairs(s));
  return extractQuantityPairs(sentence).map((pair) => {
    const sourceQuantities = sourcePairs
      .filter((sp) => sp.noun === pair.noun)
      .map((sp) => sp.quantity);
    const uniqueSourceQuantities = [...new Set(sourceQuantities)];
    const nounInSources = sources.some(
      (s) => new RegExp(`\\b${escapeRegExp(pair.noun)}s?\\b`, 'i').test(s),
    );

    let grounded: boolean;
    let reason: string | undefined;
    if (!nounInSources) {
      grounded = false;
      reason = `"${pair.noun}" never appears in the sources`;
    } else if (uniqueSourceQuantities.length === 0) {
      grounded = false;
      reason = `sources never state a quantity for "${pair.noun}"`;
    } else if (!uniqueSourceQuantities.includes(pair.quantity)) {
      grounded = false;
      reason = `answer says ${pair.quantity} ${pair.noun}(s) but sources say ${uniqueSourceQuantities.join(' or ')}`;
    } else {
      grounded = true;
    }
    return { pair, grounded, reason, sourceQuantities, nounInSources };
  });
}

export interface ProperNounCheck {
  name: string;
  grounded: boolean;
  reason: string | undefined;
}

export function checkProperNouns(sentence: string, sources: string[]): ProperNounCheck[] {
  return extractProperNouns(sentence).map((name) => {
    const inSources = sources.some(
      (s) => new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(s),
    );
    return inSources
      ? { name, grounded: true, reason: undefined }
      : { name, grounded: false, reason: `"${name}" is not in the sources` };
  });
}
