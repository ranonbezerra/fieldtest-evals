import { escapeRegExp } from './grounding.js';
import type { WikiSource } from './types.js';

/** Placeholder used for every redacted spoiler. */
const HIDDEN = '[hidden]';

const NAME_WORD = String.raw`[A-Z][A-Za-z0-9'-]*`;
/** A run of capitalised words, e.g. "Warden Kael" or "Ashen Hollow". */
const NAME = String.raw`${NAME_WORD}(?:\s+${NAME_WORD})*`;

/** Keyword-anchored ways wiki pages introduce a boss name. */
const BOSS_PATTERNS: RegExp[] = [
  new RegExp(String.raw`\b(?:final\s+|main\s+)?boss(?:\s+(?:named|called|known\s+as))?[:\s]+(${NAME})`, 'gi'),
  new RegExp(String.raw`\b(?:defeat|fight|face|confront|kill|take\s+down)\s+(?:the\s+)?(${NAME})`, 'gi'),
  new RegExp(String.raw`\b(${NAME})\s+(?:is|was|remains)\s+(?:the\s+)?(?:final\s+)?boss\b`, 'gi'),
  new RegExp(String.raw`\b(${NAME})\s+guards?\b`, 'gi'),
  new RegExp(String.raw`\bguarded\s+by\s+(?:the\s+)?(${NAME})`, 'gi'),
];

/** Location prepositions followed by a named place. */
const LOCATION_PATTERN = new RegExp(
  String.raw`\b(?:inside|within|located\s+in|found\s+in|kept\s+in|hidden\s+in|dropped\s+in|beyond|behind|under|next\s+to|near|past|in)\s+(?:the|a|an)\s+(${NAME})`,
  'gi',
);

const NUMBER_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const DIGIT_RE = /\d+/g;
const NUMBER_WORD_RE = new RegExp(`\\b(?:${NUMBER_WORDS.join('|')})\\b`, 'gi');
const ANSWER_DIGIT_RE = /\b\d+\b/g;

function collectMatches(text: string, pattern: RegExp): string[] {
  pattern.lastIndex = 0;
  const matches: string[] = [];
  for (const match of text.matchAll(pattern)) {
    matches.push(match[0]);
  }
  return matches;
}

/** Names of bosses mentioned in the wiki pages (keyword-anchored). */
export function extractBossNames(sources: WikiSource[]): Set<string> {
  const names = new Set<string>();
  for (const source of sources) {
    for (const pattern of BOSS_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of source.text.matchAll(pattern)) {
        const name = match[1].trim();
        if (name.length >= 2) {
          names.add(name);
        }
      }
    }
  }
  return names;
}

/** Place names mentioned as item/boss locations in the wiki pages. */
export function extractLocations(sources: WikiSource[]): Set<string> {
  const names = new Set<string>();
  for (const source of sources) {
    LOCATION_PATTERN.lastIndex = 0;
    for (const match of source.text.matchAll(LOCATION_PATTERN)) {
      const name = match[1].trim();
      if (name.length >= 2) {
        names.add(name);
      }
    }
  }
  return names;
}

export interface RedactionContext {
  question: string;
  sources: WikiSource[];
}

/**
 * Derives the spoiler-free hint from a grounded full answer:
 * - boss names and item locations (taken from the sources) are always hidden,
 *   including the individual words of each name so partial mentions cannot leak;
 * - every quantity (digit or number word) is hidden unless the player already
 *   mentioned it in the question.
 */
export function redactSpoilers(answer: string, context: RedactionContext): string {
  let redacted = answer;

  const names = [...extractBossNames(context.sources), ...extractLocations(context.sources)].sort(
    (a, b) => b.length - a.length,
  );
  for (const name of names) {
    redacted = redacted.replace(new RegExp(`\\b${escapeRegExp(name)}\\b`, 'gi'), HIDDEN);
    for (const word of name.split(/\s+/)) {
      if (word.length < 4) {
        continue;
      }
      redacted = redacted.replace(new RegExp(`\\b${escapeRegExp(word)}\\b`, 'gi'), HIDDEN);
    }
  }

  const questionDigits = new Set(collectMatches(context.question, DIGIT_RE));
  const questionNumberWords = new Set(
    collectMatches(context.question, NUMBER_WORD_RE).map((word) => word.toLowerCase()),
  );

  redacted = redacted.replace(ANSWER_DIGIT_RE, (digit) => (questionDigits.has(digit) ? digit : HIDDEN));
  redacted = redacted.replace(NUMBER_WORD_RE, (word) =>
    questionNumberWords.has(word.toLowerCase()) ? word : HIDDEN,
  );

  return redacted;
}
