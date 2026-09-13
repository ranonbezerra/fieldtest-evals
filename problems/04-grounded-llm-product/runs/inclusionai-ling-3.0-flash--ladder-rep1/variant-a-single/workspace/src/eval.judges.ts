/**
 * Evaluation judges.
 *
 * helpfulness  – does the answer cover the expected facts?
 * faithfulness – are the expected facts present in the answer AND in the sources?
 * Final score  – min(helpful, faithful).
 */

/**
 * Helpfulness judge.
 * Takes only the answer and the list of expected facts.
 */
export function helpfulnessJudge(
  answer: string,
  expectedFacts: string[],
): number {
  if (expectedFacts.length === 0) return 1.0;
  const lowerAnswer = answer.toLowerCase();
  const covered = expectedFacts.filter((fact) =>
    lowerAnswer.includes(fact.toLowerCase()),
  );
  return covered.length / expectedFacts.length;
}

/**
 * Faithfulness judge.
 * Takes the answer, the source texts, and the expected facts.
 * A fact counts as faithful when it appears in BOTH the answer and the sources.
 */
export function faithfulnessJudge(
  answer: string,
  sources: string[],
  expectedFacts: string[],
): number {
  if (expectedFacts.length === 0) return 1.0;
  const lowerAnswer = answer.toLowerCase();
  const sourcesText = sources.join(" ").toLowerCase();

  const faithful = expectedFacts.filter((fact) => {
    const lower = fact.toLowerCase();
    return lowerAnswer.includes(lower) && sourcesText.includes(lower);
  });

  return faithful.length / expectedFacts.length;
}
