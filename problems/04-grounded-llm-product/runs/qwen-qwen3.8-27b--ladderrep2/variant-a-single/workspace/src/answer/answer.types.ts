export type AnswerMode = 'full' | 'hint';

/** Exact refusal text. Refusing is a correct outcome, not a failure path. */
export const REFUSAL_TEXT = 'not covered by my sources';

export interface AnswerResult {
  mode: AnswerMode;
  status: 'answered' | 'refused';
  /** The grounded answer, the redacted hint, or REFUSAL_TEXT. */
  text: string;
  /** Sentences the grounding gate dropped. */
  droppedSentences: string[];
}

export function isRefusal(text: string): boolean {
  return text.trim() === REFUSAL_TEXT;
}
