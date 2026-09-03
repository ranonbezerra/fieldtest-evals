# 04-redaction.ts

## reasoning

```
Let me analyze the plan for `src/redaction.ts`:

From the plan:
```ts
export interface RedactionConfig {
  bossNames: string[];
}

/**
 * Redact `answer` for hint mode.
 * Removes boss names (case-insensitive), location prepositional phrases,
 * and clamps quantities to those appearing in `question`.
 * Returns the redacted text plus a list of terms that were removed.
 */
export declare function redactForHint(
  answer: string,
  question: string,
  config: RedactionConfig,
): { text: string; removedTerms: string[] };
```

So I need to implement:
1. `RedactionConfig` interface with `bossNames: string[]`
2. `redactForHint` function that:
   - Removes boss names (case-insensitive)
   - Removes location prepositional phrases ("in/on/at <location>")
   - Clamps numeric quantities to those already present in the player's question
   - Returns `{ text: string; removedTerms: string[] }`

Let me think about the implementation:

1. **Boss names removal**: For each boss name in `config.bossNames`, replace all case-insensitive occurrences in the answer with something like `[REDACTED]` or just remove them. The plan says "strip proper nouns flagged as boss names". I'll replace them with a placeholder or remove them. Let me think... "strip" suggests removal. But removing a word from a sentence can leave awkward gaps. I'll replace with `[REDACTED]` to keep the text readable, and add the term to `removedTerms`.

Actually, re-reading: "Removes boss names (case-insensitive), location prepositional phrases, and clamps numeric quantities to those appearing in `question`."

Let me think about what "clamps quantities" means. If the answer says "5 shards" but the question only mentions "4 shards", then we clamp to "4 shards"? Or if the question doesn't mention a quantity, we remove it?

The plan says: "clamp numeric quantities to those appearing in `question`". So if the question mentions a number, we keep only that number. If the answer has a number not in the question, we... remove it? Or replace it with the question's number?

Actually, I think "clamp" means: if a quantity in the answer exceeds what's mentioned in the question, reduce it to the question's value. Or perhaps: only allow quantities that are already in the question.

Let me re-read the plan's assumptions: "clamp numeric quantities to those already present in the player's question"

I think the most defensible reading is: extract all numbers from the question. Any number in the answer that is NOT in the question's set gets replaced with `[REDACTED]` (or removed). Numbers that ARE in the question's set are kept.

Wait, but "clamp" has a specific meaning - it means to limit to a range. So if the question says "I have 4 shards" and the answer says "you need 5 shards", we'd clamp 5 down to 4? That seems odd.

Actually, I think the simpler and more defensible reading is: any numeric quantity in the answer that isn't already mentioned in the question gets redacted. This is "spoiler-free" - you shouldn't learn new quantities from the hint.

Let me go with: extract all numbers from the question. In the answer, any number that doesn't appear in the question gets replaced with `[REDACTED]`.

2. **Location prepositional phrases**: Strip patterns like "in <location>", "on <location>", "at <location>". The location would be the words following the preposition until the next sentence boundary or another preposition. I'll use a regex for this.

Let me implement:

```ts
export interface RedactionConfig {
  bossNames: string[];
}

