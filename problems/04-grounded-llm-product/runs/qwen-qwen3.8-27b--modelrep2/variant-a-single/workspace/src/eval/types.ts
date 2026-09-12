import type { WikiSource } from '../assistant/types.js';

/**
 * A golden scenario: the question, the fetched sources, the facts a correct
 * answer must cover, and FALSE facts planted in the scripted model answer
 * (hallucinations the judges must catch).
 */
export interface GoldenScenario {
  id: string;
  description: string;
  question: string;
  sources: WikiSource[];
  /** Facts a correct answer must cover. */
  expectedFacts: string[];
  /** FALSE facts planted in the scripted model answer (e.g. invented item requirements). */
  plantedFalseFacts: string[];
  /** Exactly what the scripted LLM returns for this scenario. */
  scriptedAnswer: string;
  /** When true, the correct pipeline behaviour is to refuse. */
  expectRefusal?: boolean;
}

export interface HelpfulnessJudgement {
  score: number;
  coveredFacts: string[];
  missingFacts: string[];
}

export type FaithfulnessViolation =
  | { kind: 'ungrounded_entity'; entity: string }
  | { kind: 'quantity_mismatch'; unit: string; claimed: number; source: number }
  | { kind: 'unsupported_quantity'; unit: string; claimed: number };

export interface FaithfulnessJudgement {
  score: number;
  violations: FaithfulnessViolation[];
}

export interface ScenarioEvaluation {
  scenarioId: string;
  description: string;
  refused: boolean;
  answer: string;
  helpfulness: HelpfulnessJudgement;
  faithfulness: FaithfulnessJudgement;
  /** min(helpfulness, faithfulness); 0 when the pipeline refused. */
  finalScore: number;
  verdict: 'pass' | 'fail';
}

export interface EvalReport {
  evaluations: ScenarioEvaluation[];
  summary: { total: number; passed: number; failed: number };
}
