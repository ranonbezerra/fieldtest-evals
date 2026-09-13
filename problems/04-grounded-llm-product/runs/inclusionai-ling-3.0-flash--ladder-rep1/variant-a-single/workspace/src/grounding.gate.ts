/**
 * Sentence-level grounding gate.
 *
 * Each sentence of the model's answer is checked against the source texts.
 * A sentence is dropped when any of its claims (proper nouns, quantities)
 * are not supported by the sources.  If no sentence survives the service
 * refuses with "not covered by my sources".
 */

/** Split raw text into sentences on whitespace following terminal punctuation. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Extract proper-noun phrases: sequences of capitalized words. */
export function extractProperNouns(sentence: string): string[] {
  const matches: string[] = [];
  const regex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(sentence)) !== null) {
    matches.push(match[0]);
  }
  return [...new Set(matches)];
}

/** Extract quantity pairs: <number> <noun>. */
export function extractQuantities(
  sentence: string,
): Array<{ number: number; noun: string }> {
  const quantities: Array<{ number: number; noun: string }> = [];
  const regex = /\b(\d+)\s+([a-z]+(?:\s+[a-z]+)*)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(sentence)) !== null) {
    quantities.push({
      number: parseInt(match[1], 10),
      noun: match[2].toLowerCase(),
    });
  }
  return quantities;
}

/**
 * Return true when every proper noun in the sentence appears in the sources
 * and every quantity in the sentence is also confirmed by the sources.
 */
export function isSentenceGrounded(
  sentence: string,
  sources: string[],
): boolean {
  const sourcesText = sources.join(" ").toLowerCase();

  for (const noun of extractProperNouns(sentence)) {
    if (!sourcesText.includes(noun.toLowerCase())) {
      return false;
    }
  }

  for (const qty of extractQuantities(sentence)) {
    const confirmed = sources.some((source) => {
      const s = source.toLowerCase();
      return (
        s.includes(`${qty.number} ${qty.noun}`) ||
        s.includes(`${qty.noun} ${qty.number}`)
      );
    });
    if (!confirmed) return false;
  }

  return true;
}

/**
 * Apply the grounding gate.
 * Returns the joined grounded sentences, or null when nothing survives.
 */
export function groundAnswer(
  response: string,
  sources: string[],
): string | null {
  const grounded = splitSentences(response).filter((s) =>
    isSentenceGrounded(s, sources),
  );
  if (grounded.length === 0) return null;
  return grounded.join(" ");
}