export function redactForHint(
  answer: string,
  question: string,
  config: RedactionConfig,
): { text: string; removedTerms: string[] } {
  let text = answer;
  const removedTerms: string[] = [];

  // 1. Remove boss names (case-insensitive)
  for (const name of config.bossNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "gi");
    if (re.test(text)) {
      text = text.replace(re, "[REDACTED]");
      removedTerms.push(name);
    }
  }

  // 2. Remove location prepositional phrases (in/on/at <location>)
  const locRe = /\b(in|on|at)\s+[A-Z][\w\s]*/g;
  // Hmm, this is tricky. What defines the end of a location name?
  // Let me think... A location is typically a proper noun phrase. 
  // I'll match: (in|on|at) followed by words that start with capital or are part of a proper noun phrase,
  // up to the next sentence-ending punctuation or another preposition.
  
  // Actually, let me use a simpler approach: match "in/on/at" followed by one or more words
  // that are capitalized (proper nouns) or common location words.
  // For a deterministic approach, I'll match the preposition followed by words until 
  // punctuation or another sentence-starting word.
  
  const locationPattern = /\b(?:in|on|at)\s+(?:[A-Z]\w+[\s]*?)+?(?=[.!?,;]|$|\b(?:but|and|or|then|you|the|is|are|was|were|has|have|had|to|of)\b)/g;
  
  // This is getting complex. Let me simplify: match "in/on/at" + words until end of sentence or comma.
  // Actually the simplest defensible approach: "in/on/at" followed by capitalized words (location names).
  
  // Let me reconsider. The plan says "strip 'in/on/at <location>' phrases". 
  // I'll match: \b(in|on|at)\s+[A-Z]\w*(?:\s+[A-Z]\w*)*  — i.e., preposition followed by one or more capitalized words.
  
  // But what about lowercase locations? Like "in the ruins"? 
  // I think for a game guide, locations are typically proper nouns (capitalized).
  // Let me go with capitalized words after the preposition.
  
  const locRegex = /\b(in|on|at)\s+[A-Z]\w*(?:\s+[A-Z]\w*)*/g;
  const locMatches = text.match(locRegex);
  if (locMatches) {
    for (const m of locMatches) {
      text = text.replace(m, "[REDACTED]");
      removedTerms.push(m);
    }
  }
  
  // Wait, this won't work well with .replace for multiple occurrences of the same string.
  // Let me use a different approach - replace all at once with a callback.
  
  // Let me redo this more carefully.

  // 3. Clamp quantities: extract numbers from question, redact any number in answer not in that set.
  
  return { text, removedTerms };
}
```

Let me rethink the structure more carefully and write a clean implementation:

```ts
export interface RedactionConfig {
  bossNames: string[];
}

