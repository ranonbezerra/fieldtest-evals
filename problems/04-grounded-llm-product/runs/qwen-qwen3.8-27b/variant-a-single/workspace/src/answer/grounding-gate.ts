/**
 * Sentence-level grounding gate.
 *
 * A sentence is grounded when every factual atom it carries is supported by
 * the source pages. Factual atoms are the checkable claims in a sentence:
 *
 *   - entity:   proper-noun phrases ("Gravel Wretch", "Moonlight Shard")
 *   - quantity: number + unit pairs ("four shards", "5 keys")
 *
 * // ASSUMPTION: the gate is deliberately lexical and deterministic (no second
 * // LLM call). It verifies the two failure classes the product cares about —
 * // invented names and wrong counts — but cannot semantically verify freely
 * // paraphrased plain prose. A sentence with no verifiable atoms is kept only
 * // if the rest of the answer contains grounded claims; an answer with zero
 * // verifiable atoms is treated as "not covered" and triggers a refusal.
 */

export type FactualAtom =
  | { kind: 'entity'; value: string }
  | { kind: 'quantity'; number: number; unit: string };

export interface SentenceVerdict {
  sentence: string;
  atoms: FactualAtom[];
  grounded: boolean;
}

export interface GroundingGate {
  assess(sentence: string, sources: string[]): SentenceVerdict;
  isAtomSupported(atom: FactualAtom, sources: string[]): boolean;
  /** Splits a raw LLM answer into grounded (kept) and ungrounded (dropped) sentences. */
  filter(rawAnswer: string, sources: string[]): { kept: string[]; dropped: string[] };
}

export const STOPWORDS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those',
  'you', 'your', 'i', 'we', 'it', 'he', 'she', 'they',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'and', 'or', 'to', 'of', 'in', 'on', 'at', 'with', 'by', 'for', 'from', 'as',
  'not', 'no', 'nor',
  'do', 'does', 'did', 'can', 'could', 'cannot',
  'will', 'would', 'should', 'shall', 'may', 'might', 'must',
  'if', 'when', 'then', 'so', 'but', 'than', 'too',
  'very', 'just', 'only', 'about',
  'into', 'over', 'under', 'behind', 'before', 'after', 'against', 'between',
  'out', 'up', 'down', 'off', 'once',
  'here', 'there', 'where', 'what', 'which', 'who', 'whom', 'whose', 'how',
  'all', 'any', 'some', 'each', 'few', 'more', 'most', 'other', 'such', 'own', 'same', 'now',
]);

/** Words that follow number words idiomatically ("one way", "a kind of") and are not items. */
export const IDIOMATIC_UNITS = new Set([
  'way', 'kind', 'sort', 'hand', 'eye', 'heart', 'mind',
  'place', 'position', 'side', 'front',
]);

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

export function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

export function singularize(word: string): string {
  return word.endsWith('s') ? word.slice(0, -1) : word;
}

export function toNumber(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  return WORD_NUMBERS[token.toLowerCase()] ?? null;
}

const ENTITY_RE = /\b[A-Z][a-z]*(?:\s+[A-Z][a-z]*)*/g;

const QUANTITY_RE =
  /(\b\d{1,3}\b|\bone\b|\btwo\b|\bthree\b|\bfour\b|\bfive\b|\bsix\b|\bseven\b|\beight\b|\bnine\b|\bten\b)(?:\s+([a-z][a-z-]*))?/gi;

export interface EntityMatch {
  raw: string;
  value: string;
  index: number;
}

export function findEntities(sentence: string): EntityMatch[] {
  const matches: EntityMatch[] = [];
  for (const match of sentence.matchAll(ENTITY_RE)) {
    const words = match[0].split(' ').filter((word) => !STOPWORDS.has(word.toLowerCase()));
    if (words.length === 0) continue;
    // ASSUMPTION: a single capitalized word in first position is treated as a
    // sentence-start artifact ("The door..."), not as a name; multi-word
    // capitalized phrases at the start ("Moonlight Shard ...") are still names.
    if (words.length === 1 && match.index === 0) continue;
    matches.push({
      raw: match[0],
      value: normalize(words.join(' ')),
      index: match.index ?? 0,
    });
  }
  return matches;
}

