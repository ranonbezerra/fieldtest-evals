import {
  assessAnswer,
  buildKeyset,
  isStopword,
  numberValues,
  spokenNumberValue,
  tokenize,
  wordForms,
} from '../guide/grounding';
import { REFUSAL } from '../guide/llm.client';
import type { GoldenScenario } from './golden-scenarios';

/** True when the text is the refusal (or empty): it asserts nothing. */
export function isRefusal(answer: string): boolean {
  const normalized = answer.trim().toLowerCase().replace(/[.!?\s]+$/, '');
  return normalized === '' || normalized === REFUSAL;
}

/**
 * Faithfulness: what fraction of the answer's sentences is supported by the
 * source pages? A refusal asserts nothing, so it is maximally faithful.
 *
 * The judge receives the sources on purpose. A judge without them scores
 * confidence and fluency — exactly what a hallucination has most of.
 */
export function judgeFaithfulness(answer: string, sources: string[], question = ''): number {
  if (isRefusal(answer)) return 1;
  const assessment = assessAnswer(answer, sources, question);
  if (assessment.sentences.length === 0) return 1;
  return assessment.groundedCount / assessment.sentences.length;
}

function factIsCovered(answer: string, fact: string): boolean {
  const keyset = buildKeyset(answer);
  const numbers = new Set<number>(numberValues(answer));
  for (const token of tokenize(fact)) {
    if (isStopword(token)) continue;
    if (/^\d+$/.test(token)) {
      if (!numbers.has(parseInt(token, 10))) return false;
      continue;
    }
    const spoken = spokenNumberValue(token);
    if (spoken !== null) {
      if (!numbers.has(spoken)) return false;
      continue;
    }
    if (!wordForms(token).some(form => keyset.has(form))) return false;
  }
  return true;
}

/**
 * Helpfulness: did the answer actually serve the question? A refusal is
 * helpful only when the sources do not contain the answer. Any planted false
 * fact appearing in the answer zeroes the score.
 */
export function judgeHelpfulness(answer: string, scenario: GoldenScenario): number {
  if (isRefusal(answer)) return scenario.expectsRefusal ? 1 : 0;
  if (scenario.expectsRefusal) return 0;
  if (scenario.falseFacts.some(fact => factIsCovered(answer, fact))) return 0;
  if (scenario.expectedFacts.length === 0) return 1;
  const covered = scenario.expectedFacts.filter(fact => factIsCovered(answer, fact)).length;
  return covered / scenario.expectedFacts.length;
}
