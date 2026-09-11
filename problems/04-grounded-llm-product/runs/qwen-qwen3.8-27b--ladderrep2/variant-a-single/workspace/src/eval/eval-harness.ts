import { AnswerService } from '../answer/answer.service.js';
import { ScriptedLlmClient } from '../llm/llm.client.js';
import { combineScores, FaithfulnessJudge, HelpfulnessJudge } from './judges.js';
import type { GoldenScenario } from './scenarios.js';

export interface ScenarioResult {
  id: string;
  status: 'answered' | 'refused';
  answer: string;
  helpful: number;
  faithful: number;
  /** min(helpful, faithful) */
  score: number;
  findings: string[];
  droppedSentences: string[];
}

/**
 * Golden-scenario eval harness. A scripted fake LLM returns each scenario's
 * planted answer (including confident lies); the pipeline runs over it; and
 * two judges score the output — helpfulness and a faithfulness judge that
 * receives the source texts. Final score = min(helpful, faithful).
 */
export class EvalHarness {
  constructor(
    private readonly helpfulJudge: HelpfulnessJudge = new HelpfulnessJudge(),
    private readonly faithfulnessJudge: FaithfulnessJudge = new FaithfulnessJudge(),
  ) {}

  /** Fake LLM keyed by question: each scenario's scripted answer, planted verbatim. */
  buildLlm(scenarios: readonly GoldenScenario[]): ScriptedLlmClient {
    return new ScriptedLlmClient(
      scenarios.map((s) => ({ match: s.question, reply: s.scriptedAnswer })),
      'The provided pages do not cover this.',
    );
  }

  run(scenarios: readonly GoldenScenario[], service: AnswerService): ScenarioResult[] {
    return scenarios.map((scenario) => {
      const result = service.answer(scenario.question, scenario.sources, 'full');
      const helpful = this.helpfulJudge.judge(result.text, {
        expectedOutcome: scenario.expectedOutcome,
        expectedFacts: scenario.expectedFacts,
      });
      const faithful = this.faithfulnessJudge.judge(result.text, {
        sources: scenario.sources,
        falseFacts: scenario.falseFacts,
      });
      return {
        id: scenario.id,
        status: result.status,
        answer: result.text,
        helpful: helpful.score,
        faithful: faithful.score,
        score: combineScores(helpful.score, faithful.score),
        findings: [...helpful.findings, ...faithful.findings],
        droppedSentences: result.droppedSentences,
      };
    });
  }
}
