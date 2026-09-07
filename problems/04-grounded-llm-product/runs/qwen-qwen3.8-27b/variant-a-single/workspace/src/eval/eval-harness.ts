import { AnswerService, type AnswerMode } from '../answer/answer-service.js';
import { LlmClient, ScriptedLlmClient } from '../answer/llm-client.js';
import { FaithfulnessJudge, HelpfulnessJudge } from './judges.js';

/**
 * A golden scenario pairs a question with wiki-page fixtures and a scripted
 * LLM reply (the fake client's canned output). `expectedFacts` are the facts a
 * good answer must contain; `plantedFalseFacts` are false claims (e.g. an
 * invented item requirement) planted in the scripted reply that a faithful
 * answer must not contain; `expectRefusal` marks scenarios whose sources lack
 * the answer, where the correct behaviour is a refusal.
 */
export interface GoldenScenario {
  id: string;
  description?: string;
  question: string;
  sources: string[];
  mode?: AnswerMode;
  /** Scripted reply the fake LLM returns for this scenario. */
  llmReply: string;
  expectedFacts: string[];
  plantedFalseFacts?: string[];
  expectRefusal?: boolean;
}

export interface ScenarioReport {
  id: string;
  mode: AnswerMode;
  text: string;
  refusal: boolean;
  helpfulness: number;
  faithfulness: number;
  finalScore: number;
  pass: boolean;
}

export interface EvalReport {
  reports: ScenarioReport[];
  average: number;
  passed: boolean;
}

export interface EvalOptions {
  threshold?: number;
  makeLlm?: (scenario: GoldenScenario) => LlmClient;
  faithfulnessJudge?: FaithfulnessJudge;
  helpfulnessJudge?: HelpfulnessJudge;
}

export const DEFAULT_PASS_THRESHOLD = 0.75;

/**
 * Runs every scenario through the answer pipeline and scores each result with
 * the helpfulness judge and the faithfulness judge (which receives the
 * sources). Final score = min(helpfulness, faithfulness).
 */
export async function runEval(
  scenarios: GoldenScenario[],
  options: EvalOptions = {},
): Promise<EvalReport> {
  const threshold = options.threshold ?? DEFAULT_PASS_THRESHOLD;
  const makeLlm = options.makeLlm ?? ((scenario: GoldenScenario) => ScriptedLlmClient.fromText(scenario.llmReply));
  const faithfulnessJudge = options.faithfulnessJudge ?? new FaithfulnessJudge();
  const helpfulnessJudge = options.helpfulnessJudge ?? new HelpfulnessJudge();

  const reports: ScenarioReport[] = [];
  for (const scenario of scenarios) {
    const mode = scenario.mode ?? 'answer';
    const service = new AnswerService(makeLlm(scenario));
    const result = await service.answer(scenario.question, scenario.sources, mode);

    const helpfulness = helpfulnessJudge.judge(result.text, {
      expectedFacts: scenario.expectedFacts,
      expectRefusal: scenario.expectRefusal,
    });
    const faithfulness = faithfulnessJudge.judge(result.text, scenario.sources, {
      plantedFalseFacts: scenario.plantedFalseFacts,
    });
    const finalScore = Math.min(helpfulness, faithfulness);

    reports.push({
      id: scenario.id,
      mode,
      text: result.text,
      refusal: result.refusal,
      helpfulness,
      faithfulness,
      finalScore,
      pass: finalScore >= threshold,
    });
  }

  const average =
    reports.length > 0 ? reports.reduce((sum, report) => sum + report.finalScore, 0) / reports.length : 0;
  return { reports, average, passed: reports.every((report) => report.pass) };
}
