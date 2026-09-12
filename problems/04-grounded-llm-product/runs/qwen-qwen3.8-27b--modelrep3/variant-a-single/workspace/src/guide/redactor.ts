import {
  cleanToken,
  escapeRegExp,
  extractProperNounClaims,
  extractQuantityClaims,
  splitSentences,
  tokenize,
} from './grounder.js';
import type { ProperNounClaim } from './grounder.js';

/**
 * Hint-mode redaction, applied to the full grounded answer (never a re-prompt).
 *
 * The spoiler contract hides:
 *   - boss names   -> "a hidden boss"
 *   - place names  -> "a secret place"
 *   - quantities the player has not already mentioned -> "several"
 *
 * // ASSUMPTION: the spoiler contract forbids boss names, item locations and
 * // quantities, not item names, so item names stay visible in hints.
 * // ASSUMPTION: a quantity N may be revealed only when the player already
 * // mentioned at least N of the same resource in the question.
 *
 * Names are classified by their own tokens first, then by nearby context
 * words; a name with no recognizable context is left as-is. Generic spatial
 * language ("eastern bank") is out of scope: the redactor targets the named
 * entities and quantities the contract enumerates.
 */

type NameKind = 'boss' | 'place';

const BOSS_WORDS = new Set([
  'boss', 'guardian', 'warden', 'foe', 'enemy', 'champion', 'sentinel', 'fight',
  'fighting', 'defeat', 'defeated', 'slay', 'slain', 'kill', 'killed', 'battle',
  'duel', 'encounter', 'guard', 'guards', 'guarded', 'patrol', 'patrols',
  'patrolled', 'hound', 'beast', 'brute', 'specter', 'lich', 'golem',
]);

const PLACE_WORDS = new Set([
  'place', 'location', 'region', 'area', 'zone', 'cave', 'temple', 'swamp',
  'forest', 'mountain', 'dungeon', 'keep', 'tower', 'fen', 'marsh', 'valley',
  'ruin', 'ruins', 'altar', 'shrine', 'gate', 'path', 'door', 'room', 'bank',
  'shore', 'cliff', 'hill', 'north', 'south', 'east', 'west', 'eastern',
  'western', 'southern', 'northern', 'beyond', 'near', 'behind', 'inside',
  'under', 'above', 'across', 'through',
]);

interface KnownQuantity {
  value: number;
  unit: string[];
}

function knownQuantities(question: string): KnownQuantity[] {
  return extractQuantityClaims(question).map((c) => ({ value: Number(c.number), unit: c.unit }));
}

function sameUnit(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((w, i) => w === (b[i] ?? ''));
}

function redactQuantities(sentence: string, known: KnownQuantity[]): string {
  let out = sentence;
  for (const claim of extractQuantityClaims(sentence)) {
    const value = Number(claim.number);
    const alreadyKnown = claim.unit.length === 0
      ? known.some((k) => k.unit.length === 0 && k.value === value)
      : known.some((k) => sameUnit(k.unit, claim.unit) && k.value >= value);
    if (alreadyKnown) continue;
    const re = new RegExp(`\\b${escapeRegExp(claim.raw)}\\b`);
    out = out.replace(re, `several ${claim.unitRaw.join(' ')}`.trim());
  }
  return out;
}

function classifyName(claim: ProperNounClaim, cleanTokens: string[]): NameKind | null {
  for (const w of claim.words) {
    if (BOSS_WORDS.has(w)) return 'boss';
    if (PLACE_WORDS.has(w)) return 'place';
  }
  const from = Math.max(0, claim.start - 5);
  const to = Math.min(cleanTokens.length, claim.end + 5);
  for (let i = from; i < to; i++) {
    if (i >= claim.start && i < claim.end) continue;
    const w = cleanTokens[i] ?? '';
    if (BOSS_WORDS.has(w)) return 'boss';
    if (PLACE_WORDS.has(w)) return 'place';
  }
  return null;
}

function redactNames(sentence: string): string {
  const claims = extractProperNounClaims(sentence);
  if (claims.length === 0) return sentence;
  const rawTokens = tokenize(sentence);
  const cleanTokens = rawTokens.map(cleanToken);
  let out = sentence;
  for (const claim of claims) {
    const kind = classifyName(claim, cleanTokens);
    if (kind === null) continue;
    const withArticle = kind === 'boss' ? 'a hidden boss' : 'a secret place';
    const bare = kind === 'boss' ? 'hidden boss' : 'secret place';
    let base = claim.phrase;
    let suffix = '';
    if (base.endsWith("'s")) {
      suffix = "'s";
      base = base.slice(0, -2);
    } else if (base.endsWith('\u2019s')) {
      suffix = '\u2019s';
      base = base.slice(0, -2);
    }
    const prev = (rawTokens[claim.start - 1] ?? '').toLowerCase();
    let search: string;
    let replacement: string;
    if (prev === 'a' || prev === 'an') {
      // "a Duskfang Warden" -> "a hidden boss" (the article is consumed).
      search = `${prev} ${base}`;
      replacement = withArticle + suffix;
    } else if (prev === 'the') {
      // "the Duskfang Warden" -> "the hidden boss" (keep the existing article).
      search = base;
      replacement = bare + suffix;
    } else {
      search = base;
      replacement = withArticle + suffix;
    }
    out = out.replace(new RegExp(`\\b${escapeRegExp(search)}\\b`), replacement);
  }
  return out;
}

/** Redacts a full grounded answer into its spoiler-free hint form. */
export function redactToHint(groundedFullText: string, question: string): string {
  const known = knownQuantities(question);
  return splitSentences(groundedFullText)
    .map((s) => redactNames(redactQuantities(s, known)))
    .join(' ');
}
