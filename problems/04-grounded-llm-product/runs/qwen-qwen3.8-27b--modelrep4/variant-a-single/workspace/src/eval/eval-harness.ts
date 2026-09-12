import { AssistantService, type AssistantAnswer } from '../assistant/assistant.service.js';
import { type LlmClient, ScriptedLlmClient } from '../assistant/llm-client.js';
import { judgeFaithfulness, judgeHelpfulness, type JudgeReport } from './judges.js';

export interface GoldenScenario {
  id: string;
  question: string;
  /** 2-3 fetched wiki page texts, exactly as the product receives them. */
  sources: string[];
  /** Facts the answer must convey for the scenario to count as helpful. */
  expectedFacts: string[];
  /**
   * FALSE statements planted in this scenario's scripted LLM output (e.g. an
   * invented item requirement). If the final answer asserts one, the
   * faithfulness judge must flag it.
   */
  plantedFalseFacts: string[];
  /** True when the sources intentionally lack the answer. */
  expectedRefusal?: boolean;
  /** What the scripted LLM returns for this scenario. */
  scriptedAnswer: string;
}

export interface ScenarioResult {
  id: string;
  answer: AssistantAnswer;
  helpfulness: JudgeReport;
  faithfulness: JudgeReport;
  /** Contract: the final score is the min of the two judge scores. */
  finalScore: number;
}

export interface EvalReport {
  scenarios: ScenarioResult[];
  averageScore: number;
}

export function makeScriptedLlmClient(scenario: GoldenScenario): LlmClient {
  return new ScriptedLlmClient(() => scenario.scriptedAnswer);
}

/**
 * Eval harness. Drives the grounded-answer pipeline over the golden scenarios
 * with a scripted LLM (one per scenario, full mode) and scores each result
 * with the helpfulness and faithfulness judges. The final score per scenario
 * is the min of the two judge scores.
 */
export async function runEval(
  scenarios: GoldenScenario[],
  makeLlmClient: (scenario: GoldenScenario) => LlmClient = makeScriptedLlmClient,
): Promise<EvalReport> {
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    // A fresh service per scenario so the scripted client is the pipeline's
    // only LLM for that scenario's run.
    const service = new AssistantService(makeLlmClient(scenario));
    const answer = await service.answer(scenario.question, scenario.sources, 'full');
    const helpfulness = judgeHelpfulness(answer, scenario);
    const faithfulness = judgeFaithfulness(answer, scenario.sources, scenario.plantedFalseFacts);
    results.push({
      id: scenario.id,
      answer,
      helpfulness,
      faithfulness,
      finalScore: Math.min(helpfulness.score, faithfulness.score),
    });
  }
  const averageScore =
    results.length > 0 ? results.reduce((sum, r) => sum + r.finalScore, 0) / results.length : 0;
  return { scenarios: results, averageScore };
}
