import { Injectable } from '@nestjs/common';
import { AnswerService } from './answer.service';

/**
 * Scenario definition for the evaluation harness.
 */
export interface EvalScenario {
  /** Player question */
  question: string;
  /** Wiki page texts */
  sources: string[];
  /** Facts that *must* appear in a correct answer */
  expectedFacts: string[];
  /** Facts that must *not* appear (planted falsehoods) */
  falseFacts: string[];
}

/** Result of evaluating a single scenario */
export interface EvalResult {
  helpfulness: number; // 0 or 1
  faithfulness: number; // 0 or 1
  final: number; // min(helpfulness, faithfulness)
}

/**
 * Simple evaluation harness.
 *
 * - Helpfulness: all expected facts are present (exact substring match).
 * - Faithfulness: no false facts are present and the answer is grounded.
 *
 * The service uses the AnswerService under the hood, so the same grounding rules
 * apply to both the production pipeline and the evaluation.
 */
@Injectable()
export class EvalService {
  constructor(private readonly answerService: AnswerService) {}

  async evaluate(scenario: EvalScenario): Promise<EvalResult> {
    const answer = await this.answerService.answer(
      scenario.question,
      scenario.sources,
      'full',
    );

    // If the service refused, both scores are 0.
    if (answer === 'not covered by my sources') {
      return { helpfulness: 0, faithfulness: 0, final: 0 };
    }

    const helpfulness = this.checkHelpfulness(answer, scenario.expectedFacts);
    const faithfulness = this.checkFaithfulness(
      answer,
      scenario.falseFacts,
    );

    const final = Math.min(helpfulness, faithfulness);
    return { helpfulness, faithfulness, final };
  }

  private checkHelpfulness(answer: string, expected: string[]): number {
    for (const fact of expected) {
      if (!answer.toLowerCase().includes(fact.toLowerCase())) {
        return 0;
      }
    }
    return 1;
  }

  private checkFaithfulness(answer: string, falseFacts: string[]): number {
    for (const fact of falseFacts) {
      if (answer.toLowerCase().includes(fact.toLowerCase())) {
        return 0;
      }
    }
    // Grounding was already verified inside AnswerService; reaching here means
    // the answer is grounded.
    return 1;
  }
}
