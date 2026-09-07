import { GroundingGate, LexicalGroundingGate } from './grounding-gate.js';
import { redactHint } from './hint-redactor.js';
import { LlmClient, LlmRequest } from './llm-client.js';
import { LLM_REFUSAL_SENTINEL, NOT_COVERED_MESSAGE } from './refusal.js';

// ASSUMPTION: the task specifies a standalone pipeline + eval harness (no API
// surface, no persistence), so the service uses plain constructor injection of
// the LLM client instead of a NestJS module; a scripted fake plugs in for
// tests and for the eval harness.

export type AnswerMode = 'answer' | 'hint';

export interface AnswerResult {
  mode: AnswerMode;
  /** The answer (or refusal message) shown to the player. */
  text: string;
  refusal: boolean;
  /** Sentences dropped by the grounding gate. */
  droppedSentences: string[];
  /** Hint mode only: the grounded full answer the hint was redacted from. */
  fullAnswer?: string;
}

export class AnswerService {
  constructor(
    private readonly llm: LlmClient,
    private readonly gate: GroundingGate = new LexicalGroundingGate(),
  ) {}

  async answer(question: string, sources: string[], mode: AnswerMode = 'answer'): Promise<AnswerResult> {
    const raw = (await this.llm.complete(this.buildPrompt(question, sources))).text;

    if (this.llmSaidNotCovered(raw)) {
      return this.refusal(mode);
    }

    const { kept, dropped } = this.gate.filter(raw, sources);
    if (kept.length === 0) {
      return this.refusal(mode);
    }

    const fullAnswer = kept.join(' ');
    if (mode === 'hint') {
      return {
        mode,
        text: redactHint(fullAnswer, question),
        refusal: false,
        droppedSentences: dropped,
        fullAnswer,
      };
    }
    return {
      mode,
      text: fullAnswer,
      refusal: false,
      droppedSentences: dropped,
    };
  }

  private refusal(mode: AnswerMode): AnswerResult {
    return { mode, text: NOT_COVERED_MESSAGE, refusal: true, droppedSentences: [] };
  }

  private llmSaidNotCovered(raw: string): boolean {
    return raw.trim() === LLM_REFUSAL_SENTINEL || /not\s+covered/i.test(raw);
  }

  private buildPrompt(question: string, sources: string[]): LlmRequest {
    const pages = sources
      .map((source, i) => `--- page ${i + 1} ---\n${source}`)
      .join('\n\n');
    return {
      system:
        'You are a game guide. Answer strictly from the wiki pages provided. ' +
        `If the pages do not contain the answer, reply exactly with: ${LLM_REFUSAL_SENTINEL}`,
      prompt: `Player question: ${question}\n\nWiki pages:\n${pages}`,
    };
  }
}
