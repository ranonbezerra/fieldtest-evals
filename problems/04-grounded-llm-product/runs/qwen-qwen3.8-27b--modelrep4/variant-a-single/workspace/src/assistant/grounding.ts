/**
 * Sentence-level grounding gate.
 *
 * The LLM is untrusted: every sentence it emits must be verifiable against the
 * fetched wiki pages before it may reach the player. A sentence is grounded
 * only when all three hold:
 *
 *   1. overlap    - at least 80% of its content words appear in the sources
 *                   (tolerates light paraphrase, rejects invented wording);
 *   2. names      - every proper noun it uses appears in the sources
 *                   (rejects invented bosses, items, locations);
 *   3. quantities - every "N <term>" pair it states matches an "N <term>" pair
 *                   the sources state (rejects "5 shards" when pages say 4).
 *
 * The gate is deliberately lexical and conservative: it errs toward dropping a
 * sentence, or refusing outright, rather than leaking an unverified claim.
 */

/** Words that carry no factual weight on either side of the comparison. */
export const STOPWORDS = new Set<string>([
  'i', 'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'of', 'to', 'in',
  'on', 'at', 'by', 'for', 'with', 'without', 'from', 'into', 'onto', 'is',
  'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'you', 'your',
  'yours', 'we', 'our', 'ours', 'they', 'their', 'theirs', 'he', 'she', 'him',
  'her', 'hers', 'them', 'his', 'this', 'that', 'these', 'those', 'can',
  'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must', 'do',
  'does', 'did', 'has', 'have', 'had', 'not', 'no', 'yes', 'just', 'only',
  'so', 'such', 'as', 'also', 'than', 'too', 'very', 'here', 'there', 'when',
  'where', 'what', 'which', 'who', 'whom', 'how', 'all', 'any', 'some',
  'other', 'another', 'more', 'most', 'few', 'up', 'down', 'out', 'off',
  'over', 'under', 'again', 'once', 'both', 'each', 'either', 'neither',
  'per', 'via', 'first', 'second', 'third', 's', 't',
]);

/** Small number words are normalized to digits so "four" and "4" match. */
export const NUMBER_WORDS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
  seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12',
  thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16',
  seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20',
  thirty: '30', forty: '40', fifty: '50',
};

/** A sentence needs this fraction of its content words present in the sources. */
export const GROUNDING_OVERLAP_MIN = 0.8;

export function isDigit(token: string): boolean {
  return /^\d+$/.test(token);
}

/** Lowercase, strip punctuation, split on whitespace, map number words to digits. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => NUMBER_WORDS[word] ?? word);
}

/** Proper nouns used in the sentence (lowercased), ignoring a leading stopword. */
export function properNouns(sentence: string): string[] {
  const words = sentence.match(/[\p{L}]+(?:'[\p{L}]+)*/gu) ?? [];
  const names: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word.length < 2) continue;
    if (i === 0 && STOPWORDS.has(word.toLowerCase())) continue; // "The", "You", ...
    if (!/^[\p{Lu}]/u.test(word)) continue;
    names.push(tokenize(word)[0] ?? word.toLowerCase());
  }
  return names;
}

/** First non-stopword token from index `from` onward, or null. */
export function nextContent(tokens: string[], from: number): string | null {
  for (let i = from; i < tokens.length; i++) {
    if (!STOPWORDS.has(tokens[i])) return tokens[i];
  }
  return null;
}

export interface SourceIndex {
  /** Every normalized token any source page states. */
  tokens: Set<string>;
  /** term -> the counts the sources state for it, e.g. "shards" -> {"4"}. */
  counts: Map<string, Set<string>>;
}

export function indexSources(sources: string[]): SourceIndex {
  const tokens = new Set<string>();
  const counts = new Map<string, Set<string>>();
  for (const source of sources) {
    const words = tokenize(source);
    for (let i = 0; i < words.length; i++) {
      tokens.add(words[i]);
      if (!isDigit(words[i])) continue;
      const term = nextContent(words, i + 1);
      if (term === null) continue;
      const known = counts.get(term) ?? new Set<string>();
      known.add(words[i]);
      counts.set(term, known);
    }
  }
  return { tokens, counts };
}

function splitSentences(raw: string): string[] {
  return raw
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isSentenceGrounded(sentence: string, index: SourceIndex): boolean {
  const tokens = tokenize(sentence);
  const content = tokens.filter((token) => !STOPWORDS.has(token));
  if (content.length === 0) return false;

  // 1. lexical overlap with the sources.
  const known = content.filter((token) => index.tokens.has(token)).length;
  if (known / content.length < GROUNDING_OVERLAP_MIN) return false;

  // 2. no proper noun the sources never mention.
  if (properNouns(sentence).some((name) => !index.tokens.has(name))) return false;

  // 3. every stated quantity matches a quantity the sources state.
  for (let i = 0; i < tokens.length; i++) {
    if (!isDigit(tokens[i])) continue;
    const term = nextContent(tokens, i + 1);
    if (term === null) {
      if (!index.tokens.has(tokens[i])) return false;
    } else {
      const known = index.counts.get(term);
      if (known === undefined || !known.has(tokens[i])) return false;
    }
  }
  return true;
}

export interface GroundingResult {
  /** The grounded sentences, joined. Empty when `refused`. */
  text: string;
  /** True when no sentence survived; the caller must then refuse. */
  refused: boolean;
  dropped: string[];
}

/**
 * Gate raw LLM output sentence by sentence. Ungrounded sentences are dropped;
 * if nothing grounded remains, the pipeline must refuse.
 */
export function applyGroundingGate(raw: string, sources: string[]): GroundingResult {
  const index = indexSources(sources);
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const sentence of splitSentences(raw)) {
    if (isSentenceGrounded(sentence, index)) kept.push(sentence);
    else dropped.push(sentence);
  }
  if (kept.length === 0) return { text: '', refused: true, dropped };
  return { text: kept.join(' '), refused: false, dropped };
}
