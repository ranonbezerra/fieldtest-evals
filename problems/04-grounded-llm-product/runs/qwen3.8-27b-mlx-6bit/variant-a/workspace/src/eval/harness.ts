import { answer, type AnswerResult } from "../answer.js";
import type { Scenario } from "./scenarios.js";
import type { LLMClient } from "../llm-client.js";
import type { RedactionConfig } from "../redaction.js";
import { helpfulnessJudge, faithfulnessJudge } from "./judges.js";

export interface EvalResult {
  scenarioId: string;
  helpfulnessScore: number;
  faithfulnessScore: number;
  finalScore: number;
  passed: boolean;
}

export const PASS_THRESHOLD = 0.8;

export async function runEval(
  scenarios: Scenario[],
  llm: LLMClient,
  redactionConfig?: RedactionConfig,
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  for (const scenario of scenarios) {
    const result: AnswerResult = await answer(
      {
        question: scenario.question,
        sources: scenario.sources,
        mode: "full",
      },
      llm,
      redactionConfig,
    );

    const helpfulness = helpfulnessJudge(result.text, scenario.expectedFacts);
    const faithfulness = faithfulnessJudge(
      result.text,
      scenario.sources,
      scenario.plantedFalseFacts,
    );

    const finalScore = Math.min(helpfulness.score, faithfulness.score);

    results.push({
      scenarioId: scenario.id,
      helpfulnessScore: helpfulness.score,
      faithfulnessScore: faithfulness.score,
      finalScore,
      passed: finalScore >= PASS_THRESHOLD,
    });
  }

  return results;
}
