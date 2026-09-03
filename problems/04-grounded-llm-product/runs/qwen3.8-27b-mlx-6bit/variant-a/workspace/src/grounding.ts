import type { Source } from "./sources.js";

export interface GroundedSentence {
  text: string;
  grounded: boolean;
  sourceId: string | null;
}

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall",
  "should", "may", "might", "can", "could", "to", "of", "in", "on",
  "at", "by", "for", "with", "from", "as", "and", "or", "but", "if",
  "that", "this", "these", "those", "it", "its", "he", "she", "they",
  "we", "you", "i", "me", "him", "her", "us", "them", "not", "no",
  "so", "than", "too", "very", "just", "also", "only", "own", "same",
]);

function splitSentences(raw: string): string[] {
  const matches = raw.match(/[^.!?]*[.!?]+|[^.!?]+$/g);
  if (!matches) return [];
  return matches.map((s) => s.trim()).filter((s) => s.length > 0);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

function contentWords(text: string): string[] {
  return tokenize(text).filter((w) => !STOP_WORDS.has(w));
}

function toBigrams(words: string[]): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    result.add(`${words[i]} ${words[i + 1]}`);
  }
  return result;
}

export function gateSentences(raw: string, sources: Source[]): GroundedSentence[] {
  const sentences = splitSentences(raw);

  const sourceBigrams: { id: string; bigrams: Set<string> }[] = sources.map((src) => ({
    id: src.id,
    bigrams: toBigrams(contentWords(src.text)),
  }));

  return sentences.map((sentence) => {
    const sentBigrams = toBigrams(contentWords(sentence));

    if (sentBigrams.size === 0) {
      return { text: sentence, grounded: false, sourceId: null };
    }

    let maxOverlap = 0;
    let bestSourceId: string | null = null;

    for (const sb of sourceBigrams) {
      let overlap = 0;
      for (const bg of sentBigrams) {
        if (sb.bigrams.has(bg)) overlap++;
      }
      if (overlap > maxOverlap) {
        maxOverlap = overlap;
        bestSourceId = sb.id;
      }
    }

    const ratio = maxOverlap / sentBigrams.size;
    const grounded = ratio >= 0.7;

    return {
      text: sentence,
      grounded,
      sourceId: grounded ? bestSourceId : null,
    };
  });
}

export function groundedOnly(sentences: GroundedSentence[]): string[] {
  return sentences.filter((s) => s.grounded).map((s) => s.text);
}
