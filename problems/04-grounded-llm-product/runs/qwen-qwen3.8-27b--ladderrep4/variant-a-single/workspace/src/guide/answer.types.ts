import { normalizeText } from './text-utils';

/** How the caller wants the answer shaped. 'hint' is derived by redaction, never by a second prompt. */
export type AnswerMode = 'full' | 'hint';

/**
 * What the pipeline asks the model for. Deliberately carries no mode: the
 * model always produces the full answer and hint mode redacts it. A second,
 * mode-specific prompt would be a second generation with fresh chances to
 * invent or leak.
 */
export interface LlmRequest {
  question: string;
  sources: string[];
}

/** The seam between the pipeline and any LLM backend. Tests use a scripted fake. */
export interface LlmClient {
  complete(request: LlmRequest): Promise<string>;
}

/** The exact refusal the service returns when nothing survives the grounding gate. */
export const REFUSAL_TEXT = 'not covered by my sources';

/** True when a text is (or asserts) the standard refusal. */
export function isRefusal(text: string): boolean {
  return normalizeText(text).includes(normalizeText(REFUSAL_TEXT));
}

export interface AnswerResult {
  /** The text to show the player; REFUSAL_TEXT when the gate dropped everything. */
  text: string;
  mode: AnswerMode;
  /** True when no sentence of the model's answer was supported by the sources. */
  refused: boolean;
  /** The sentences the grounding gate dropped, in original order. */
  droppedSentences: string[];
}
