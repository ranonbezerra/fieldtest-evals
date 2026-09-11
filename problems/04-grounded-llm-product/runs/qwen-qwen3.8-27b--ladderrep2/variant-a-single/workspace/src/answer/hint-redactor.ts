import { NUMBER_WORDS, extractNumbers, splitSentences } from './text-utils.js';

export const REDACTION = '[redacted]';

/**
 * Hint mode is a redaction of the grounded answer, never a second LLM call:
 * a second generation is a fresh opportunity to reveal or invent spoilers;
 * a redaction of a gated answer can only remove information.
 *
 * Rule set:
 *  - proper nouns (multi-word sequences, and single capitalised words that are
 *    not the first word of a sentence) become "[redacted]" — this removes boss
 *    names and locations;
 *  - any quantity (digit or number word) the player did not already mention in
 *    their question becomes "[redacted]".
 * Common-case wording is left intact on purpose: over-redaction makes hints
 * useless, and the gate has already guaranteed the wording is source-grounded.
 */
export class HintRedactor {
  redact(groundedAnswer: string, playerQuestion: string): string {
    const allowed = new Set(extractNumbers(playerQuestion));
    return splitSentences(groundedAnswer)
      .map((sentence) => this.redactSentence(sentence, allowed))
      .join(' ');
  }

  private redactSentence(sentence: string, allowed: Set<number>): string {
    let out = sentence.replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g, REDACTION);

    const tokens = out.split(/(\s+)/);
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === undefined) continue;
      const bare = token.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '');
      if (/^[A-Z][a-z]{2,}$/.test(bare)) {
        tokens[i] = token.replace(bare, REDACTION);
      }
    }
    out = tokens.join('');

    out = out.replace(/\b\d{1,3}\b/g, (match) =>
      allowed.has(parseInt(match, 10)) ? match : REDACTION,
    );
    out = out.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, (match) => {
      const value = NUMBER_WORDS[match.toLowerCase()];
      return value !== undefined && allowed.has(value) ? match : REDACTION;
    });
    return out;
  }
}
