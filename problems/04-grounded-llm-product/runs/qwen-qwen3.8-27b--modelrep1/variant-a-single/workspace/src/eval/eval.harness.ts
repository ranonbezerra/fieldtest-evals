import type { AnswerMode, AnswerResult, WikiPage } from '../assistant/assistant.types';
import type { AssistantService } from '../assistant/assistant.service';
import { FaithfulnessJudge, HelpfulnessJudge } from './eval.judges';
import type { FaithfulnessOutcome, HelpfulnessOutcome } from './eval.judges';

/** A golden scenario: what the player asked, what they read, what is true. */
export interface EvalScenario {
  id: string;
  question: string;
  sources: WikiPage[];
  /** Facts a good answer must cover (all of them stated in the sources). */
  expectedFacts: string[];
  /** Planted FALSE facts; repeating any of them is a lie. */
  forbiddenFacts: string[];
}

export interface ScenarioEvaluation {
  /** 0..1 */
  helpfulness: number;
  /** 0..1 */
  faithfulness: number;
  /** Final score: the min of the two judge scores. */
  score: number;
  helpfulnessDetail: HelpfulnessOutcome;
  faithfulnessDetail: FaithfulnessOutcome;
}

export interface ScenarioReport {
  scenario: EvalScenario;
  /** Raw model output, before the grounding gate. */
  modelAnswer: string;
  /** What the user actually gets: gated (and redacted in hint mode). */
  finalAnswer: AnswerResult;
  evaluation: ScenarioEvaluation;
}

/**
 * Runs golden scenarios through the answer pipeline and scores the result
 * with the helpfulness and faithfulness judges. Final score = min of the two.
 */
export class EvalHarness {
  private readonly helpfulnessJudge = new HelpfulnessJudge();
  private readonly faithfulnessJudge = new FaithfulnessJudge();

  constructor(
    private readonly service: AssistantService,
    private readonly mode: AnswerMode = 'full',
  ) {}

  /** Scores any answer text against a scenario (both judges, min-combined). */
  evaluate(scenario: EvalScenario, answerText: string): ScenarioEvaluation {
    const helpfulnessDetail = this.helpfulnessJudge.judge(answerText, scenario.expectedFacts);
    const faithfulnessDetail = this.faithfulnessJudge.judge(answerText, scenario.sources, scenario.forbiddenFacts);
    return {
      helpfulness: helpfulnessDetail.score,
      faithfulness: faithfulnessDetail.score,
      score: Math.min(helpfulnessDetail.score, faithfulnessDetail.score),
      helpfulnessDetail,
      faithfulnessDetail,
    };
  }

  /** Runs one scenario end to end: model -> grounding gate -> judges. */
  async run(scenario: EvalScenario): Promise<ScenarioReport> {
    const finalAnswer = await this.service.answer(scenario.question, scenario.sources, this.mode);
    return {
      scenario,
      modelAnswer: finalAnswer.modelText,
      finalAnswer,
      evaluation: this.evaluate(scenario, finalAnswer.text),
    };
  }
}
