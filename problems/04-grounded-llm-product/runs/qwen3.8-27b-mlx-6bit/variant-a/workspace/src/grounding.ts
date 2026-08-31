// ASSUMPTION: The plan lists GroundingError under answer.ts, but groundAnswer must raise it; defining it here avoids a circular import.
const STOPWORDS = new Set<string>([
  "the",
  "a",
  "an",
  "is",
  "are",
  "to",
  "of",
  "in",
  "on",
  "you",
  "your",
  "it",
  "that",
  "this",
  "and",
  "or",
  "for",
  "with",
  "be",
  "can",
  "will",
  "has",
  "have",
]);

const SENTENCE_PATTERN = /[^.!?]*[.!?]+(?:\s*)|[^.!?]+$/g;
const TOKEN_PATTERN = /[a-z0-9]+/g;

export interface GroundedAnswer {
  text: string;
  sentences: string[];
  refused: boolean;
}

export class GroundingError extends Error {
  code: "empty_sources";

  constructor() {
    super("sources must not be empty");
    this.name = "GroundingError";
    this.code = "empty_sources";
  }
}

export function splitSentences(text: string): string[] {
  const matches = text.match(SENTENCE_PATTERN);
  if (!matches) {
    return [];
  }

  return matches
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

export function tokenSet(text: string): Set<string> {
  const tokens = text.toLowerCase().match(TOKEN_PATTERN);
  const set = new Set<string>();

  if (!tokens) {
    return set;
  }

  for (const token of tokens) {
    if (!STOPWORDS.has(token)) {
      set.add(token);
    }
  }

  return set;
}

export function isGrounded(sentence: string, sourceTokens: Set<string>): boolean {
  for (const token of tokenSet(sentence)) {
    if (!sourceTokens.has(token)) {
      return false;
    }
  }

  return true;
}

export function groundAnswer(rawAnswer: string, sources: string[]): GroundedAnswer {
  if (sources.length === 0) {
    throw new GroundingError();
  }

  const sourceTokens = new Set<string>();
  for (const source of sources) {
    for (const token of tokenSet(source)) {
      sourceTokens.add(token);
    }
  }

  const sentences = splitSentences(rawAnswer);
  const groundedSentences = sentences.filter((sentence) => isGrounded(sentence, sourceTokens));

  if (groundedSentences.length === 0) {
    return {
      text: "not covered by my sources",
      sentences: [],
      refused: true,
    };
  }

  return {
    text: groundedSentences.join(" "),
    sentences: groundedSentences,
    refused: false,
  };
}
