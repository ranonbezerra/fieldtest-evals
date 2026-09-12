/**
 * Helpfulness judge.
 * Returns 1 if all expected facts are present and none of the false facts appear.
 * Returns 0 otherwise (including when the answer is a refusal but facts were expected).
 */
export function helpfulnessJudge(
  answer: string,
  expectedFacts: string[] = [],
  falseFacts: string[] = []
): number {
  if (answer === 'not covered by my sources') {
    return expectedFacts.length === 0 ? 1 : 0;
  }

  const lowerAnswer = answer.toLowerCase();

  const allExpectedPresent = expectedFacts.every((fact) =>
    lowerAnswer.includes(fact.toLowerCase())
  );
  const noFalsePresent = falseFacts.every(
    (fact) => !lowerAnswer.includes(fact.toLowerCase())
  );

  return allExpectedPresent && noFalsePresent ? 1 : 0;
}

/**
 * Faithfulness judge.
 * Computes the proportion of answer sentences that are grounded in the sources.
 * A pure refusal is treated as fully faithful – callers can adjust based on the
 * scenario's expectation (see `evaluateScenario`).
 */
export function faithfulnessJudge(answer: string, sources: string[]): number {
  if (answer === 'not covered by my sources') {
    return 1;
  }

  const sentences = splitIntoSentences(answer);
  if (sentences.length === 0) {
    return 1;
  }

  const groundedCount = sentences.filter((s) => isSentenceGrounded(s, sources)).length;
  return groundedCount / sentences.length;
}

/* Helper functions – duplicated from AnswerService for independence. */
function splitIntoSentences(text: string): string[] {
  const regex = /(?<=[.!?])\s+(?=[A-Z])/g;
  return text.split(regex).map((s) => s.trim()).filter(Boolean);
}

function isSentenceGrounded(sentence: string, sources: string[]): boolean {
  const normalized = sentence.toLowerCase().trim();
  return sources.some((src) => src.toLowerCase().includes(normalized));
}
