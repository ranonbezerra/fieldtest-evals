import { REFUSAL_TEXT } from './answer.types';
import {
  claimTokens,
  extractProperNouns,
  normalizeText,
  quantityKey,
  quantityMatches,
  splitSentences,
  tokenize,
} from './text-utils';

export interface GateResult {
  /** Kept sentences joined, or REFUSAL_TEXT when nothing survived. */
  text: string;
  kept: string[];
  dropped: string[];
  refused: boolean;
}

interface SourceIndex {
  normalized: string;
  tokens: ReadonlySet<string>;
  quantityKeys: ReadonlySet<string>;
}

function indexSources(sources: string[]): SourceIndex {
  const text = sources.join('\n');
  return {
    normalized: normalizeText(text),
    tokens: new Set(tokenize(text)),
    quantityKeys: new Set(quantityMatches(text).map(quantityKey)),
  };
}

// ASSUMPTION: "the sources support the sentence" is approximated lexically —
// every proper noun, (quantity, unit) pair and content token of the sentence
// must occur in the sources, with quantities compared exactly ("5 shards"
// against a source that says 4 fails; "four" and "4" agree). It is strict on
// purpose: dropping a true sentence is recoverable, shipping an invented one
// is the incident this gate exists to stop. A semantic entailment judge is
// the natural upgrade behind this same interface.
export function gateAnswer(rawAnswer: string, sources: string[]): GateResult {
  const index = indexSources(sources);
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const sentence of splitSentences(rawAnswer)) {
    if (isSentenceGrounded(sentence, index)) kept.push(sentence);
    else dropped.push(sentence);
  }
  if (kept.length === 0) {
    return { text: REFUSAL_TEXT, kept, dropped, refused: true };
  }
  return { text: kept.join(' '), kept, dropped, refused: false };
}

function isSentenceGrounded(sentence: string, source: SourceIndex): boolean {
  for (const name of extractProperNouns(sentence)) {
    if (!source.normalized.includes(normalizeText(name))) return false;
  }
  for (const quantity of quantityMatches(sentence)) {
    if (!source.quantityKeys.has(quantityKey(quantity))) return false;
  }
  for (const token of claimTokens(sentence)) {
    if (!source.tokens.has(token)) return false;
  }
  return true;
}
