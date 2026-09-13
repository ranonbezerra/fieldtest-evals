import type { LLMClient } from './llm-client.interface.js';
import { GroundingGate } from './grounding-gate.js';
import { HintRedactor, RedactionConfig } from './hint-mode.js';

/**
 * Answer service — the production path for `answer(question, sources, mode)`.
 *
 * - `answer` mode: LLM generates → grounding gate → grounded answer or refusal.
 * - `hint` mode:   LLM generates → grounding gate → redaction (no second LLM call).
 */
export class AnswerService {
  constructor(
    private readonly llm: LLMClient,
    private readonly redactionConfig: RedactionConfig,
  ) {}

  async answer(
    question: string,
    sources: string[],
    mode: 'answer' | 'hint' = 'answer',
  ): Promise<string> {
    const rawAnswer = await this.llm.generate(question, sources, mode);
    const grounded = this.applyGroundingGate(rawAnswer, sources);

    if (mode === 'hint') {
      if (grounded === 'not covered by my sources') {
        return grounded;
      }
      return this.redactHint(grounded, question);
    }

    return grounded;
  }

  private applyGroundingGate(answer: string, sources: string[]): string {
    const gate = new GroundingGate(sources);
    const supported = gate.gate(answer);
    return supported.length > 0 ? supported.join(' ') : 'not covered by my sources';
  }

  private redactHint(answer: string, question: string): string {
    const redactor = new HintRedactor(this.redactionConfig);
    return redactor.redact(answer, question);
  }
}
