import type { WikiSource } from '../guide/guide.types.js';
import { escapeRegExp, isSentenceGrounded, splitSentences } from '../guide/grounder.js';

export interface JudgeVerdict {
  /** 0..1 */
  score: number;
  findings: string[];
}

function containsFact(text: string, fact: string): boolean {
  const t = text.toLowerCase();
  const f = fact.toLowerCase().trim();
  if (f.length === 0) return true;
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(f)}(?:[^a-z0-9]|$)`).test(t);
}

/** Helpful = covers the expected facts. A refusal covers nothing. */
export function helpfulnessJudge(answerText: string, expectedFacts: string[]): JudgeVerdict {
  if (answerText.trim().length === 0) {
    return { score: 0, findings: ['answer is empty (refusal) - no expected fact can be covered'] };
  }
  const findings: string[] = [];
  let hits = 0;
  for (const fact of expectedFacts) {
    if (containsFact(answerText, fact)) {
      hits += 1;
    } else {
      findings.push(`missing expected fact: "${fact}"`);
    }
  }
  return {
    score: expectedFacts.length === 0 ? 1 : hits / expectedFacts.length,
    findings,
  };
}

/**
 * Faithful = every sentence is supported by the sources (the judge receives
 * the sources, not the scenario) and no planted false fact slips through.
 * A single planted false fact sinks the score to 0.
 */
export function faithfulnessJudge(
  answerText: string,
  sources: WikiSource[],
  plantedFalseFacts: string[],
): JudgeVerdict {
  if (answerText.trim().length === 0) {
    return { score: 1, findings: ['no claims made (refusal)'] };
  }
  const findings: string[] = [];
  const sentences = splitSentences(answerText);
  const supported = sentences.filter((s) => isSentenceGrounded(s, sources).grounded).length;
  const sentenceRatio = sentences.length === 0 ? 1 : supported / sentences.length;
  if (sentenceRatio < 1) {
    findings.push(`${sentences.length - supported} of ${sentences.length} sentences are not supported by the sources`);
  }
  for (const fact of plantedFalseFacts) {
    if (containsFact(answerText, fact)) {
      findings.push(`planted false fact present: "${fact}"`);
    }
  }
  if (findings.some((f) => f.startsWith('planted false fact'))) {
    return { score: 0, findings };
  }
  return { score: sentenceRatio, findings };
}
