import { AnswerService } from '../guide/answer.service';
import type { LlmClient } from '../guide/answer.types';
import { ScriptedLlmClient } from '../guide/scripted-llm.client';
import type { GoldenScenario } from './eval-scenarios';
import { combineScores, judgeFaithfulness, judgeHelpfulness } from './judges';

export interface EvalResult {
  scenarioId: string;
  question: string;
  /** What the scripted model produced. */
  rawAnswer: string;
  /** What the pipeline returned after the grounding gate. */
  answer: string;
  refused: boolean;
  droppedSentences: string[];
  helpfulness: number;
  faithfulness: number;
  /** min(helpfulness, faithfulness) — the weak judge wins. */
  score: number;
}

/**
 * Runs the golden scenarios end to end: each scenario gets a scripted model
 * (its planted answer, lie or guess), the full pipeline runs on it, and both
 * judges score the result. The faithfulness judge receives the sources.
 */
export class EvalHarness {
  constructor(private readonly buildLlm: (scenario: GoldenScenario) => LlmClient) {}

  async run(scenarios: readonly GoldenScenario[]): Promise<EvalResult[]> {
    const results: EvalResult[] = [];
    for (const scenario of scenarios) {
      const service = new AnswerService(this.buildLlm(scenario));
      const result = await service.answer(scenario.question, scenario.sources, 'full');
      const faithful = judgeFaithfulness(result.text, scenario.sources, scenario);
      const helpful = judgeHelpfulness(result.text, scenario);
      results.push({
        scenarioId: scenario.id,
        question: scenario.question,
        rawAnswer: scenario.scriptedAnswer,
        answer: result.text,
        refused: result.refused,
        droppedSentences: result.droppedSentences,
        helpfulness: helpful.score,
        faithfulness: faithful.score,
        score: combineScores(helpful.score, faithful.score),
      });
    }
    return results;
  }
}

/** A harness wired with the scripted fake, keyed by question. */
export function createEvalHarness(): EvalHarness {
  return new EvalHarness(
    (scenario) => new ScriptedLlmClient({ [scenario.question]: scenario.scriptedAnswer }),
  );
}
