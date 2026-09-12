/**
 * Redacts boss names, locations, and quantities that are not mentioned in the
 * player's question. The implementation is deliberately simple – it looks for
 * capitalised phrases and number‑word patterns and removes them if they do not
 * appear in the question.
 *
 * @param answer   - The grounded answer that may contain spoilers.
 * @param question - The original player question.
 * @returns The hint‑mode answer with spoilers redacted.
 */
export function redactAnswer(answer: string, question: string): string {
  // Tokenise the question for cheap containment checks.
  const questionTokens = new Set<string>(
    question
      .toLowerCase()
      .match(/\b\w+\b/g)
      ?.map((t) => t.toLowerCase()) ?? [],
  );

  // Returns true if *all* words of the phrase appear in the question.
  const appearsInQuestion = (phrase: string): boolean => {
    const lower = phrase.toLowerCase();
    return lower
      .split(/\s+/)
      .every((w) => questionTokens.has(w));
  };

  // --- Redact capitalised phrases (e.g. "Dragonlord", "Fire Temple") ---
  const capitalisedPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
  let redacted = answer.replace(
    capitalisedPattern,
    (match: string, _p1: string, offset: number, full: string) => {
      // If the phrase appears in the question, keep it.
      if (appearsInQuestion(match)) {
        return match;
      }
      // Otherwise replace with a placeholder.
      return '[redacted]';
    },
  );

  // --- Redact quantity expressions like "5 shards" ---
  const quantityPattern = /\b\d+\s+\w+\b/g;
  redacted = redacted.replace(quantityPattern, (match: string) => {
    return appearsInQuestion(match) ? match : '[redacted]';
  });

  return redacted;
}
