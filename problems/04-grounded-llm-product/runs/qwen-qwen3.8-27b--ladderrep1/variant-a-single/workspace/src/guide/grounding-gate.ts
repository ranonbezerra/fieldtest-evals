// Sentence-level grounding gate for the guide answer path.
//
// A sentence survives only if every claim it makes is present in the source
// texts:
//   1. Quantities. A number — digit or word form ("5", "five") — must appear
//      in the sources with exactly the same value, and the adjacent unit word
//      must appear too. "5 shards" against a page that says 4 fails.
//   2. Names and content words. Every non-generic token (boss names, item
//      names, locations, invented nouns) must appear in the source texts.
//      Generic connective tissue (stopwords) is not a claim and is skipped.
//
// The check is deliberately deterministic — no LLM in the gate — so its
// behaviour is fully testable and reproducible.

const WORD_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const STOPWORD_LIST: string[] = [
  // pronouns, determiners & function words
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their', 'mine', 'yours',
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'some', 'any', 'all',
  'each', 'every', 'no', 'not', 'nor', 'only', 'just', 'such', 'as', 'than',
  'there', 'here', 'away', 'back',
  // adverbs & intensifiers
  'very', 'quite', 'rather', 'also', 'too', 'often', 'always', 'never',
  'usually', 'sometimes', 'rarely', 'hardly', 'barely', 'still', 'yet',
  'again', 'once', 'then', 'else', 'so', 'perhaps', 'maybe', 'indeed',
  'actually', 'really', 'truly', 'simply', 'directly', 'exactly', 'precisely',
  'fully', 'completely', 'properly', 'correctly', 'basically', 'generally',
  'typically', 'clearly', 'easily', 'quickly', 'slowly', 'well', 'far',
  // interrogatives, relatives & conjunctions
  'when', 'where', 'what', 'which', 'who', 'whom', 'whose', 'how', 'why',
  'if', 'because', 'although', 'though', 'whereas', 'and', 'or', 'but',
  'while', 'until', 'unless', 'since', 'after', 'before', 'during', 'through',
  // auxiliaries & modals
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'having', 'do', 'does', 'did', 'done', 'will', 'would', 'shall',
  'should', 'can', 'could', 'may', 'might', 'must', 'ought',
  // prepositions
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'without', 'by', 'from', 'up',
  'down', 'out', 'off', 'over', 'under', 'upon', 'onto', 'into', 'about',
  'around', 'along', 'across', 'against', 'among', 'between', 'behind',
  'beyond', 'near', 'toward', 'towards', 'within', 'outside', 'inside', 'per', 'vs',
  // generic verbs
  'need', 'needs', 'needed', 'needing', 'get', 'gets', 'got', 'getting',
  'use', 'uses', 'used', 'using', 'take', 'takes', 'took', 'taken', 'taking',
  'bring', 'brings', 'brought', 'bringing', 'go', 'goes', 'went', 'gone',
  'going', 'come', 'comes', 'came', 'coming', 'make', 'makes', 'made',
  'making', 'say', 'says', 'said', 'saying', 'tell', 'tells', 'told',
  'telling', 'ask', 'asks', 'asked', 'asking', 'know', 'knows', 'knew',
  'known', 'fight', 'fights', 'fought', 'fighting', 'defeat', 'defeats',
  'defeated', 'defeating', 'kill', 'kills', 'killed', 'killing', 'slay',
  'slays', 'slain', 'farm', 'farms', 'farmed', 'collect', 'collects',
  'collected', 'gather', 'gathers', 'gathered', 'obtain', 'obtains',
  'obtained', 'drop', 'drops', 'dropped', 'unlock', 'unlocks', 'unlocked',
  'open', 'opens', 'opened', 'opening', 'close', 'closes', 'closed', 'start',
  'starts', 'started', 'begin', 'begins', 'began', 'end', 'ends', 'ended',
  'finish', 'finishes', 'finished', 'complete', 'completes', 'completed',
  'require', 'requires', 'required', 'requiring', 'accept', 'accepts',
  'accepted', 'accepting', 'allow', 'allows', 'allowed', 'give', 'gives',
  'gave', 'given', 'feed', 'feeds', 'fed', 'place', 'places', 'placed',
  'set', 'sets', 'hold', 'holds', 'held', 'keep', 'keeps', 'kept', 'wait',
  'waits', 'waited', 'enter', 'enters', 'entered', 'leave', 'leaves', 'left',
  'reach', 'reaches', 'reached', 'earn', 'earns', 'earned', 'gain', 'gains',
  'gained', 'lose', 'loses', 'lost', 'win', 'wins', 'won', 'beat', 'beats',
  'beaten', 'seem', 'seems', 'seemed', 'look', 'looks', 'looked', 'feel',
  'feels', 'felt',
  // generic nouns
  'game', 'games', 'player', 'players', 'boss', 'bosses', 'quest', 'quests',
  'item', 'items', 'character', 'characters', 'level', 'levels', 'stage',
  'stages', 'area', 'areas', 'zone', 'zones', 'map', 'maps', 'world',
  'worlds', 'gate', 'gates', 'room', 'rooms', 'door', 'doors', 'act', 'acts',
  'chapter', 'chapters', 'enemy', 'enemies', 'monster', 'monsters', 'loot',
  'looting', 'skill', 'skills', 'ability', 'abilities', 'power', 'powers',
  'key', 'keys', 'note', 'notes', 'tip', 'tips', 'info', 'information',
  'detail', 'details', 'page', 'pages', 'wiki', 'answer', 'answers',
  'question', 'questions', 'hint', 'hints', 'method', 'methods', 'way',
  'ways', 'thing', 'things', 'part', 'parts', 'piece', 'pieces', 'number',
  'numbers', 'time', 'times',
  // generic adjectives
  'main', 'final', 'first', 'second', 'third', 'last', 'next', 'previous',
  'new', 'old', 'big', 'small', 'large', 'little', 'difficult', 'easy',
  'hard', 'tough', 'good', 'best', 'better', 'worst', 'important', 'possible',
];

