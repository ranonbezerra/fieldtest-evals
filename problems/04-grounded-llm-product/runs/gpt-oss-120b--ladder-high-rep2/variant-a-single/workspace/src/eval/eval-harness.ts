import { GuideAssistantService } from '../guide-assistant/guide-assistant.service.js';

/**
 * Description of a single evaluation scenario.
 */
export interface Scenario {
  /** Human‑readable name for the scenario – used in test output. */
  name: string;
  /** Player question. */
  question: string;
  /** Source wiki pages that ground the answer. */
  sources: string[];
  /** Facts that a correct answer must contain (case‑insensitive substrings). */
  expectedFacts: string[];
  /** Facts that must NOT appear in a faithful answer (e.g., invented items). */
  falseFacts: string[];
}

/**
 * Result of the two judges for a scenario.
 */
export interface JudgeResult {
  helpful: number; // 0‑1
  faithful: number; // 0‑1
  score: number; // min(helpful, faithful)
}

/**
 * Helpfulness judge – measures presence of expected facts.
 *
 * @returns 0‑1 score (0 = none of the expected facts present, 1 = all present).
 */
function helpfulnessJudge(answer: string, expectedFacts: string[]): number {
  if (expectedFacts.length === 0) {
    // No expected facts → not helpful (no answer provided).
    return 0;
  }
  const lower = answer.toLowerCase();
  const present = expectedFacts.filter((f) =>
    lower.includes(f.toLowerCase()),
  ).length;
  return present / expectedFacts.length;
}

/**
 * Faithfulness judge – ensures the answer only contains information grounded in
 * the sources and does not contain any false facts.
 *
 * The refusal phrase is considered faithful only when there were *no* expected
 * facts to begin with.
 */
function faithfulnessJudge(
  answer: string,
  sources: string[],
  falseFacts: string[],
  expectedFacts: string[],
): number {
  const lowerAnswer = answer.toLowerCase();
  const lowerSources = sources.map((s) => s.toLowerCase());

  // If any false fact appears, faithfulness is zero.
  for (const falseFact of falseFacts) {
    if (lowerAnswer.includes(falseFact.toLowerCase())) {
      return 0;
    }
  }

  // Refusal handling.
  if (answer.trim() === 'not covered by my sources') {
    // Faithful only when there was nothing the model could have answered.
    return expectedFacts.length === 0 ? 1 : 0;
  }

  // Split answer into sentences and verify each is a substring of at least one source.
  const sentences = answer
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length === 0) {
    return 0;
  }

  const groundedCount = sentences.filter((sentence) =>
    lowerSources.some((src) => src.includes(sentence.toLowerCase())),
  ).length;

  return groundedCount / sentences.length;
}

/**
 * Runs a batch of scenarios through the guide‑assistant service and returns the
 * scores produced by the two judges.
 *
 * @param service    - Instance of GuideAssistantService (already wired with a fake LLM).
 * @param scenarios  - Array of scenarios to evaluate.
 * @returns An object keyed by scenario name containing the JudgeResult.
 */
export async function runEval(
  service: GuideAssistantService,
  scenarios: Scenario[],
): Promise<Record<string, JudgeResult>> {
  const results: Record<string, JudgeResult> = {};

  for (const scenario of scenarios) {
    const answer = await service.answer(scenario.question, scenario.sources, 'full');

    const helpful = helpfulnessJudge(answer, scenario.expectedFacts);
    const faithful = faithfulnessJudge(
      answer,
      scenario.sources,
      scenario.falseFacts,
      scenario.expectedFacts,
    );
    const score = Math.min(helpful, faithful);

    results[scenario.name] = { helpful, faithful, score };
  }

  return results;
}
