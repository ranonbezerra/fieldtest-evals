# 03-grounding.ts

## reasoning

```
Let me analyze the PLAN.md to understand what `src/grounding.ts` needs to implement:

1. **`GateSentences`** - Split raw LLM text into sentences, then classify each against sources.
   - Split raw on sentence delimiters (. ! ? + whitespace)
   - For each sentence: extract content-word bigrams; compute overlap with every source
   - `grounded = (maxOverlap / totalBigrams) ≥ 0.7`
   - `sourceId = id of the best-matching source, or null`

2. **`groundedOnly`** - Return sentences that passed the gate, or empty array.

Types needed:
- `GroundedSentence` interface with `text`, `grounded`, `sourceId`
- Import `Source` from `src/sources.ts`

Let me think about the implementation:

**Sentence splitting:**
- Split on `.`, `!`, `?` followed by whitespace or end of string. Also handle whitespace as a delimiter? The plan says "Split raw on sentence delimiters (. ! ? + whitespace)". I'll interpret this as splitting on sentence-ending punctuation followed by whitespace, and also treating sequences of whitespace as separators. Actually, re-reading: "Split raw on sentence delimiters (. ! ? + whitespace)" - this could mean the delimiters are `.`, `!`, `?` AND whitespace. But that would be too aggressive. Let me think more carefully.

Actually, I think the most reasonable reading is: split on sentence-ending punctuation (`.`, `!`, `?`) that is followed by whitespace or end of string. The "+ whitespace" might just mean we trim whitespace around the delimiters. Let me go with splitting on `(?<=[.!?])\s+` or similar regex.

Wait, let me re-read: "Split raw on sentence delimiters (. ! ? + whitespace)". I think this means the delimiters are `.`, `!`, `?` (with surrounding whitespace). So split on patterns like `. `, `! `, `? `, and also handle the end of string.

Let me use a regex: split on `(?<=[.!?])\s+` and also handle the case where there's no trailing space.

Actually, a simpler approach: use a regex to match sentences: `/[^.!?]*[.!?]?/g` and filter out empty strings. Or I could split on `/(?<=\s)(?=[^.!?]*[.!?]\s)|\n/`... 

Let me just go with: match sentences using a regex that captures text ending in `.`, `!`, or `?`, or the last chunk without punctuation.

I'll use: `raw.match(/[^.!?]*[.!?]+|[^.!?]+$/g)` and then trim each result, filtering out empty strings.

**Content-word bigrams:**
- Tokenize: lowercase, remove punctuation, split on whitespace
- Filter out stop words (common words like "the", "a", "is", "are", etc.)
- Create bigrams from the remaining content words
- A bigram is a pair of consecutive content words

**Overlap computation:**
- For each sentence, get its set of bigrams
- For each source, get its set of bigrams
- overlap = |sentenceBigrams ∩ sourceBigrams|
- maxOverlap = max over all sources of overlap
- totalBigrams = |sentenceBigrams|
- grounded = (maxOverlap / totalBigrams) ≥ 0.7

Edge case: if a sentence has no bigrams (only one content word or zero), what do we do? I'll say if totalBigrams is 0, it's not grounded (can't verify).

Let me write the code:

```typescript
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
  "so", "than", "too", "very", "just", "also", "only", "own", "same"
]);

function splitSentences(raw: string): string[] {
  const matches = raw.match(/[^.!?]*[.!?]+|[^.!?]+$/g);
  if (!matches) return [];
  return matches.map(s => s.trim()).filter(s => s.length > 0);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 0);
}

function contentWords(text: string): string[] {
  return tokenize(text).filter(w => !STOP_WORDS.has(w));
}

function bigrams(words: string[]): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    result.add(`${words[i]} ${words[i + 1]}`);
  }
  return result;
}

export function gateSentences(raw: string, sources: Source[]): GroundedSentence[] {
  const sentences = splitSentences(raw);
  
  // Pre-compute source bigrams
  const sourceBigrams = sources.map(source => ({
    id: source.id,
    bigrams: bigrams(contentWords(source.text)),
  }));

  return sentences.map(sentence => {
    const sentBigrams = bigrams(contentWords(sentence));
    
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
    return {
      text: sentence,
      grounded: ratio >= 0.7,
      sourceId: ratio >= 0.7 ? bestSourceId : null,
    };
  });
}

export function groundedOnly(sentences: GroundedSentence[]): string[] {
  return sentences.filter(s => s.grounded).map(s => s.text);
}
```

Wait, the plan says the file is at `src/grounding.ts` and it reads from `src/sources.ts`. The import should be relative. Since both are in `src/`, it would be `./sources.js` (ESM convention with `.js` extension for TypeScript in ESM mode).

Let me double-check the plan's requirements:
- `GateSentences(raw: string, sources: Source[]): GroundedSentence[]` ✓
- `groundedOnly(sentences: GroundedSentence[]): string[]` ✓
- Sentence-level keyword-overlap: ≥ 70% of content-word bigrams appear in at least one source ✓
- `sourceId = id of the best-matching source, or null` ✓

I think this is solid. Let me also make sure I'm not adding anything the plan doesn't call for. The plan specifies exactly `gateSentences` and `groundedOnly` as exports, plus the `GroundedSentence` interface. I'll keep the helper functions private (not exported).

One thing to consider: the plan says "Split raw on sentence delimiters (. ! ? + whitespace)". Let me make sure my regex handles this correctly. The regex `[^.!?]*[.!?]+|[^.!?]+$` should work:
- `[^.!?]*[.!?]+` matches any text (not containing .!?) followed by one or more sentence-ending punctuation marks
- `[^.!?]+$` matches any remaining text at the end without punctuation

This should handle cases like "Hello. World! How are you?" → ["Hello.", "World!", "How are you?"]

And for "not covered by my sources" (no punctuation) → ["not covered by my sources"]

Looks good. Let me finalize.
```

## reply

```typescript
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
```
