import { checkGrounding, contentWords, quantityMentions, splitSentences } from '../assistant/assistant.grounding';
import type { GroundingIssue } from '../assistant/assistant.grounding';
import { REFUSAL_TEXT } from '../assistant/assistant.types';
import type { WikiPage } from '../assistant/assistant.types';

/**
 * Deterministic judges for the eval harness (no LLM judge: golden scenarios
 * make rule-based judging exact and repeatable).
 */

/** Minimum fraction of a fact's content words that must appear in the text. */
const FACT_MATCH_THRESHOLD = 0.8;

function singularize(unit: string): string {
  return unit.length > 1 && unit.endsWith('s') && !unit.endsWith('ss') ? unit.slice(0, -1) : unit;
}

/**
 * A fact is present in a text when at least FACT_MATCH_THRESHOLD of its
 * content words occur in the text AND every quantity the fact states is
 * stated with the same value in the text. Quantities are always enforced:
 * "4 shards" is not present in a text that says "5 shards".
 */
export function factMatches(fact: string, text: string): boolean {
  const factWords = contentWords(fact);
  const textWords = contentWords(text);
  if (factWords.size > 0) {
    let hits = 0;
    for (const word of factWords) {
      if (textWords.has(word)) hits += 1;
    }
    if (hits / factWords.size < FACT_MATCH_THRESHOLD) return false;
  }
  const textQuantities = quantityMentions(text);
  for (const quantity of quantityMentions(fact)) {
    const present = textQuantities.some(
      (other) => other.value === quantity.value && singularize(other.unit) === singularize(quantity.unit),
    );
    if (!present) return false;
  }
  return true;
}

/** Refusals (and empty answers) are not statements that can be unfaithful. */
export function isRefusal(answer: string): boolean {
  const trimmed = answer.trim();
  return trimmed === '' || trimmed === REFUSAL_TEXT;
}

export interface HelpfulnessOutcome {
  /** 0..1 */
  score: number;
  matchedFacts: string[];
  missingFacts: string[];
}

/**
 * Helpful = covers every expected fact (all of which the sources state).
 * When the sources lack the answer entirely (no expected facts), the helpful
 * response is a refusal.
 */
export class HelpfulnessJudge {
  judge(answer: string, expectedFacts: string[]): HelpfulnessOutcome {
    if (isRefusal(answer)) {
      return {
        score: expectedFacts.length === 0 ? 1 : 0,
        matchedFacts: [],
        missingFacts: [...expectedFacts],
      };
    }
    const matchedFacts = expectedFacts.filter((fact) => factMatches(fact, answer));
    const missingFacts = expectedFacts.filter((fact) => !factMatches(fact, answer));
    return {
      score: expectedFacts.length === 0 ? 0 : matchedFacts.length / expectedFacts.length,
      matchedFacts,
      missingFacts,
    };
  }
}

export interface FaithfulnessSentence {
  sentence: string;
  grounded: boolean;
  issues: GroundingIssue[];
}

export interface FaithfulnessOutcome {
  /** 0..1 */
  score: number;
  sentences: FaithfulnessSentence[];
  /** Planted false facts the answer repeats. */
  violatedFacts: string[];
}

/**
 * Faithful = every sentence is source-grounded (quantity-aware) and no
 * planted false fact is repeated. Repeating a known false fact sinks the
 * score to 0: a confident lie is the worst failure mode.
 */
export class FaithfulnessJudge {
  judge(answer: string, sources: WikiPage[], forbiddenFacts: string[] = []): FaithfulnessOutcome {
    if (isRefusal(answer)) {
      return { score: 1, sentences: [], violatedFacts: [] };
    }
    const sentences: FaithfulnessSentence[] = splitSentences(answer).map((sentence) => {
      const verdict = checkGrounding(sentence, sources);
      return { sentence, grounded: verdict.grounded, issues: verdict.issues };
    });
    const groundedCount = sentences.filter((entry) => entry.grounded).length;
    const sentenceScore = sentences.length === 0 ? 0 : groundedCount / sentences.length;
    const violatedFacts = forbiddenFacts.filter((fact) => factMatches(fact, answer));
    return { score: violatedFacts.length > 0 ? 0 : sentenceScore, sentences, violatedFacts };
  }
}
