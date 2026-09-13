/**
 * Hint-mode redaction.
 *
 * Derived purely from the grounded answer — no second LLM call.
 * Removes:
 *   1. All proper nouns (boss names, locations, etc.)
 *   2. Any quantity not mentioned in the player's question
 */

import { extractProperNouns, extractQuantities } from "./grounding.gate.js";

/** Remove all proper-noun phrases, replacing them with [REDACTED]. */
function redactProperNouns(text: string): string {
  return text.replace(
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g,
    "[REDACTED]",
  );
}

/** Remove every number whose value is not present in the question. */
function redactUnmentionedQuantities(
  text: string,
  question: string,
): string {
  const allowed = new Set(
    extractQuantities(question).map((q) => q.number),
  );
  return text.replace(/\b(\d+)\b/g, (match) => {
    return allowed.has(parseInt(match, 10)) ? match : "[REDACTED]";
  });
}

/**
 * Produce a spoiler-free hint from the grounded answer.
 */
export function redactForHint(answer: string, question: string): string {
  let result = redactProperNouns(answer);
  result = redactUnmentionedQuantities(result, question);
  return result.replace(/\s+/g, " ").trim();
}
