/**
 * Deterministic, sentence-level grounding of an LLM answer against the fetched
 * source texts.
 *
 * A sentence survives the gate only if all three checks pass:
 *  1. Every proper-noun entity in the sentence ("Gloom King", "Obsidian Gate",
 *     or a lone capitalized name such as "Sunwell") appears in the sources.
 *     This is what catches invented items and misattributed locations.
 *  2. Every number/quantity in the sentence appears in the sources with the
 *     same value and the same unit. "5 shards" fails against a page that says
 *     4 — the failure that looks most like success.
 *  3. At least GROUNDED_TERM_THRESHOLD of the sentence's common content words
 *     appear in the sources.
 *
 * The gate is deliberately lexical: it verifies that the answer's claims point
 * at what the pages actually say. It cannot judge compositional claims (two
 * real entities combined in a false relation); the eval harness and its
 * golden scenarios form the second line of defence for those.
 */

export const GROUNDED_TERM_THRESHOLD = 0.7;

const STOP_WORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'all', 'also', 'am', 'an',
  'and', 'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being',
  'below', 'between', 'both', 'but', 'by', 'can', 'cannot', 'could', 'did',
  'do', 'does', 'doing', 'down', 'during', 'each', 'even', 'few', 'for',
  'from', 'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here',
  'hers', 'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into',
  'is', 'it', 'its', 'itself', 'just', 'may', 'me', 'might', 'more', 'most',
  'must', 'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on',
  'once', 'one', 'only', 'onto', 'or', 'other', 'our', 'ours', 'ourselves',
  'out', 'over', 'own', 'rather', 'said', 'same', 'shan', 'she', 'should',
  'so', 'some', 'still', 'such', 'than', 'that', 'the', 'their', 'theirs',
  'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those',
  'though', 'through', 'thus', 'to', 'too', 'under', 'until', 'up', 'upon',
  'us', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which',
  'while', 'who', 'whom', 'why', 'will', 'with', 'within', 'without', 'would',
  'you', 'your', 'yours', 'yourself', 'yourselves',
]);

/** Capitalized words that are common words, not entities ("The", "You", ...). */
const CAP_STOP_WORDS = new Set([
  'I', 'A', 'An', 'The', 'This', 'That', 'These', 'Those', 'You', 'Your',
  'We', 'Our', 'He', 'She', 'It', 'It\'s', 'They', 'His', 'Her', 'Its',
  'Their', 'To', 'In', 'On', 'At', 'By', 'For', 'With', 'Yes', 'No', 'Not',
]);

const ENTITY_TOKEN = /[A-Za-z]+(?:['’\-][A-Za-z]+)*/g;
const TERM_TOKEN = /[a-z][a-z'’\-]+/g;
const QUANTITY = /\b(\d+)(?:\s+([A-Za-z][A-Za-z'’\-]*))?/g;

/** Splits text into sentences on terminal punctuation followed by whitespace. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * Proper-noun entities: maximal runs of consecutive capitalized words. A
 * single capitalized word counts as an entity only mid-sentence (a leading
 * capitalized word is just the sentence's first word). Common capitalized
 * words ("The", "You", ...) are never entities.
 */
export function extractEntities(text: string): string[] {
  const found = new Set<string>();
  for (const sentence of splitSentences(text)) {
    const tokens = sentence.match(ENTITY_TOKEN) ?? [];
    let run: string[] = [];
    let runStart = -1;
    const flush = (): void => {
      if (run.length > 0 && !(runStart === 0 && run.length === 1)) {
        found.add(run.join(' '));
      }
      run = [];
      runStart = -1;
    };
    tokens.forEach((token, index) => {
      if (/^[A-Z]/.test(token) && !CAP_STOP_WORDS.has(token)) {
        if (run.length === 0) {
          runStart = index;
        }
        run.push(token);
      } else {
        flush();
      }
    });
    flush();
  }
  return [...found];
}

export interface Quantity {
  value: number;
  /** The unit word directly after the number, or null when there is none. */
  unit: string | null;
}

/** Numbers with their following unit word: "4 shards" -> { value: 4, unit: "shards" }. */
export function extractQuantities(text: string): Quantity[] {
  const quantities: Quantity[] = [];
  for (const match of text.matchAll(QUANTITY)) {
    quantities.push({
      value: Number(match[1]),
      unit: match[2] ? match[2].toLowerCase() : null,
    });
  }
  return quantities;
}

/** Common content words: lowercase tokens of length >= 3 that are not stop words. */
export function extractContentTerms(sentence: string): string[] {
  return (sentence.toLowerCase().match(TERM_TOKEN) ?? []).filter(
    (term) => term.length >= 3 && !STOP_WORDS.has(term),
  );
}

/** True when the sources support every claim of the sentence. */
export function isSentenceGrounded(sentence: string, sources: string[]): boolean {
  const sourceText = sources.join('\n');
  const sourceLower = sourceText.toLowerCase();

  for (const entity of extractEntities(sentence)) {
    if (!sourceLower.includes(entity.toLowerCase())) {
      return false;
    }
  }

  const sourceQuantities = extractQuantities(sourceText);
  for (const quantity of extractQuantities(sentence)) {
    const supported = sourceQuantities.some(
      (candidate) =>
        candidate.value === quantity.value &&
        (quantity.unit === null || candidate.unit === quantity.unit),
    );
    if (!supported) {
      return false;
    }
  }

  const terms = extractContentTerms(sentence);
  if (terms.length > 0) {
    const supported = terms.filter((term) => sourceLower.includes(term)).length;
    if (supported / terms.length < GROUNDED_TERM_THRESHOLD) {
      return false;
    }
  }

  return true;
}

export interface GroundingOutcome {
  /** Sentences the sources support, in order. */
  kept: string[];
  /** Sentences the sources do not support, in order. */
  dropped: string[];
}

/** Runs the sentence-level gate over a full model answer. */
export function groundAnswer(answer: string, sources: string[]): GroundingOutcome {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const sentence of splitSentences(answer)) {
    if (isSentenceGrounded(sentence, sources)) {
      kept.push(sentence);
    } else {
      dropped.push(sentence);
    }
  }
  return { kept, dropped };
}
