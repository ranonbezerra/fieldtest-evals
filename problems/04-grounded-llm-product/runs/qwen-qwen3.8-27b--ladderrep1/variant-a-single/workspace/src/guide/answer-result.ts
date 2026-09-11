export type AnswerMode = 'full' | 'hint';

/** Exact phrase the service returns when the grounding gate drops everything. */
export const REFUSAL_TEXT = 'not covered by my sources';

export interface AnswerResult {
  status: 'answered' | 'refused';
  text: string;
  /** Grounded sentences that survived the gate. */
  keptSentences: string[];
  /** Sentences the grounding gate dropped. */
  droppedSentences: string[];
}
