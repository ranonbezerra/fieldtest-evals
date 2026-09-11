import { Inject, Injectable } from '@nestjs/common';
import { assessAnswer } from './grounding';
import { buildPrompt, LlmClient, REFUSAL } from './llm.client';
import { redactForHint } from './redaction';

export type GuideMode = 'full' | 'hint';

export interface GuideAnswerInput {
  question: string;
  sources: string[];
  mode: GuideMode;
}

export interface GuideResult {
  /** The grounded answer, the refusal phrase, or (in hint mode) the redaction of either. */
  answer: string;
  refused: boolean;
  mode: GuideMode;
  totalSentences: number;
  droppedSentences: number;
}

/**
 * Production path: exactly one LLM call, then the sentence-level grounding
 * gate. Ungrounded sentences are dropped; if none survive, the service
 * refuses. Refusing is a correct outcome, not a failure path.
 * Hint mode never re-prompts: it redacts the answer that passed the gate.
 */
@Injectable()
export class GuideService {
  constructor(@Inject(LlmClient) private readonly llm: LlmClient) {}

  async answer(input: GuideAnswerInput): Promise<GuideResult> {
    const raw = await this.llm.complete(buildPrompt(input.question, input.sources));
    const assessment = assessAnswer(raw, input.sources, input.question);
    const kept = assessment.sentences.filter(sentence => sentence.grounded).map(sentence => sentence.text);
    const refused = kept.length === 0;
    let answer = refused ? REFUSAL : kept.join(' ');
    if (input.mode === 'hint') {
      answer = redactForHint(answer, input.question);
    }
    return {
      answer,
      refused,
      mode: input.mode,
      totalSentences: assessment.sentences.length,
      droppedSentences: assessment.sentences.length - kept.length,
    };
  }
}
