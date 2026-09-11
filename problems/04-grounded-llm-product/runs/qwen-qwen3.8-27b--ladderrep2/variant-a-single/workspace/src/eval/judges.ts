import {
  checkQuantities,
  escapeRegExp,
  extractProperNouns,
  NUMBER_WORD_BY_VALUE,
  splitSentences,
  toNumber,
  tokenize,
} from '../answer/text-utils.js';
import { isRefusal } from '../answer/answer.types.js';
import type { ExpectedOutcome } from './scenarios.js';

export interface JudgeVerdict {
  /** Score in [0, 1]. */
  score: number;
  findings: string[];
}

/** Tokens with numbers normalised to words, so "4" and "four" match. */
function normalizedTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const t of tokenize(text)) {
    const n = toNumber(t);
    tokens.add(n !== null ? (NUMBER_WORD_BY_VALUE[n] ?? t.toLowerCase()) : t.toLowerCase());
  }
  return tokens;
}

/** A fact is present when every one of its tokens appears in the text. */
export function factPresent(fact: string, text: string): boolean {
  const factTokens = normalizedTokens(fact);
  if (factTokens.size === 0) return false;
  const textTokens = normalizedTokens(text);
  for (const t of factTokens) if (!textTokens.has(t)) return false;
  return true;
}

export interface HelpfulnessExpectation {
  expectedOutcome: ExpectedOutcome;
  expectedFacts: readonly string[];
}

/**
 * Helpfulness: does the output deliver what the player needs? A refusal is
 * helpful only when the sources do not cover the question; an answer is
 * helpful in proportion to the expected facts it actually carries.
 */
export class HelpfulnessJudge {
  judge(answer: string, expectation: HelpfulnessExpectation): JudgeVerdict {
    const refused = isRefusal(answer);

    if (expectation.expectedOutcome === 'refusal') {
      return refused
        ? { score: 1, findings: [] }
        : { score: 0, findings: ['expected a refusal (sources lack the answer) but got an answer'] };
    }
    if (refused) {
      return {
        score: 0,
        findings: ['useless refusal: the sources cover the question but the service refused'],
      };
    }

    const facts = expectation.expectedFacts;
    if (facts.length === 0) return { score: 1, findings: [] };
    const missing = facts.filter((f) => !factPresent(f, answer));
    return {
      score: (facts.length - missing.length) / facts.length,
      findings: missing.map((f) => `missing expected fact: ${f}`),
    };
  }
}

export interface FaithfulnessContext {
  /** The source texts — part of the signature on purpose: without them the judge could only score fluency. */
  sources: string[];
  /** Planted false facts the answer must not contain. */
  falseFacts: readonly string[];
}

/**
 * Faithfulness: is everything claimed in the answer supported by the sources
 * it was given? Checks planted false facts, exact quantities, and proper
 * nouns against the source texts.
 */
export class FaithfulnessJudge {
  judge(answer: string, context: FaithfulnessContext): JudgeVerdict {
    const findings: string[] = [];
    let checks = 0;
    let violations = 0;

    for (const falseFact of context.falseFacts) {
      checks += 1;
      if (factPresent(falseFact, answer)) {
        violations += 1;
        findings.push(`answer contains a fact the sources do not support: "${falseFact}"`);
      }
    }

    for (const check of checkQuantities(answer, context.sources)) {
      checks += 1;
      if (!check.grounded && check.reason) {
        violations += 1;
        findings.push(check.reason);
      }
    }

    const names = new Set(splitSentences(answer).flatMap((s) => extractProperNouns(s)));
    for (const name of names) {
      checks += 1;
      const inSources = context.sources.some(
        (s) => new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(s),
      );
      if (!inSources) {
        violations += 1;
        findings.push(`"${name}" is not in the sources`);
      }
    }

    return { score: checks === 0 ? 1 : 1 - violations / checks, findings };
  }
}

/** Final score: min(helpful, faithful) — averaging would let a fluent lie hide. */
export function combineScores(helpfulness: number, faithfulness: number): number {
  return Math.min(helpfulness, faithfulness);
}
