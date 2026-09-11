import { Inject, Injectable } from '@nestjs/common';
import { REFUSAL_TEXT, type AnswerMode, type AnswerResult, type LlmClient } from './answer.types';
import { LLM_CLIENT } from './llm.client';
import { gateAnswer } from './grounding';
import { redactForHint } from './redaction';

/**
 * The answer pipeline. One LLM call per answer: the grounding gate keeps only
 * the sentences the sources support, and hint mode redacts the gated answer
 * instead of re-prompting. A second generation is a fresh chance to invent or
 * leak; a redaction cannot do either.
 */
@Injectable()
export class AnswerService {
  constructor(@Inject(LLM_CLIENT) private readonly llm: LlmClient) {}

  async answer(question: string, sources: string[], mode: AnswerMode): Promise<AnswerResult> {
    const raw = await this.llm.complete({ question, sources });
    const gated = gateAnswer(raw, sources);
    if (gated.refused) {
      return { text: REFUSAL_TEXT, mode, refused: true, droppedSentences: gated.dropped };
    }
    const text = mode === 'hint' ? redactForHint(gated.text, question) : gated.text;
    return { text, mode, refused: false, droppedSentences: gated.dropped };
  }
}
