import { Scenario } from './scenario.js';

/**
 * Helper utilities shared by the judges.
 */
function containsAll(answer: string, substrings: string[]): boolean {
  const lowered = answer.toLowerCase();
  return substrings.every((sub) => lowered.includes(sub.toLowerCase()));
}

/**
 * Faithfulness judge – checks that the answer is fully grounded in the sources.
 *
 * Returns a score between 0 and 1.
 */
export function faithfulnessJudge(
  answer: string,
  scenario: Scenario,
): number {
  // If the service refused, that is faithful only when sources really lack the answer.
  if (answer === 'not covered by my sources') {
    // If any expected fact appears in the sources, a refusal is unfaithful.
    const sourceText = scenario.sources.join(' ').toLowerCase();
    const anyExpectedInSources = scenario.expectedFacts.some((f: string) =>
      sourceText.includes(f.toLowerCase()),
    );
    return anyExpectedInSources ? 0 : 1;
  }

  // Simple faithfulness: every expected fact must be present, and no false fact may be present.
  const hasAllExpected = containsAll(answer, scenario.expectedFacts);
  const hasNoFalse = scenario.falseFacts.every(
    (f: string) => !answer.toLowerCase().includes(f.toLowerCase()),
  );

  return hasAllExpected && hasNoFalse ? 1 : 0;
}

/**
 * Helpfulness judge – rewards presence of expected facts and penalises false facts.
 *
 * Returns a score between 0 and 1.
 */
export function helpfulnessJudge(
  answer: string,
  scenario: Scenario,
): number {
  if (answer === 'not covered by my sources') {
    // A refusal is helpful only when the answer truly cannot be found.
    const sourceText = scenario.sources.join(' ').toLowerCase();
    const anyExpectedInSources = scenario.expectedFacts.some((f: string) =>
      sourceText.includes(f.toLowerCase()),
    );
    return anyExpectedInSources ? 0 : 1;
  }

  const expectedPresent = scenario.expectedFacts.filter((f: string) =>
    answer.toLowerCase().includes(f.toLowerCase()),
  ).length;
  const falsePresent = scenario.falseFacts.filter((f: string) =>
    answer.toLowerCase().includes(f.toLowerCase()),
  ).length;

  const precision = expectedPresent / scenario.expectedFacts.length;
  const penalty = falsePresent > 0 ? 0 : 1; // any false fact makes score 0

  return precision * penalty;
}
