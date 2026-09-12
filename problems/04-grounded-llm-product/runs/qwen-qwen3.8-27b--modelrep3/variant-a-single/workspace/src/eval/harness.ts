import type { GuideService } from '../guide/guide.service.js';
import type { GuideAnswer } from '../guide/guide.types.js';
import { faithfulnessJudge, helpfulnessJudge } from './judges.js';
import type { JudgeVerdict } from './judges.js';
import type { GoldenScenario } from './scenarios.js';

/** A scenario passes when its final score reaches this bar. */
export const PASS_THRESHOLD = 0.8;

export interface ScenarioReport {
  scenarioId: string;
  answer: GuideAnswer;
  helpfulness: JudgeVerdict;
  faithfulness: JudgeVerdict;
  /** min(helpfulness, faithfulness): one weak judge sinks the scenario. */
  finalScore: number;
  pass: boolean;
}

export async function runScenario(service: GuideService, scenario: GoldenScenario): Promise<ScenarioReport> {
  const answer = await service.answer(scenario.question, scenario.sources, 'full');
  const helpfulness = helpfulnessJudge(answer.text, scenario.expectedFacts);
  const faithfulness = faithfulnessJudge(answer.text, scenario.sources, scenario.plantedFalseFacts);
  const finalScore = Math.min(helpfulness.score, faithfulness.score);
  return {
    scenarioId: scenario.id,
    answer,
    helpfulness,
    faithfulness,
    finalScore,
    pass: finalScore >= PASS_THRESHOLD,
  };
}

export async function runSuite(service: GuideService, scenarios: GoldenScenario[]): Promise<ScenarioReport[]> {
  const reports: ScenarioReport[] = [];
  for (const scenario of scenarios) {
    reports.push(await runScenario(service, scenario));
  }
  return reports;
}
