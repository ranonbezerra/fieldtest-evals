import type { LlmClient } from '../llm/llm.client.js';
import { REFUSAL_TEXT, type AnswerMode, type AnswerResult } from './answer.types.js';
import { GroundingGate } from './grounding-gate.js';
import { HintRedactor } from './hint-redactor.js';

// ASSUMPTION: the task defines no API layer, so the pipeline is plain
// TypeScript with constructor injection rather than NestJS module wiring.
export class AnswerService {
  constructor(
    private readonly llm: LlmClient,
    private readonly gate: GroundingGate = new GroundingGate(),
    private readonly redactor: HintRedactor = new HintRedactor(),
  ) {}

  /**
   * The production pipeline:
   *  1. one LLM call, always prompting for the full grounded answer
   *     (hint mode never re-prompts — that was the spoiler bug);
   *  2. a sentence-level grounding gate drops every unsupported sentence;
   *  3. if nothing survives, refuse: "not covered by my sources";
   *  4. in hint mode, redact the surviving answer instead of regenerating it.
   */
  answer(question: string, sources: string[], mode: AnswerMode = 'full'): AnswerResult {
    const raw = this.llm.complete({ prompt: buildPrompt(question, sources) }).text;
    const report = this.gate.evaluate(raw, sources);

    if (report.groundedSentences.length === 0) {
      // Refusing is a correct outcome, not a failure path.
      return { mode, status: 'refused', text: REFUSAL_TEXT, droppedSentences: report.droppedSentences };
    }

    const grounded = report.groundedSentences.join(' ');
    if (mode === 'hint') {
      return {
        mode,
        status: 'answered',
        text: this.redactor.redact(grounded, question),
        droppedSentences: report.droppedSentences,
      };
    }
    return { mode, status: 'answered', text: grounded, droppedSentences: report.droppedSentences };
  }
}

function buildPrompt(question: string, sources: string[]): string {
  return [
    'You are a game guide assistant. Answer the player question using ONLY the wiki pages provided below.',
    'Do not invent items, quantities, or places. If the pages do not cover the question, say exactly that.',
    '',
    'Wiki pages:',
    ...sources.map((page, i) => `--- Page ${i + 1} ---\n${page}`),
    '',
    `Player question: ${question}`,
  ].join('\n');
}
