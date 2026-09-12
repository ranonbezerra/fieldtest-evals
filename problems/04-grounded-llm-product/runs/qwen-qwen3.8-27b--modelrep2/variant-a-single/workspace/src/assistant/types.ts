/** Answer modes: 'full' is the grounded answer, 'hint' its spoiler-free redaction. */
export type AnswerMode = 'full' | 'hint';

/** One fetched wiki page. */
export interface WikiSource {
  id: string;
  title: string;
  text: string;
}

/** Exact message the service returns when the sources do not cover the question. */
export const REFUSAL_MESSAGE = 'not covered by my sources';

export interface AnsweredResult {
  mode: AnswerMode;
  status: 'answered';
  answer: string;
  /** Sentences the LLM produced that failed the grounding gate. */
  droppedSentences: string[];
}

export interface RefusedResult {
  mode: AnswerMode;
  status: 'refused';
  answer: typeof REFUSAL_MESSAGE;
  droppedSentences: string[];
}

export type AnswerResult = AnsweredResult | RefusedResult;