export function extractQuantities(sentence: string): { number: number; unit: string }[] {
  const quantities: { number: number; unit: string }[] = [];
  for (const match of sentence.matchAll(QUANTITY_RE)) {
    const number = toNumber(match[1]);
    if (number === null) continue;
    const unit = match[2] ? match[2].toLowerCase() : null;
    // A "unit" that is a stopword or idiom ("five of them", "one way") does
    // not name a countable item; bare numbers carry no checkable unit.
    if (unit === null || STOPWORDS.has(unit) || IDIOMATIC_UNITS.has(unit)) continue;
    quantities.push({ number, unit: singularize(unit) });
  }
  return quantities;
}

function atomKey(atom: FactualAtom): string {
  return atom.kind === 'entity' ? `entity:${atom.value}` : `quantity:${atom.number}:${atom.unit}`;
}

export function extractSentenceAtoms(sentence: string): FactualAtom[] {
  const atoms: FactualAtom[] = [];
  for (const entity of findEntities(sentence)) {
    atoms.push({ kind: 'entity', value: entity.value });
  }
  for (const quantity of extractQuantities(sentence)) {
    atoms.push({ kind: 'quantity', number: quantity.number, unit: quantity.unit });
  }
  const seen = new Set<string>();
  return atoms.filter((atom) => {
    const key = atomKey(atom);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractAtoms(text: string): FactualAtom[] {
  const atoms: FactualAtom[] = [];
  const seen = new Set<string>();
  for (const sentence of splitSentences(text)) {
    for (const atom of extractSentenceAtoms(sentence)) {
      const key = atomKey(atom);
      if (seen.has(key)) continue;
      seen.add(key);
      atoms.push(atom);
    }
  }
  return atoms;
}

/** All (unit -> set of numbers) pairs the sources assert, e.g. shard -> {4}. */
export function sourceQuantities(sources: string[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const sentence of splitSentences(sources.join('\n'))) {
    for (const atom of extractSentenceAtoms(sentence)) {
      if (atom.kind !== 'quantity') continue;
      const set = map.get(atom.unit) ?? new Set<number>();
      set.add(atom.number);
      map.set(atom.unit, set);
    }
  }
  return map;
}

export function entitySupported(value: string, normalizedSourceBlob: string): boolean {
  return (
    normalizedSourceBlob.includes(value) ||
    normalizedSourceBlob.includes(`${value}s`) ||
    (value.endsWith('s') && normalizedSourceBlob.includes(value.slice(0, -1)))
  );
}

export class LexicalGroundingGate implements GroundingGate {
  assess(sentence: string, sources: string[]): SentenceVerdict {
    const atoms = extractSentenceAtoms(sentence);
    return {
      sentence,
      atoms,
      grounded: atoms.every((atom) => this.isAtomSupported(atom, sources)),
    };
  }

  isAtomSupported(atom: FactualAtom, sources: string[]): boolean {
    if (atom.kind === 'entity') {
      return entitySupported(atom.value, normalize(sources.join(' ')));
    }
    // Quantity checks are exact: "5 shards" fails when the sources say 4.
    return (sourceQuantities(sources).get(atom.unit) ?? new Set<number>()).has(atom.number);
  }

  filter(rawAnswer: string, sources: string[]): { kept: string[]; dropped: string[] } {
    const kept: string[] = [];
    const dropped: string[] = [];
    let supportedAtomCount = 0;
    for (const sentence of splitSentences(rawAnswer)) {
      const verdict = this.assess(sentence, sources);
      if (verdict.grounded) {
        kept.push(sentence);
        supportedAtomCount += verdict.atoms.length;
      } else {
        dropped.push(sentence);
      }
    }
    // Nothing verifiable was supported: the answer is not covered by the sources.
    if (supportedAtomCount === 0) {
      return { kept: [], dropped: [...kept, ...dropped] };
    }
    return { kept, dropped };
  }
}
