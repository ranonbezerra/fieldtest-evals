/** Exact refusal message returned when the sources do not cover the question. */
export const NOT_COVERED_MESSAGE = 'not covered by my sources';

/** Token the LLM is instructed to reply with when the pages lack the answer. */
export const LLM_REFUSAL_SENTINEL = 'NOT_COVERED';

export function isRefusal(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return trimmed === NOT_COVERED_MESSAGE || trimmed === LLM_REFUSAL_SENTINEL.toLowerCase();
}
