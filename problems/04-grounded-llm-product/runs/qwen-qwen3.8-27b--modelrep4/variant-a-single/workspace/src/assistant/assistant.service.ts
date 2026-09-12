import { Inject, Injectable } from '@nestjs/common';

import { applyGroundingGate } from './grounding.js';
import { LLM_CLIENT, type LlmClient } from './llm-client.js';
import { redactForHint } from './redaction.js';

/** User-facing refusal when the fetched pages do not cover the question. */
export const REFUSAL_MESSAGE = 'not covered by my sources';

export type AnswerMode = 'full' | 'hint';

export interface AssistantAnswer {
  status: 'answered' | 'refused';
  /** The answer text; exactly REFUSAL_MESSAGE when refused. */
  text: string;
}

@Injectable()
export class AssistantService {
  constructor(@Inject(LLM_CLIENT) private readonly llm: LlmClient) {}

  /**
   * Answer the player's question using ONLY the fetched pages.
   *
   * The LLM output is gated sentence by sentence: ungrounded sentences are
   * dropped, and if none survive the service refuses with REFUSAL_MESSAGE.
   * Hint mode is derived by redacting the grounded full answer; the LLM is
   * never re-prompted (the prompt never mentions the mode).
   */
  async answer(question: string, sources: string[], mode: AnswerMode = 'full'): Promise<AssistantAnswer> {
    const raw = await this.llm.complete(this.buildPrompt(question, sources));
    const gated = applyGroundingGate(raw, sources);
    if (gated.refused) {
      return { status: 'refused', text: REFUSAL_MESSAGE };
    }
    if (mode === 'hint') {
      return { status: 'answered', text: redactForHint(gated.text, question) };
    }
    return { status: 'answered', text: gated.text };
  }

  private buildPrompt(question: string, sources: string[]): string {
    const pages = sources.map((page, i) => `[page ${i + 1}]\n${page}`).join('\n\n');
    return [
      'You are a game guide assistant.',
      'Answer using ONLY the wiki pages provided below.',
      'Never invent names, items, locations, or quantities.',
      `If the pages do not contain the answer, reply exactly: ${REFUSAL_MESSAGE}`,
      '',
      `QUESTION:\n${question}`,
      '',
      `WIKI PAGES:\n${pages}`,
    ].join('\n');
  }
}
