export type AnswerMode = 'full' | 'hint';

export interface WikiSource {
  id: string;
  title: string;
  text: string;
}

export type AnswerStatus = 'answered' | 'refused';

export interface GuideAnswer {
  status: AnswerStatus;
  mode: AnswerMode;
  /** Final answer text; empty when status is 'refused'. */
  text: string;
  /** Exact refusal phrase; null when status is 'answered'. */
  refusalReason: string | null;
  /** Sentences the grounding gate dropped. */
  droppedSentences: string[];
  /** IDs of sources that grounded at least one kept sentence. */
  sourcesUsed: string[];
}

export const REFUSAL_MESSAGE = 'not covered by my sources';

/**
 * What the service hands to the model. Note there is no mode field on purpose:
 * hint mode must never change the prompt (no re-prompting).
 */
export interface LlmPrompt {
  question: string;
  sources: WikiSource[];
}

export interface LlmClient {
  complete(prompt: LlmPrompt): Promise<string>;
}
