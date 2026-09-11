import { isRefusal } from '../guide/answer.types';
import { gateAnswer } from '../guide/grounding';
import { normalizeText } from '../guide/text-utils';
import type { Fact, GoldenScenario } from './eval-scenarios';

export interface JudgeResult {
  /** 0..1 */
  score: number;
  /** Developer-facing explanation of what the judge saw. */
  reasons: string[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** A planted false fact is asserted when any of its markers appears. */
function falseFactPresent(answer: string, fact: Fact): boolean {
  const normalized = normalizeText(answer);
  return fact.markers.some((marker) => normalized.includes(normalizeText(marker)));
}

/** An expected fact counts as covered only when every marker appears. */
function expectedFactCovered(answer: string, fact: Fact): boolean {
  const normalized = normalizeText(answer);
  return fact.markers.length > 0 && fact.markers.every((marker) => normalized.includes(normalizeText(marker)));
}

/**
 * The faithfulness judge. It receives the source texts — without them it
 * would be scoring confidence and fluency, which is exactly what a
 * hallucination has most of. It checks the answer sentence by sentence
 * against the sources and flags every planted false fact it finds.
 */
export function judgeFaithfulness(answer: string, sources: string[], scenario: GoldenScenario): JudgeResult {
  if (isRefusal(answer)) {
    return { score: 1, reasons: ['A refusal claims nothing, so it cannot be unfaithful.'] };
  }
  const { dropped } = gateAnswer(answer, sources);
  const falseHits = scenario.falseFacts.filter((fact) => falseFactPresent(answer, fact));
  const score = clamp01(1 - 0.5 * dropped.length - falseHits.length);
  const reasons: string[] = [];
  if (dropped.length > 0) {
    reasons.push(`${dropped.length} sentence(s) the sources do not support: ${dropped.join(' | ')}`);
  }
  for (const fact of falseHits) {
    reasons.push(`asserts a planted false fact: ${fact.statement}`);
  }
  if (reasons.length === 0) {
    reasons.push('Every sentence is supported by the sources and no planted false fact appears.');
  }
  return { score, reasons };
}

/**
 * The helpfulness judge. It knows the question, the facts a good answer
 * contains, and whether the sources support an answer at all. A refusal in an
 * answerable scenario is a useless refusal; a confident guess in an
 * unanswerable one is the dangerous kind.
 */
export function judgeHelpfulness(answer: string, scenario: GoldenScenario): JudgeResult {
  if (scenario.expectsRefusal === true) {
    if (isRefusal(answer)) {
      return { score: 1, reasons: ['The sources lack the answer, so a clean refusal is the useful response.'] };
    }
    return { score: 0.1, reasons: ['The sources lack the answer; anything that sounds like an answer is guessing.'] };
  }
  if (isRefusal(answer)) {
    return { score: 0.1, reasons: ['The sources contain the answer, so refusing is a useless refusal.'] };
  }
  if (scenario.expectedFacts.length === 0) {
    return { score: 0.5, reasons: ['No expected facts declared; partial credit for answering at all.'] };
  }
  const covered = scenario.expectedFacts.filter((fact) => expectedFactCovered(answer, fact));
  const score = covered.length / scenario.expectedFacts.length;
  const reasons = scenario.expectedFacts.map(
    (fact) => `${expectedFactCovered(answer, fact) ? 'has' : 'missing'}: ${fact.statement}`,
  );
  return { score, reasons };
}

/** The combined score: the weak judge wins. Averaging would let a fluent lie hide. */
export function combineScores(helpfulness: number, faithfulness: number): number {
  return Math.min(helpfulness, faithfulness);
}
