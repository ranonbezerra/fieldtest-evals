import { WORD_NUMBERS } from './assistant.grounding';

/**
 * The spoiler surface for hint mode.
 *
 * // ASSUMPTION: boss names and item locations come from an injected lexicon.
 * The task does not provide a way to derive them from the wiki pages, so the
 * redactor is configured with the names to protect.
 */
export interface SpoilerLexicon {
  bossNames: string[];
  locations: string[];
}

export const EMPTY_SPOILER_LEXICON: SpoilerLexicon = { bossNames: [], locations: [] };

/**
 * // ASSUMPTION: the task specifies what hint mode must hide, not the
 * replacement text, so hints use [boss], [location] and [N].
 */
export const BOSS_PLACEHOLDER = '[boss]';
export const LOCATION_PLACEHOLDER = '[location]';
export const QUANTITY_PLACEHOLDER = '[N]';

const WORD_NUMBER_PATTERN = 'one|two|three|four|five|six|seven|eight|nine|ten';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Numbers the question already mentions (digits and spelled one..ten). */
function knownNumbersIn(question: string): Set<number> {
  const known = new Set<number>();
  const text = question.toLowerCase();
  for (const match of text.matchAll(/\b\d+\b/g)) known.add(Number(match[0]));
  for (const match of text.matchAll(new RegExp(`\\b(?:${WORD_NUMBER_PATTERN})\\b`, 'g'))) {
    const value = WORD_NUMBERS[match[0]];
    if (value !== undefined) known.add(value);
  }
  return known;
}

/**
 * Derives the hint by redacting the full grounded answer (never by
 * re-prompting the model). Nothing is revealed that the player's question
 * does not already mention:
 *  - boss names / locations from the lexicon, unless the question says them;
 *  - every quantity, unless the question already states that exact number.
 */
export function redactForHint(text: string, question: string, lexicon: SpoilerLexicon): string {
  let out = text;
  const questionLower = question.toLowerCase();

  const names = [
    ...lexicon.bossNames.map((name) => ({ name, placeholder: BOSS_PLACEHOLDER })),
    ...lexicon.locations.map((name) => ({ name, placeholder: LOCATION_PLACEHOLDER })),
  ]
    .filter(({ name }) => !questionLower.includes(name.toLowerCase()))
    // Longest first, so "Ashen Warden" is not broken by a shorter "Ashen".
    .sort((a, b) => b.name.length - a.name.length);

  for (const { name, placeholder } of names) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(name)}\\b`, 'gi'), placeholder);
  }

  const known = knownNumbersIn(question);
  out = out.replace(/\b(\d+)\b/g, (number) => (known.has(Number(number)) ? number : QUANTITY_PLACEHOLDER));
  out = out.replace(new RegExp(`\\b(?:${WORD_NUMBER_PATTERN})\\b`, 'gi'), (word) => {
    const value = WORD_NUMBERS[word.toLowerCase()];
    return value !== undefined && known.has(value) ? word : QUANTITY_PLACEHOLDER;
  });

  return out;
}
