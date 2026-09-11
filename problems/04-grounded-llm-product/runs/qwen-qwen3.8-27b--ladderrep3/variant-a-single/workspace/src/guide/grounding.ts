/**
 * Sentence-level grounding gate.
 *
 * A sentence is grounded when every claim in it is supported by the fetched
 * wiki pages. Claims are lexical: each content word must occur in the source
 * text (light stemming), and each number must occur as the same value in the
 * source. A number the player already stated in their question is allowed,
 * because restating it is not a new claim.
 *
 * The check is intentionally strict and fail-closed: a paraphrase the pages
 * do not literally support is treated as ungrounded and the sentence is
 * dropped. Dropping (and eventually refusing) is the safe outcome.
 *
 * LIMITATION: this is a lexical entailment proxy, not semantic entailment. A
 * sentence that rearranges true source facts into a false relation using only
 * source vocabulary would pass; a production system should pair this gate
 * with an entailment judge. The gate's job here is to make hallucinated
 * vocabulary and wrong quantities impossible to ship.
 */

const STOPWORDS = new Set<string>([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'of', 'to',
  'in', 'on', 'at', 'by', 'for', 'with', 'without', 'from', 'into', 'onto',
  'over', 'under', 'above', 'below', 'behind', 'before', 'after', 'near',
  'through', 'during', 'while', 'is', 'am', 'are', 'was', 'were', 'be',
  'been', 'being', 'do', 'does', 'did', 'have', 'has', 'had', 'will',
  'would', 'can', 'could', 'should', 'shall', 'may', 'might', 'must',
  'need', 'needs', 'want', 'wants', 'you', 'your', 'yours', 'my', 'mine',
  'i', 'we', 'they', 'he', 'she', 'it', 'its', 'our', 'ours', 'us', 'them',
  'him', 'her', 'his', 'this', 'that', 'these', 'those', 'here', 'there',
  'where', 'when', 'how', 'what', 'which', 'who', 'whom', 'whose', 'not',
  'no', 'so', 'as', 'just', 'also', 'only', 'too', 'very', 'all', 'any',
  'each', 'every', 'more', 'most', 'some', 'such', 'than', 'plus', 'up',
  'out', 'off', 'down', 'again', 'further', 'once', 'because', 'until',
  'against', 'between', 'among', 'about', 'already', 'still', 'now', 'yes',
]);

const SPOKEN_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20,
};

export const STOPWORDS_SET: ReadonlySet<string> = STOPWORDS;

export function isStopword(word: string): boolean {
  return STOPWORDS.has(word);
}

export function spokenNumberValue(word: string): number | null {
  const hit = SPOKEN_NUMBERS[word];
  return hit === undefined ? null : hit;
}

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ');
}

export function tokenize(text: string): string[] {
  return normalizeText(text).split(' ').filter(Boolean);
}

export function numberValues(text: string): number[] {
  const values = new Set<number>();
  for (const token of tokenize(text)) {
    if (/^\d+$/.test(token)) {
      values.add(parseInt(token, 10));
    } else {
      const spoken = SPOKEN_NUMBERS[token];
      if (spoken !== undefined) values.add(spoken);
    }
  }
  return [...values];
}

/** Very light suffix stripping so "inserted" matches "insert" and "shards" matches "shard". */
export function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 3 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  if (word.length > 4 && word.endsWith('e')) return word.slice(0, -1);
  return word;
}

export function wordForms(word: string): string[] {
  return [word, stem(word)];
}

export function buildKeyset(text: string): Set<string> {
  const set = new Set<string>();
  for (const token of tokenize(text)) {
    set.add(token);
    set.add(stem(token));
  }
  return set;
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length > 0);
}

export interface SentenceVerdict {
  text: string;
  grounded: boolean;
  /** Claim tokens (words or numbers) the sources do not support. */
  missing: string[];
}

export interface AnswerAssessment {
  sentences: SentenceVerdict[];
  groundedCount: number;
}

export function assessSentence(
  sentence: string,
  sourceKeyset: ReadonlySet<string>,
  sourceNumbers: ReadonlySet<number>,
  questionNumbers: ReadonlySet<number>,
): SentenceVerdict {
  const missing: string[] = [];
  for (const token of tokenize(sentence)) {
    if (isStopword(token)) continue;
    if (/^\d+$/.test(token)) {
      const value = parseInt(token, 10);
      if (!sourceNumbers.has(value) && !questionNumbers.has(value)) missing.push(token);
      continue;
    }
    const spoken = spokenNumberValue(token);
    if (spoken !== null) {
      if (!sourceNumbers.has(spoken) && !questionNumbers.has(spoken)) missing.push(token);
      continue;
    }
    const supported = wordForms(token).some(form => sourceKeyset.has(form));
    if (!supported) missing.push(token);
  }
  return { text: sentence, grounded: missing.length === 0, missing };
}

export function assessAnswer(answer: string, sources: string[], question: string): AnswerAssessment {
  const sourceKeyset = buildKeyset(sources.join(' '));
  const sourceNumbers = new Set<number>(numberValues(sources.join(' ')));
  const questionNumbers = new Set<number>(numberValues(question));
  const sentences = splitSentences(answer).map(sentence =>
    assessSentence(sentence, sourceKeyset, sourceNumbers, questionNumbers),
  );
  return { sentences, groundedCount: sentences.filter(sentence => sentence.grounded).length };
}
