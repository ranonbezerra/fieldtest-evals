import { STOPWORDS, normalize, toDigit, tokenize } from './grounding-gate.js';

export const REDACTED = '___';

/**
 * Derive the spoiler-free hint by redacting an already-grounded answer.
 * No second LLM call: a second generation can invent, a redaction cannot.
 *
 * Redaction rule (the documented contract):
 *   - any capitalized token — a proper noun: boss names, item names,
 *     locations — is replaced by a placeholder. The exception is a generic
 *     sentence-initial word ("The", "You"), which is capitalized only because
 *     it starts the sentence.
 *   - any quantity (digit or word number) whose value does not appear in the
 *     player's question is replaced by a placeholder; quantities the player
 *     has already mentioned may remain.
 * Generic lowercase words are never names in this world model, so they pass
 * through unchanged.
 */
export function redactForHint(answer: string, question: string): string {
  const allowedDigits = new Set<number>();
  for (const token of tokenize(question)) {
    const digit = toDigit(normalize(token));
    if (digit !== null) allowedDigits.add(digit);
  }

  return answer
    .replace(/[\p{L}\p{N}']+/gu, (part, offset) => {
      const before = offset === 0 ? '' : answer.charAt(offset - 1);
      const normalized = normalize(part);
      const digit = toDigit(normalized);
      if (digit !== null) return allowedDigits.has(digit) ? part : REDACTED;
      const atSentenceStart = before === '' || /[\s.!?]/.test(before);
      if (atSentenceStart && STOPWORDS.has(normalized)) return part;
      if (/[A-Z]/.test(part)) return REDACTED;
      return part;
    })
    .replace(/\s+/g, ' ')
    .trim();
}
