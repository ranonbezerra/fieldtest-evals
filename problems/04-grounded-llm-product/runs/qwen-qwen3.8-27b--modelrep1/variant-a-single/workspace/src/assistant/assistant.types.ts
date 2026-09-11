/**
 * Shared types for the grounded answer pipeline.
 */

/** A fetched wiki page. The assistant may ground answers in nothing else. */
export interface WikiPage {
  id: string;
  title: string;
  text: string;
}

/** 'full' answers directly; 'hint' is a spoiler-free redaction of the full answer. */
export type AnswerMode = 'full' | 'hint';

/** Result of one AssistantService.answer() call. */
export interface AnswerResult {
  mode: AnswerMode;
  /** Final user-facing text, or REFUSAL_TEXT when nothing is grounded. */
  text: string;
  /** Raw model output, before the grounding gate (for eval reporting). */
  modelText: string;
  /** True when every sentence was dropped by the grounding gate. */
  refused: boolean;
  /** Ungrounded sentences the gate dropped, in original order. */
  dropped: string[];
}

/** The exact refusal message required by the product spec. */
export const REFUSAL_TEXT = 'not covered by my sources';
