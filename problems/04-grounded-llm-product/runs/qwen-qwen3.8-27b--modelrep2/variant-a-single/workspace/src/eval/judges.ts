import { escapeRegExp, significantTokens, splitSentences } from '../assistant/grounding.js';
import type { WikiSource } from '../assistant/types.js';

import type { FaithfulnessJudgement, FaithfulnessViolation, HelpfulnessJudgement } from './types.js';

// ---------------------------------------------------------------------------
// Helpfulness: does the answer cover the scenario's expected facts?
// A fact is covered when every significant token of the fact appears in the
// answer; numbers are significant tokens, so "4 shards" is not covered by
// "5 shards". `question` is part of the judge's contract for a future
// semantic judge; this deterministic implementation judges on the facts.
// ---------------------------------------------------------------------------
export function judgeHelpfulness(input: {
  question: string;
  answer: string;
  expectedFacts: string[];
}): HelpfulnessJudgement {
  const { answer, expectedFacts } = input;
  if (expectedFacts.length === 0) {
    return { score: 0, coveredFacts: [], missingFacts: [] };
  }

  const answerTokens = new Set(significantTokens(answer));
  const coveredFacts: string[] = [];
  const missingFacts: string[] = [];
  for (const fact of expectedFacts) {
    const factTokens = significantTokens(fact);
    const covered = factTokens.length > 0 && factTokens.every((token) => answerTokens.has(token));
    (covered ? coveredFacts : missingFacts).push(fact);
  }
  return { score: coveredFacts.length / expectedFacts.length, coveredFacts, missingFacts };
}

// ---------------------------------------------------------------------------
// Faithfulness: is the answer supported by the sources? The judge receives
// the sources. It flags proper-noun phrases absent from the sources and
// quantities whose numbers contradict the sources, reporting the exact
// claimed and source values.
// ---------------------------------------------------------------------------

const SENTENCE_STARTERS = new Set([
  'The', 'A', 'An', 'To', 'When', 'Where', 'What', 'Why', 'How', 'If', 'And', 'But', 'Or', 'So',
  'Yes', 'No', 'Not', 'You', 'We', 'They', 'It', 'I', 'He', 'She', 'This', 'That', 'These',
  'Those', 'There', 'Then', 'In', 'On', 'At', 'With', 'After', 'Before', 'Beyond', 'Under',
  'Over', 'Out', 'About', 'All', 'Any', 'Some', 'Each', 'Every',
]);

const NAME_WORD_RE = /^[A-Z][A-Za-z0-9'-]*$/;
const CONNECTIVES = /^(of|the|and|in)$/i;
const QUANTITY_RE = /\b(\d+)\s+([A-Za-z][A-Za-z'-]*)\b/g;

/** Capitalised word runs (e.g. "Sun Gate", "Vault of Echoes"), skipping sentence starters. */
export function extractEntityPhrases(sentence: string): string[] {
  const words = sentence.replace(/[.,;:!?"()]/g, ' ').split(/\s+/).filter((word) => word.length > 0);
  const phrases: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (!NAME_WORD_RE.test(word)) {
      continue;
    }
    if (i === 0 && SENTENCE_STARTERS.has(word)) {
      continue;
    }
    const phrase: string[] = [word];
    let j = i;
    while (j + 1 < words.length) {
      const next = words[j + 1];
      if (NAME_WORD_RE.test(next)) {
        phrase.push(next);
        j += 1;
      } else if (CONNECTIVES.test(next) && j + 2 < words.length && NAME_WORD_RE.test(words[j + 2])) {
        phrase.push(next, words[j + 2]);
        j += 2;
      } else {
        break;
      }
    }
    phrases.push(phrase.join(' '));
    i = j;
  }
  return phrases;
}

/** Digit quantities with their unit noun, e.g. "5 shards" -> { value: 5, unit: 'shards' }. */
export function extractQuantities(sentence: string): Array<{ value: number; unit: string }> {
  const quantities: Array<{ value: number; unit: string }> = [];
  for (const match of sentence.matchAll(QUANTITY_RE)) {
    quantities.push({ value: Number(match[1]), unit: match[2] });
  }
  return quantities;
}

function sourceValuesForUnit(sourceText: string, unit: string): number[] {
  const values: number[] = [];
  const numberBeforeUnit = new RegExp(`\\b(\\d+)\\s+${escapeRegExp(unit)}\\b`, 'gi');
  const numberAfterUnit = new RegExp(`\\b${escapeRegExp(unit)}\\b\\s+(\\d+)\\b`, 'gi');
  for (const pattern of [numberBeforeUnit, numberAfterUnit]) {
    for (const match of sourceText.matchAll(pattern)) {
      values.push(Number(match[1]));
    }
  }
  return values;
}

export function judgeFaithfulness(input: { answer: string; sources: WikiSource[] }): FaithfulnessJudgement {
  const { answer, sources } = input;
  const sourceText = sources.map((source) => source.text).join('\n');
  const sourceLower = sourceText.toLowerCase();
  const violations: FaithfulnessViolation[] = [];
  const seenEntities = new Set<string>();
  const seenQuantities = new Set<string>();

  for (const sentence of splitSentences(answer)) {
    for (const entity of extractEntityPhrases(sentence)) {
      const key = entity.toLowerCase();
      if (seenEntities.has(key)) {
        continue;
      }
      seenEntities.add(key);
      if (!sourceLower.includes(key)) {
        violations.push({ kind: 'ungrounded_entity', entity });
      }
    }

    for (const { value, unit } of extractQuantities(sentence)) {
      const unitLower = unit.toLowerCase();
      if (!sourceLower.includes(unitLower)) {
        const key = `unsupported:${unitLower}:${value}`;
        if (!seenQuantities.has(key)) {
          seenQuantities.add(key);
          violations.push({ kind: 'unsupported_quantity', unit, claimed: value });
        }
        continue;
      }
      const statedValues = sourceValuesForUnit(sourceText, unitLower);
      // Contradiction: the sources state at least one number for this unit and
      // none of them is the claimed number.
      if (statedValues.length === 0 || statedValues.includes(value)) {
        continue;
      }
      for (const sourceValue of new Set(statedValues)) {
        const key = `mismatch:${unitLower}:${value}:${sourceValue}`;
        if (!seenQuantities.has(key)) {
          seenQuantities.add(key);
          violations.push({ kind: 'quantity_mismatch', unit, claimed: value, source: sourceValue });
        }
      }
    }
  }

  return { score: Math.max(0, 1 - 0.5 * violations.length), violations };
}