export function redactForHint(
  answer: string,
  question: string,
  config: RedactionConfig,
): { text: string; removedTerms: string[] } {
  let text = answer;
  const removedTerms: string[] = [];

  // 1. Remove boss names (case-insensitive)
  for (const name of config.bossNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "gi");
    if (re.test(text)) {
      text = text.replace(re, "[REDACTED]");
      removedTerms.push(name);
    }
  }

  // 2. Strip location prepositional phrases: "in/on/at <Capitalized Words>"
  const locRe = /\b(?:in|on|at)\s+[A-Z]\w*(?:\s+[A-Z]\w*)*/g;
  const locFound = new Set<string>();
  text = text.replace(locRe, (match) => {
    locFound.add(match);
    return "[REDACTED]";
  });
  for (const m of locFound) removedTerms.push(m);

  // 3. Clamp quantities: only allow numbers that appear in the question
  const questionNumbers = new Set(
    (question.match(/\d+/g) ?? []).map(Number),
  );
  const numRe = /\b\d+\b/g;
  const redactedNumbers = new Set<string>();
  text = text.replace(numRe, (match) => {
    if (!questionNumbers.has(Number(match))) {
      redactedNumbers.add(match);
      return "[REDACTED]";
    }
    return match;
  });
  for (const n of redactedNumbers) removedTerms.push(n);

  return { text, removedTerms };
}
```

Wait, there's an issue with the regex test/replace pattern for boss names. If I use `re.test(text)` and then `text.replace(re, ...)`, the regex has a `lastIndex` issue with global regexes. Let me fix that:

Actually, for `new RegExp(escaped, "gi")`, using `.test()` advances `lastIndex`, and then `.replace()` would start from that position. I should either:
- Use a fresh regex for each operation, or
- Just do the replace and check if the result differs.

Let me use the approach of checking if the replacement actually changed anything:

```ts
for (const name of config.bossNames) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped, "gi");
  const before = text;
  text = text.replace(re, "[REDACTED]");
  if (text !== before) {
    removedTerms.push(name);
  }
}
```

This is cleaner and avoids the lastIndex issue.

Now for the location regex - `\b(?:in|on|at)\s+[A-Z]\w*(?:\s+[A-Z]\w*)*` - this matches "in Dragon's Peak", "at the Ruins" (wait, "the" is lowercase so it won't match). Hmm.

Actually "in the Ruins" - "the" is lowercase, so my regex wouldn't capture it. Should I include articles? Let me think about what's defensible...

The plan says "strip 'in/on/at <location>' phrases". A location in a game guide is typically something like "the Forgotten Ruins", "Dragon Peak", "the Shadow Realm". 

I think a reasonable approach is to match the preposition followed by words (capitalized or not) until a sentence boundary, another preposition, or common conjunctions. But this is getting complex and could over-match.

For a deterministic, testable approach, let me match: preposition + optional article (the/a) + one or more words (capitalized or not) up to a word boundary that's followed by punctuation, end of string, or a lowercase function word.

Actually, let me keep it simpler and more conservative. The tests in the plan test that "boss names from the grounded answer are redacted (absent from output) and quantities are clamped to those in the question." The location redaction is mentioned but not explicitly tested in the test table. So I'll implement it but keep it reasonable.

Let me go with: match `(in|on|at)` followed by optional article, then words until sentence end or another preposition/conjunction. I'll use a moderately broad pattern:

`\b(?:in|on|at)\s+(?:the\s+|a\s+)?[A-Z]\w*(?:\s+[A-Za-z'\-]+)*?(?=\s*[.,!?;]|\s+(?:but|and|or|then|you|we|is|are|was|were|has|have|had|to|of|a|an|the)\b|$)`

This is getting really complex. Let me simplify for a first implementation that's defensible:

Match `in|on|at` followed by a space, then one or more "word-like" tokens (letters, apostrophes, hyphens) that start with a capital letter. This captures proper-noun locations.

`\b(?:in|on|at)\s+[A-Z]\w*(?:\s+[A-Z]\w*)*`

This will match "in Dragon Peak" but not "in the ruins". For a game guide where locations are typically proper nouns, this is reasonable. I'll add an ASSUMPTION comment if needed.

Actually wait - let me reconsider. In the test: "In hint mode, boss names from the grounded answer are redacted (absent from output) and quantities are clamped to those in the question." The test doesn't mention location redaction. So my implementation just needs to be reasonable for the plan's description.

Let me finalize my implementation. I'll keep it clean and well-structured.
```

## reply

```ts
export interface RedactionConfig {
  bossNames: string[];
}

/**
 * Redact `answer` for hint mode.
 * Removes boss names (case-insensitive), location prepositional phrases,
 * and clamps quantities to those appearing in `question`.
 * Returns the redacted text plus a list of terms that were removed.
 */
export function redactForHint(
  answer: string,
  question: string,
  config: RedactionConfig,
): { text: string; removedTerms: string[] } {
  let text = answer;
  const removedTerms: string[] = [];

  // 1. Remove boss names (case-insensitive)
  for (const name of config.bossNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "gi");
    const before = text;
    text = text.replace(re, "[REDACTED]");
    if (text !== before) {
      removedTerms.push(name);
    }
  }

  // 2. Strip location prepositional phrases: "in/on/at <CapitalizedWords>"
  // ASSUMPTION: locations are proper nouns (capitalised), so we match the
  // preposition followed by one or more capitalised word tokens.
  const locRe = /\b(?:in|on|at)\s+[A-Z]\w*(?:\s+[A-Z]\w*)*/g;
  const locFound = new Set<string>();
  text = text.replace(locRe, (match) => {
    locFound.add(match);
    return "[REDACTED]";
  });
  for (const m of locFound) {
    removedTerms.push(m);
  }

  // 3. Clamp quantities: only allow numbers that already appear in the question
  const questionNumbers = new Set(
    (question.match(/\d+/g) ?? []).map(Number),
  );
  const numRe = /\b\d+\b/g;
  const redactedNumbers = new Set<string>();
  text = text.replace(numRe, (match) => {
    if (!questionNumbers.has(Number(match))) {
      redactedNumbers.add(match);
      return "[REDACTED]";
    }
    return match;
  });
  for (const n of redactedNumbers) {
    removedTerms.push(n);
  }

  return { text, removedTerms };
}
```
