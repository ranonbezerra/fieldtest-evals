/**
 * Spoiler-free hint redaction.
 *
 * A hint is derived from the already-grounded full answer by redaction only;
 * it never issues a second LLM call. The redaction is lexical:
 *
 *   - proper-noun entities (boss names, named items, named places)
 *       -> "the/a hidden name"
 *     // ASSUMPTION: without a name taxonomy a lexical redactor cannot tell a
 *     // boss name from a named item, so every proper-noun entity is redacted
 *     // to a generic placeholder.
 *   - item locations (objects of location prepositions) -> "a hidden place"
 *   - quantities (number + unit) -> "several <unit>", unless the exact same
 *     quantity + unit already appears in the player's question (known to them)
 */

import {
  IDIOMATIC_UNITS,
  STOPWORDS,
  extractSentenceAtoms,
  findEntities,
  singularize,
  splitSentences,
  toNumber,
} from './grounding-gate.js';

export const NAME_PLACEHOLDER = 'hidden name';
export const PLACE_PLACEHOLDER = 'a hidden place';

const LOCATION_RE =
  /\b(in|at|on|under|behind|inside|beyond|beside|near)\s+(?:(?:the|a|an)\s+)?([A-Za-z][a-z-]*)/gi;

/** Location words that reveal nothing ("at the end", "in the air"). */
const HARMLESS_LOCATION_WORDS = new Set([
  'end', 'time', 'way', 'game', 'air', 'ground', 'cost',
  'day', 'night', 'morning', 'evening',
  'minute', 'hour', 'second',
  'place', 'position', 'door', 'edge', 'line', 'side',
]);

const QUANTITY_RE =
  /(\b\d{1,3}\b|\bone\b|\btwo\b|\bthree\b|\bfour\b|\bfive\b|\bsix\b|\bseven\b|\beight\b|\bnine\b|\bten\b)(?:\s+([a-z][a-z-]*))?/gi;

function redactLocations(sentence: string): string {
  return sentence.replace(LOCATION_RE, (full: string, prep: string, word: string) => {
    const lowered = word.toLowerCase();
    if (HARMLESS_LOCATION_WORDS.has(lowered) || STOPWORDS.has(lowered)) return full;
    return `${prep} ${PLACE_PLACEHOLDER}`;
  });
}

function redactNames(sentence: string): string {
  const entities = findEntities(sentence);
  for (let i = entities.length - 1; i >= 0; i -= 1) {
    const entity = entities[i];
    const before = sentence.slice(0, entity.index);
    const precededByArticle = /(?:^|\s)(?:the|a|an)\s$/i.test(before);
    const replacement = precededByArticle ? `the ${NAME_PLACEHOLDER}` : `a ${NAME_PLACEHOLDER}`;
    sentence = `${before}${replacement}${sentence.slice(entity.index + entity.raw.length)}`;
  }
  return sentence;
}

function quantityKeysIn(text: string): Set<string> {
  const keys = new Set<string>();
  for (const sentence of splitSentences(text)) {
    for (const atom of extractSentenceAtoms(sentence)) {
      if (atom.kind === 'quantity') keys.add(`${atom.number}:${atom.unit}`);
    }
  }
  return keys;
}

function redactQuantities(sentence: string, playerKnown: Set<string>): string {
  return sentence.replace(QUANTITY_RE, (full: string, numToken: string, unitToken?: string) => {
    const number = toNumber(numToken);
    if (number === null) return full;
    if (unitToken === undefined || unitToken === null) return 'a few';
    const unit = unitToken.toLowerCase();
    if (IDIOMATIC_UNITS.has(unit)) return full;
    if (STOPWORDS.has(unit)) return `a few ${unitToken}`;
    if (playerKnown.has(`${number}:${singularize(unit)}`)) return full;
    return `several ${unitToken}`;
  });
}

function capitalizeFirst(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export function redactHint(fullAnswer: string, question: string): string {
  const playerKnown = quantityKeysIn(question);
  return splitSentences(fullAnswer)
    .map((sentence) =>
      capitalizeFirst(redactQuantities(redactNames(redactLocations(sentence)), playerKnown)),
    )
    .join(' ');
}
