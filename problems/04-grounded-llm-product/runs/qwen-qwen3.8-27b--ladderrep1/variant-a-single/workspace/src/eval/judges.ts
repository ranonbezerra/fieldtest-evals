// The judges. The faithfulness judge receives the source texts: scoring an
// answer without the sources in front of it rewards confidence and fluency,
// which is exactly what a hallucination has most of.

import type { AnswerResult } from '../guide/answer-result.js';
import { checkSentence, splitSentences } from '../guide/grounding-gate.js';
import type { GoldenScenario } from './golden-scenarios.js';

const normalizePhrase = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Did the answer do what the scenario asks? For refusal scenarios the
 * refusal is the helpful outcome; for answer scenarios a refusal is a
 * confident useless refusal and scores 0.
 */
export function scoreHelpfulness(result: AnswerResult, scenario: GoldenScenario): number {
  if (scenario.expectedRefusal) {
    return result.status === 'refused' ? 1 : 0;
  }
  if (result.status === 'refused') return 0;
  if (scenario.expectedFacts.length === 0) return 1;
  const text = normalizePhrase(result.text);
  const hits = scenario.expectedFacts.filter((fact) =>
    text.includes(normalizePhrase(fact)),
  ).length;
  return hits / scenario.expectedFacts.length;
}

/**
 * Is the answer supported by the sources? Every kept sentence must be
 * grounded, and no planted false fact may survive. A refusal asserts
 * nothing, so it is faithful.
 */
export function scoreFaithfulness(
  result: AnswerResult,
  sources: string[],
  scenario: GoldenScenario,
): number {
  if (result.status === 'refused') return 1;
  const sentences = splitSentences(result.text);
  if (sentences.length === 0) return 1;
  const grounded = sentences.filter((sentence) => checkSentence(sentence, sources).grounded)
    .length;
  let score = grounded / sentences.length;
  const text = normalizePhrase(result.text);
  for (const falseFact of scenario.falseFacts) {
    if (text.includes(normalizePhrase(falseFact))) score = 0; // planted lie survived: disqualify
  }
  return score;
}
