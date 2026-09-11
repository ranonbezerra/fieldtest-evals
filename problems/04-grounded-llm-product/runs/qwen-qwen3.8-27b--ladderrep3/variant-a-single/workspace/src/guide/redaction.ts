/**
 * Hint mode is a redaction of the answer that already passed the grounding
 * gate. It never re-prompts the model: a second generation can invent; a
 * redaction cannot.
 *
 * Rules (all fail-closed, i.e. over-redact rather than leak):
 *  1. Proper-noun runs (boss names, entity names)                     -> [name]
 *  2. Location nouns with up to two preceding modifiers               -> [location]
 *  3. Quantities the player did not already mention (digits, spoken
 *     numbers 1-20)                                                   -> [quantity]
 */

import { isStopword, numberValues, spokenNumberValue, STOPWORDS_SET } from './grounding';

/** Lowercase function words allowed inside a proper-noun run: "Pyreth the Ashen". */
const EMBEDDED_RUN_WORDS = new Set(['the', 'of', 'de', 'la', 'le', 'du', 'van', 'von']);

/** Capitalized stop words that never start an entity run: "The forge ...". */
const STOPPER_CAPS = new Set<string>(
  [...STOPWORDS_SET].map(word => word.charAt(0).toUpperCase() + word.slice(1)),
);

/** Entity-class nouns for game locations. If one appears, the spot is redacted. */
const LOCATION_NOUNS = new Set([
  'keep', 'vault', 'cavern', 'cathedral', 'dungeon', 'ruins', 'tower',
  'sanctum', 'forge', 'chasm', 'grotto', 'hollow', 'chapel', 'crypt',
  'labyrinth', 'temple', 'shrine', 'altar', 'citadel', 'bunker', 'cellar',
  'attic', 'courtyard', 'passage',
]);

interface Span {
  start: number;
  end: number;
}

function tokens(text: string): Array<{ index: number; text: string }> {
  return [...text.matchAll(/\S+/g)].map(match => ({ index: match.index ?? 0, text: match[0] }));
}

function coreOf(token: string): string {
  return token.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z]+$/, '');
}

function punctOf(token: string): string {
  const match = token.match(/([,.!?;:]+)$/);
  return match ? match[1] : '';
}

function isTitleToken(token: string): boolean {
  return /^[A-Z][a-z'’-]*$/.test(coreOf(token));
}

function isSentenceStart(text: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const char = text[i];
    if (char === ' ' || char === '\t' || char === '\n') continue;
    return char === '.' || char === '!' || char === '?' || char === '“';
  }
  return true;
}

function redactEntityRuns(text: string): string {
  const tokens_ = tokens(text);
  let out = '';
  let cursor = 0;
  for (let i = 0; i < tokens_.length; i++) {
    const token = tokens_[i];
    if (!isTitleToken(token.text)) continue;
    if (isSentenceStart(text, token.index) && STOPPER_CAPS.has(coreOf(token.text))) continue;
    let j = i;
    while (j + 1 < tokens_.length) {
      const next = tokens_[j + 1].text;
      if (isTitleToken(next)) {
        j++;
        continue;
      }
      if (EMBEDDED_RUN_WORDS.has(coreOf(next).toLowerCase())) {
        j++;
        continue;
      }
      break;
    }
    const last = tokens_[j];
    out += text.slice(cursor, token.index) + '[name]' + punctOf(last.text);
    cursor = last.index + last.text.length;
    i = j;
  }
  return out + text.slice(cursor);
}

function redactLocations(text: string): string {
  const tokens_ = tokens(text);
  const spans: Span[] = [];
  for (let i = 0; i < tokens_.length; i++) {
    const core = coreOf(tokens_[i].text).toLowerCase();
    if (!LOCATION_NOUNS.has(core)) continue;
    let left = i;
    let taken = 0;
    for (let k = i - 1; k >= 0 && taken < 2; k--) {
      const prevCore = coreOf(tokens_[k].text);
      if (isStopword(prevCore.toLowerCase()) || isTitleToken(tokens_[k].text)) break;
      left = k;
      taken++;
    }
    spans.push({ start: tokens_[left].index, end: tokens_[i].index + tokens_[i].text.length });
  }
  spans.sort((a, b) => b.start - a.start);
  let out = '';
  let cursor = 0;
  let nextMin = Infinity;
  for (const span of spans) {
    if (span.end > nextMin) continue; // overlaps a span already kept
    nextMin = span.start;
    out += text.slice(cursor, span.start) + '[location]' + punctOf(text.slice(span.start, span.end));
    cursor = span.end;
  }
  return out + text.slice(cursor);
}

function redactQuantities(text: string, allowed: ReadonlySet<number>): string {
  const withDigits = text.replace(/\d+/g, match => (allowed.has(Number(match)) ? match : '[quantity]'));
  const tokens_ = tokens(withDigits);
  let out = '';
  let cursor = 0;
  for (const token of tokens_) {
    const value = spokenNumberValue(coreOf(token.text).toLowerCase());
    if (value !== null && !allowed.has(value)) {
      out += withDigits.slice(cursor, token.index) + '[quantity]' + punctOf(token.text);
      cursor = token.index + token.text.length;
    }
  }
  return out + withDigits.slice(cursor);
}

export function redactForHint(answer: string, question: string): string {
  const allowed = new Set<number>(numberValues(question));
  let out = redactEntityRuns(answer);
  out = redactLocations(out);
  out = redactQuantities(out, allowed);
  return out.replace(/ {2,}/g, ' ').trim();
}
