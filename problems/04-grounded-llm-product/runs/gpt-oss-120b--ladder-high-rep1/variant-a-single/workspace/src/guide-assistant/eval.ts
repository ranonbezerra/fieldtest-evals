import { AnswerService, AnswerMode } from './answer.service';
import { helpfulnessJudge, faithfulnessJudge } from './judges';
import { FakeLLMClient } from './fake-llm-client';

/**
 * Definition of a golden evaluation scenario.
 */
export interface Scenario {
  id: string;
  question: string;
  sources: string[];
  /** Facts that a correct answer should contain. */
  expectedFacts?: string[];
  /** Facts that must NOT appear in a correct answer. */
  falseFacts?: string[];
  /** When true the system is expected to refuse because the answer is absent from sources. */
  shouldRefuse?: boolean;
  /** The raw answer the fake LLM will emit (pre‑grounding). */
  fakeAnswer: string;
}

/**
 * Factory type used by the harness to instantiate a fresh AnswerService for each scenario.
 */
type AnswerServiceFactory = (llmAnswer: string) => AnswerService;

/**
 * Result of evaluating a single scenario.
 */
export interface EvaluationResult {
  scenarioId: string;
  helpfulness: number;
  faithfulness: number;
  finalScore: number;
}

/**
 * Runs a scenario through the AnswerService (with a scripted fake LLM) and computes
 * helpfulness, faithfulness and the final min‑score.
 */
export async function evaluateScenario(
  scenario: Scenario,
  answerServiceFactory: AnswerServiceFactory,
  mode: AnswerMode = 'full'
): Promise<EvaluationResult> {
  const answerService = answerServiceFactory(scenario.fakeAnswer);
  const answer = await answerService.answer(scenario.question, scenario.sources, mode);

  const helpful = helpfulnessJudge(answer, scenario.expectedFacts ?? [], scenario.falseFacts ?? []);
  const faithfulRaw = faithfulnessJudge(answer, scenario.sources);

  // Adjust scores based on whether a refusal was expected.
  const helpfulScore =
    scenario.shouldRefuse && answer === 'not covered by my sources' ? 1 : helpful;

  const faithfulScore =
    scenario.shouldRefuse && answer === 'not covered by my sources'
      ? 1
      : !scenario.shouldRefuse && answer === 'not covered by my sources'
      ? 0
      : faithfulRaw;

  const finalScore = Math.min(helpfulScore, faithfulScore);

  return {
    scenarioId: scenario.id,
    helpfulness: helpfulScore,
    faithfulness: faithfulScore,
    finalScore,
  };
}
