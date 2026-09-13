/**
 * Helpers that score answers.
 *
 * - `helpfulnessJudge` checks that all expected facts appear and that no false
 *   facts appear.
 * - `faithfulnessJudge` verifies that every sentence in the answer is supported
 *   by at least one source text.
 *
 * Both judges return a score in the range [0, 1] (binary for this simple
 * harness). The final score for a scenario is `Math.min(helpful, faithful)`.
 */

export interface Scenario {
  /** Human‑readable identifier, useful for debugging. */
  id: string;
  question: string;
  sources: string[];
  /** Facts that *must* be present in a correct answer. */
  expectedFacts: string[];
  /** Facts that must *not* appear (hallucinations). */
  falseFacts: string[];
  /** What the fake LLM will return for this scenario. */
  llmAnswer: string;
}

/**
 * Returns 1 if every expected fact is present (case‑insensitive) and no false
 * fact is present, otherwise 0.
 */
export function helpfulnessJudge(
  answer: string,
  expectedFacts: string[],
  falseFacts: string[],
): number {
  const lowered = answer.toLowerCase();

  // All expected facts must be present.
  for (const fact of expectedFacts) {
    if (!lowered.includes(fact.toLowerCase())) {
      return 0;
    }
  }

  // No false fact may be present.
  for (const fact of falseFacts) {
    if (lowered.includes(fact.toLowerCase())) {
      return 0;
    }
  }

  return 1;
}

/**
 * Returns 1 if every sentence of the answer is supported by at least one source
 * (or the answer is the refusal string). Otherwise returns 0.
 */
export function faithfulnessJudge(
  answer: string,
  sources: string[],
): number {
  if (answer === 'not covered by my sources') {
    // No content => trivially faithful.
    return 1;
  }

  const sentences = answer
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const loweredSources = sources.map((s) => s.toLowerCase());

  for (const sentence of sentences) {
    const lowered = sentence.toLowerCase();
    const supported = loweredSources.some((src) => src.includes(lowered));
    if (!supported) {
      return 0;
    }
  }

  return 1;
}
