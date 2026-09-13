import { LLMClient } from "./llm-client.interface.js";
import { AnswerService, Mode } from "./answer.service.js";
import {
  helpfulnessJudge,
  faithfulnessJudge,
} from "./eval.judges.js";

export type Outcome = "answered" | "refused";

export interface Scenario {
  name: string;
  question: string;
  sources: string[];
  expectedFacts: string[];
  plantedFalseFacts: string[];
  llmResponse: string;
  expectedOutcome: Outcome;
}

export interface EvalResult {
  scenarioName: string;
  answer: string;
  status: string;
  helpfulScore: number;
  faithfulScore: number;
  finalScore: number;
  correct: boolean;
}

export class EvalHarness {
  constructor(private readonly llmFactory: (response: string) => LLMClient) {}

  async run(scenarios: Scenario[], mode: Mode = "normal"): Promise<EvalResult[]> {
    return Promise.all(
      scenarios.map((scenario) => this.evaluate(scenario, mode)),
    );
  }

  private async evaluate(
    scenario: Scenario,
    mode: Mode,
  ): Promise<EvalResult> {
    const llm = this.llmFactory(scenario.llmResponse);
    const service = new AnswerService(llm);
    const result = await service.answer(
      scenario.question,
      scenario.sources,
      mode,
    );

    const content =
      result.status === "refused" ? result.message : result.content;

    const helpfulScore = helpfulnessJudge(content, scenario.expectedFacts);
    const faithfulScore = faithfulnessJudge(
      content,
      scenario.sources,
      scenario.expectedFacts,
    );
    const finalScore = Math.min(helpfulScore, faithfulScore);

    const correct =
      result.status === "refused"
        ? scenario.expectedOutcome === "refused"
        : scenario.expectedOutcome === "answered";

    return {
      scenarioName: scenario.name,
      answer: content,
      status: result.status,
      helpfulScore,
      faithfulScore,
      finalScore,
      correct,
    };
  }
}
