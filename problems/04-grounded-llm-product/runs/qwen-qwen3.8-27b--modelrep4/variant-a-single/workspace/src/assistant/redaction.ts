/**
 * Spoiler-free hint derivation.
 *
 * A hint is the full grounded answer with spoilers redacted - it is never a
 * second LLM call. Redaction rules:
 *
 *   - a quantity (digit or number word) not already mentioned in the question
 *     -> "[?]"
 *   - a named entity (proper noun) not already mentioned in the question
 *     -> "[REDACTED]"
 *
 * ASSUMPTION: no spoiler taxonomy (boss list, location list) is provided, so
 * spoilers are identified as the proper nouns of the pages: every named
 * entity (bosses, places, items) not already in the player's question is
 * redacted. Over-redaction is the safe failure mode.
 */
import { NUMBER_WORDS, STOPWORDS, isDigit, tokenize } from './grounding.js';

const QUANTITY_REDACTED = '[?]';
const ENTITY_REDACTED = '[REDACTED]';

/**
 * Redact `answer` (the grounded full answer) into a spoiler-free hint for the
 * player who asked `question`. Names and quantities the player already
 * mentioned stay visible.
 */
export function redactForHint(answer: string, question: string): string {
  const questionTokens = tokenize(question);
  const questionTokenSet = new Set(questionTokens);
  const questionDigits = new Set(questionTokens.filter(isDigit));

  return answer.replace(/[\p{L}0-9]+/gu, (word) => {
    const lower = word.toLowerCase();

    // Quantity? A literal digit, or a number word such as "four".
    const digit = isDigit(lower) ? lower : (NUMBER_WORDS[lower] ?? null);
    if (digit !== null) {
      return questionDigits.has(digit) ? word : QUANTITY_REDACTED;
    }

    // Named entity? A capitalized word the question never mentions.
    if (/^[\p{Lu}]/u.test(word) && !STOPWORDS.has(lower) && !questionTokenSet.has(lower)) {
      return ENTITY_REDACTED;
    }

    return word;
  });
}
