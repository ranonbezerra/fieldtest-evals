import { buildPrompt } from '../guide/llm.client';
import type { LlmClient } from '../guide/llm.client';
import { GuideService } from '../guide/guide.service';
import type { GoldenScenario } from './golden-scenarios';
import { judgeFaithfulness, judgeHelpfulness } from './judges';

export interface EvalRun {
  scenarioId: string;
  /** The model's raw generation. This is what the judges score. */
  rawReply: string;
  /** What the production path (gate, mode) would actually ship. */
  systemAnswer: string;
  systemRefused: boolean;
  helpful: number;
  faithful: number;
  /**
   * Final score: min(helpful, faithful). A fluent lie cannot hide behind
   * fluency and a confident useless refusal cannot hide behind honesty.
   */
  score: number;
}

export interface EvalReport {
  runs: EvalRun[];
  /** Mean of the scenario scores. */
  overall: number;
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

export class EvalHarness {
  constructor(
    private readonly service: GuideService,
    private readonly llm: LlmClient,
  ) {}

  async run(scenarios: readonly GoldenScenario[]): Promise<EvalReport> {
    const runs: EvalRun[] = [];
    for (const scenario of scenarios) {
      const rawReply = await this.llm.complete(buildPrompt(scenario.question, scenario.sources));
      const system = await this.service.answer({
        question: scenario.question,
        sources: scenario.sources,
        mode: 'full',
      });
      const helpful = judgeHelpfulness(rawReply, scenario);
      const faithful = judgeFaithfulness(rawReply, scenario.sources, scenario.question);
      runs.push({
        scenarioId: scenario.id,
        rawReply,
        systemAnswer: system.answer,
        systemRefused: system.refused,
        helpful: round(helpful),
        faithful: round(faithful),
        score: round(Math.min(helpful, faithful)),
      });
    }
    const overall =
      runs.length === 0
        ? 0
        : runs.reduce((sum, run) => sum + run.score, 0) / runs.length;
    return { runs, overall: round(overall) };
  }
}
