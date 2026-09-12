import { GuideService } from '../guide/guide.service.js';
import { Scenario } from './scenario.js';
import { faithfulnessJudge, helpfulnessJudge } from './judge.js';

export interface EvaluationResult {
  scenarioId: string;
  answer: string;
  helpfulness: number;
  faithfulness: number;
  finalScore: number; // min(helpful, faithful)
}

/**
 * Runs a list of scenarios through the GuideService and returns scores.
 *
 * The service must already be instantiated with a suitable LLM client (scripted in tests).
 */
export async function evaluateScenarios(
  service: GuideService,
  scenarios: Scenario[],
): Promise<EvaluationResult[]> {
  const results: EvaluationResult[] = [];

  for (const sc of scenarios) {
    const answer = await service.answer(
      sc.question,
      sc.sources,
      sc.mode ?? 'full',
    );

    const helpful = helpfulnessJudge(answer, sc);
    const faithful = faithfulnessJudge(answer, sc);
    const finalScore = Math.min(helpful, faithful);

    results.push({
      scenarioId: sc.id,
      answer,
      helpfulness: helpful,
      faithfulness: faithful,
      finalScore,
    });
  }

  return results;
}
