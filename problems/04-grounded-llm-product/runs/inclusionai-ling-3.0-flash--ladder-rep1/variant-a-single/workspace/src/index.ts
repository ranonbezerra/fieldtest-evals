export type { LLMClient } from "./llm-client.interface.js";
export { AnswerService, type AnswerResult, type Mode } from "./answer.service.js";
export {
  groundAnswer,
  isSentenceGrounded,
  extractProperNouns,
  extractQuantities,
  splitSentences,
} from "./grounding.gate.js";
export { redactForHint } from "./hint.redactor.js";
export {
  helpfulnessJudge,
  faithfulnessJudge,
} from "./eval.judges.js";
export { EvalHarness } from "./eval-harness.js";
export type { Scenario, EvalResult, Outcome } from "./eval-harness.js";
export {
  SCENARIO_CONFIDENT_LIE,
  SCENARIO_CORRECT,
  SCENARIO_SOURCES_LACK,
  SCENARIO_QUANTITY_ERROR,
} from "./eval-scenarios.js";
