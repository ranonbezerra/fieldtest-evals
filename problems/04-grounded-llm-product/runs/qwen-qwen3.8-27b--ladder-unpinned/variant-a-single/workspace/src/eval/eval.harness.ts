import { AssistantService } from '../assistant/assistant.service';
import type { LlmClient } from '../assistant/assistant.llm-client';
import { goldenScenarios, type GoldenScenario } from './eval.golden-scenarios';
import { helpfulnessJudge, faithfulnessJudge } from './eval.judges';

export interface ScenarioResult {
  id: string;
  answer: string;
  isRefusal: boolean;
  helpfulness: number;
  faithfulness: number;
  score: number;
}

export interface EvalReport {
  scenarios: ScenarioResult[];
  overallScore: number;
}

// ASSUMPTION: The service signals refusal by returning the literal string
// 'not covered by my sources' rather than throwing or using a structured envelope.
const REFUSAL_MESSAGE = 'not covered by my sources';

export function createEvalService(llmClient: LlmClient): AssistantService {
  return new AssistantService(llmClient);
}

export async function runEval(
  service: AssistantService,
  scenarios: GoldenScenario[] = goldenScenarios,
): Promise<EvalReport> {
  const scenarioResults: ScenarioResult[] = [];

  for (const scenario of scenarios) {
    const answer = await service.answer(scenario.question, scenario.sources, 'full');
    const isRefusal = answer === REFUSAL_MESSAGE;

    const helpfulness = helpfulnessJudge(answer, scenario.expectedFacts);
    const faithfulness = faithfulnessJudge(answer, scenario.sources);
    const score = Math.min(helpfulness, faithfulness);

    scenarioResults.push({
      id: scenario.id,
      answer,
      isRefusal,
      helpfulness,
      faithfulness,
      score,
    });
  }

  const overallScore =
    scenarioResults.length > 0
      ? scenarioResults.reduce((sum, r) => sum + r.score, 0) / scenarioResults.length
      : 0;

  return { scenarios: scenarioResults, overallScore };
}