export const STOPWORDS: ReadonlySet<string> = new Set(STOPWORD_LIST);

/** Split text into tokens on anything that is not a letter, digit or apostrophe. */
export function tokenize(text: string): string[] {
  return text.split(/[^\p{L}\p{N}']+/u).filter((token) => token.length > 0);
}

/** Lowercase and strip punctuation: "Shards'" -> "shards", "4" -> "4". */
export function normalize(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** "4" -> 4, "five" -> 5, anything else -> null. */
export function toDigit(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  return Object.hasOwn(WORD_NUMBERS, token) ? WORD_NUMBERS[token] : null;
}

/** Split an answer into sentences on terminal punctuation followed by whitespace. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

export interface QuantityClaim {
  digit: number;
  /** Normalized unit word immediately after the number, if any. */
  unit: string | null;
}

/** Every number (digit or word form) in the sentence, with its adjacent unit. */
export function extractQuantities(sentence: string): QuantityClaim[] {
  const tokens = tokenize(sentence);
  const claims: QuantityClaim[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const digit = toDigit(normalize(tokens[i]));
    if (digit === null) continue;
    let unit: string | null = null;
    if (i + 1 < tokens.length) {
      const next = normalize(tokens[i + 1]);
      if (/^[a-z]+$/.test(next) && !STOPWORDS.has(next)) unit = next;
    }
    claims.push({ digit, unit });
  }
  return claims;
}

/** All normalized words the sources contain. */
export function sourceVocabulary(sources: string[]): Set<string> {
  const vocab = new Set<string>();
  for (const source of sources) {
    for (const token of tokenize(source)) {
      const normalized = normalize(token);
      if (normalized.length > 0) vocab.add(normalized);
    }
  }
  return vocab;
}

/** All exact number values the sources contain, digits and word forms. */
export function sourceDigits(sources: string[]): Set<number> {
  const digits = new Set<number>();
  for (const source of sources) {
    for (const token of tokenize(source)) {
      const digit = toDigit(normalize(token));
      if (digit !== null) digits.add(digit);
    }
  }
  return digits;
}

/** Membership with simple plural tolerance: "shard" matches "shards" and back. */
function vocabHas(vocab: Set<string>, word: string): boolean {
  const normalized = normalize(word);
  if (normalized.length === 0) return false;
  if (vocab.has(normalized)) return true;
  if (normalized.endsWith('s') && vocab.has(normalized.slice(0, -1))) return true;
  return vocab.has(normalized + 's');
}

export interface SentenceVerdict {
  grounded: boolean;
  /** Claims the sources do not support (digits as strings, words as written). */
  missing: string[];
}

/**
 * Check one sentence against the source texts. Grounded only if every
 * quantity matches exactly and every name/content word appears in the sources.
 */
export function checkSentence(sentence: string, sources: string[]): SentenceVerdict {
  const vocab = sourceVocabulary(sources);
  const digits = sourceDigits(sources);
  const missing: string[] = [];
  const report = (word: string): void => {
    if (!missing.includes(word)) missing.push(word);
  };

  for (const claim of extractQuantities(sentence)) {
    if (!digits.has(claim.digit)) {
      report(String(claim.digit));
    } else if (claim.unit !== null && !vocabHas(vocab, claim.unit)) {
      report(claim.unit);
    }
  }

  for (const raw of tokenize(sentence)) {
    const token = normalize(raw);
    if (token.length === 0) continue;
    if (toDigit(token) !== null) continue; // quantities handled above
    if (STOPWORDS.has(token)) continue;
    if (!vocabHas(vocab, token)) report(raw);
  }

  return { grounded: missing.length === 0, missing };
}

export interface GateResult {
  kept: string[];
  dropped: string[];
}

/** Drop every sentence whose claims the sources do not support. */
export function filterGroundedSentences(answer: string, sources: string[]): GateResult {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const sentence of splitSentences(answer)) {
    const verdict = checkSentence(sentence, sources);
    (verdict.grounded ? kept : dropped).push(sentence);
  }
  return { kept, dropped };
}
