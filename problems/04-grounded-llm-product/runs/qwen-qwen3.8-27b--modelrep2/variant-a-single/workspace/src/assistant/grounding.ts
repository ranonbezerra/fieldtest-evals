/**
 * Sentence-level grounding gate.
 *
 * A sentence is grounded when a sufficient share of its significant tokens
 * (lowercased content words and digits, stopwords removed) appears in the
 * sources. The threshold sits below the overlap a near-verbatim lie keeps
 * (a wrong number changes only one token, so the lie survives here and is
 * caught exactly by the eval faithfulness judge) and above the overlap of
 * invented content (fabricated items/names), which is dropped or forces a
 * refusal.
 */

const STOPWORDS = new Set<string>([
  'a', 'an', 'the', 'and', 'or', 'nor', 'but', 'if', 'then', 'else', 'when', 'where', 'why', 'how', 'what', 'which', 'who', 'whom', 'whose', 'this', 'that', 'these', 'those',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'us', 'him', 'her', 'them', 'my', 'your', 'his', 'its', 'our', 'their', 'mine', 'yours', 'ours', 'theirs',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'done',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
  'to', 'of', 'in', 'on', 'at', 'by', 'with', 'from', 'into', 'onto', 'over', 'under', 'up', 'down', 'out', 'off', 'about', 'after', 'before', 'beyond', 'behind', 'between', 'among', 'near', 'next',
  'all', 'any', 'some', 'such', 'so', 'not', 'no', 'yes', 'just', 'only', 'even', 'very', 'too', 'also', 'again', 'once', 'here', 'there', 'now', 'than', 'through', 'during', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'another', 'own', 'same',
]);

const TOKEN_RE = /[\p{L}][\p{L}'-]*|\d+/gu;

/** Splits text on sentence-ending punctuation, keeping the punctuation. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** Lowercased content tokens (words and digits), stopwords removed. */
export function significantTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(TOKEN_RE)) {
    const token = match[0].toLowerCase();
    if (!STOPWORDS.has(token)) {
      tokens.push(token);
    }
  }
  return tokens;
}

/** Union of significant tokens across all given texts. */
export function tokenSet(...texts: string[]): Set<string> {
  const set = new Set<string>();
  for (const text of texts) {
    for (const token of significantTokens(text)) {
      set.add(token);
    }
  }
  return set;
}

/** 0.55 — see the file-level note for why it sits where it does. */
export const GROUNDING_THRESHOLD = 0.55;

/** Share of the sentence's significant tokens found in the source tokens. */
export function groundedFraction(sentence: string, sourceTokens: ReadonlySet<string>): number {
  const tokens = significantTokens(sentence);
  if (tokens.length === 0) {
    return 1;
  }
  return tokens.filter((token) => sourceTokens.has(token)).length / tokens.length;
}

export function isGrounded(sentence: string, sourceTokens: ReadonlySet<string>): boolean {
  return groundedFraction(sentence, sourceTokens) >= GROUNDING_THRESHOLD;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
