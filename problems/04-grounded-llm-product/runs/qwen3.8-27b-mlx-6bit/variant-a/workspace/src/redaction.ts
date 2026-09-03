export interface RedactionConfig {
  bossNames: string[];
}

/**
 * Redact `answer` for hint mode.
 * Removes boss names (case-insensitive), location prepositional phrases,
 * and clamps quantities to those appearing in `question`.
 * Returns the redacted text plus a list of terms that were removed.
 */
export function redactForHint(
  answer: string,
  question: string,
  config: RedactionConfig,
): { text: string; removedTerms: string[] } {
  let text = answer;
  const removedTerms: string[] = [];

  // 1. Remove boss names (case-insensitive)
  for (const name of config.bossNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "gi");
    const before = text;
    text = text.replace(re, "[REDACTED]");
    if (text !== before) {
      removedTerms.push(name);
    }
  }

  // 2. Strip location prepositional phrases: "in/on/at <CapitalizedWords>"
  // ASSUMPTION: locations are proper nouns (capitalised), so we match the
  // preposition followed by one or more capitalised word tokens.
  const locRe = /\b(?:in|on|at)\s+[A-Z]\w*(?:\s+[A-Z]\w*)*/g;
  const locFound = new Set<string>();
  text = text.replace(locRe, (match) => {
    locFound.add(match);
    return "[REDACTED]";
  });
  for (const m of locFound) {
    removedTerms.push(m);
  }

  // 3. Clamp quantities: only allow numbers that already appear in the question
  const questionNumbers = new Set(
    (question.match(/\d+/g) ?? []).map(Number),
  );
  const numRe = /\b\d+\b/g;
  const redactedNumbers = new Set<string>();
  text = text.replace(numRe, (match) => {
    if (!questionNumbers.has(Number(match))) {
      redactedNumbers.add(match);
      return "[REDACTED]";
    }
    return match;
  });
  for (const n of redactedNumbers) {
    removedTerms.push(n);
  }

  return { text, removedTerms };
}
