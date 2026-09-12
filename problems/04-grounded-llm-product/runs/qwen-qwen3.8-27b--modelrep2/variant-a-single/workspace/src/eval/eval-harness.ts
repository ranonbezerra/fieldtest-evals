import { significantTokens } from '../assistant/grounding.js';
import { AssistantService } from '../assistant/assistant.service.js';
import { ScriptedLlmClient } from '../assistant/llm-client.js';
import { REFUSAL_MESSAGE } from '../assistant/types.js';

import { judgeFaithfulness, judgeHelpfulness } from './judges.js';
import type { EvalReport, GoldenScenario, ScenarioEvaluation } from './types.js';

/** A non-refused scenario passes when its final score reaches this. */
export const PASS_THRESHOLD = 0.8;

/** Guards the fixture: every planted false fact must actually appear in the scripted answer. */
export function validateScenario(scenario: GoldenScenario): void {
  const answerTokens = new Set(significantTokens(scenario.scriptedAnswer));
  for (const fact of scenario.plantedFalseFacts) {
    const factTokens = significantTokens(fact);
    if (factTokens.length === 0 || !factTokens.every((token) => answerTokens.has(token))) {
      throw new Error(`Scenario ${scenario.id}: planted false fact "${fact}" is not present in the scripted answer.`);
    }
  }
}

/** Scripted LLM that replays each scenario's scripted answer for its question. */
export function scriptedLlmFor(scenarios: GoldenScenario[]): ScriptedLlmClient {
  return new ScriptedLlmClient((request) => {
    for (const scenario of scenarios) {
      if (request.user.includes(scenario.question)) {
        return scenario.scriptedAnswer;
      }
    }
    return REFUSAL_MESSAGE;
  });
}

export async function evaluateScenario(
  scenario: GoldenScenario,
  pipeline: AssistantService,
): Promise<ScenarioEvaluation> {
  const result = await pipeline.answer(scenario.question, scenario.sources, 'full');

  if (result.status === 'refused') {
    // A refusal helps nobody (helpfulness 0) but asserts nothing false
    // (faithfulness 1); the final score is therefore 0.
    return {
      scenarioId: scenario.id,
      description: scenario.description,
      refused: true,
      answer: result.answer,
      helpfulness: { score: 0, coveredFacts: [], missingFacts: scenario.expectedFacts },
      faithfulness: { score: 1, violations: [] },
      finalScore: 0,
      verdict: scenario.expectRefusal ? 'pass' : 'fail',
    };
  }

  const helpfulness = judgeHelpfulness({
    question: scenario.question,
    answer: result.answer,
    expectedFacts: scenario.expectedFacts,
  });
  const faithfulness = judgeFaithfulness({ answer: result.answer, sources: scenario.sources });

  // Final score is the minimum of the two judges: one weak judge sinks the answer.
  const finalScore = Math.min(helpfulness.score, faithfulness.score);
  const verdict = scenario.expectRefusal ? 'fail' : finalScore >= PASS_THRESHOLD ? 'pass' : 'fail';

  return {
    scenarioId: scenario.id,
    description: scenario.description,
    refused: false,
    answer: result.answer,
    helpfulness,
    faithfulness,
    finalScore,
    verdict,
  };
}

/** Runs the full golden evaluation: pipeline + both judges, one evaluation per scenario. */
export async function runGoldenEval(scenarios: GoldenScenario[]): Promise<EvalReport> {
  for (const scenario of scenarios) {
    validateScenario(scenario);
  }
  const pipeline = new AssistantService(scriptedLlmFor(scenarios));
  const evaluations: ScenarioEvaluation[] = [];
  for (const scenario of scenarios) {
    evaluations.push(await evaluateScenario(scenario, pipeline));
  }
  const passed = evaluations.filter((evaluation) => evaluation.verdict === 'pass').length;
  return {
    evaluations,
    summary: { total: evaluations.length, passed, failed: evaluations.length - passed },
  };
}
