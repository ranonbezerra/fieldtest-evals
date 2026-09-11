import 'reflect-metadata';
import { Inject, Injectable } from '@nestjs/common';
import { REFUSAL_TEXT, type AnswerMode, type AnswerResult } from './answer-result.js';
import { filterGroundedSentences } from './grounding-gate.js';
import { redactForHint } from './hint-redaction.js';
import { LLM_CLIENT, type LlmClient } from './llm-client.js';

@Injectable()
export class GuideService {
  constructor(@Inject(LLM_CLIENT) private readonly llm: LlmClient) {}

  /**
   * Answer a player question grounded ONLY in the fetched sources.
   * Every sentence of the model output must be supported or it is dropped;
   * if nothing survives the service refuses.
   */
  async answer(question: string, sources: string[], mode: AnswerMode): Promise<AnswerResult> {
    const raw = await this.llm.complete({ question, sources, mode });
    const { kept, dropped } = filterGroundedSentences(raw, sources);

    if (kept.length === 0) {
      // Refusing is a correct outcome, not a failure path: a supported answer
      // is the only thing worth shipping.
      return { status: 'refused', text: REFUSAL_TEXT, keptSentences: [], droppedSentences: dropped };
    }

    const groundedAnswer = kept.join(' ');
    if (mode === 'hint') {
      // Hint mode is a redaction of the answer that already passed the gate.
      return {
        status: 'answered',
        text: redactForHint(groundedAnswer, question),
        keptSentences: kept,
        droppedSentences: dropped,
      };
    }
    return {
      status: 'answered',
      text: groundedAnswer,
      keptSentences: kept,
      droppedSentences: dropped,
    };
  }
}
