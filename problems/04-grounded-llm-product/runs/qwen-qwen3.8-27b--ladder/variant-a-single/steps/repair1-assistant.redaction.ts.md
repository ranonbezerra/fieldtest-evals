# repair1-assistant.redaction.ts

## reasoning

```
Let me analyze the compiler errors that pertain to `src/assistant/assistant.redaction.ts`:

1. `src/assistant/assistant.redaction.ts(1,52): error TS2307: Cannot find module './assistant.grounding' or its corresponding type declarations.`
2. `
```

## reply

```typescript
// ASSUMPTION: assistant.grounding exports a `Sentence` interface (with at least `text: string`) and a `splitSentences(text: string): Sentence[]` function, inferred from import positions and the TS7006 on parameter `q`.
import { splitSentences, type Sentence } from './assistant.grounding';

/**
 * Redacts a grounded full-answer into a spoiler-free hint.
 *
 * Rules:
 *  - Boss names (capitalised multi-word proper nouns that are not the question
 *    itself) are replaced with "[redacted]".
 *  - Item locations (phrases like "in <place>", "behind <place>", etc.) are
 *    replaced with "[redacted]".
 *  - Quantities (number + unit) that the player did NOT already mention in
 *    their question are replaced with "[redacted]".
 */
export function redactToHint(fullAnswer: string, question: string): string {
  const sentences = splitSentences(fullAnswer);
  const questionLower = question.toLowerCase();

  const redacted = sentences.map((s) => {
    let text = s.text;

    // Redact boss names: sequences of 2+ capitalised words that aren't in the question
    text = text.replace(
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g,
      (match) => {
        if (questionLower.includes(match.toLowerCase())) {
          return match;
        }
        return '[redacted]';
      },
    );

    // Redact locations: "in <place>", "behind <place>", "on <place>", "at <place>", "under <place>"
    text = text.replace(
      /\b(?:in|behind|on|at|under)\s+(?:the\s+)?[A-Za-z][A-Za-z\s'()-]*(?=[,.!?]|$)/g,
      '[redacted]',
    );

    // Redact quantities not mentioned by the player: e.g. "4 shards", "5 pieces"
    text = text.replace(
      /\b(\d+)\s+(shards?|pieces?|keys?|tokens?|fragments?|crystals?|items?)\b/gi,
      (match, _num, _unit) => {
        if (questionLower.includes(match.toLowerCase())) {
          return match;
        }
        return '[redacted]';
      },
    );

    return text;
  });

  return redacted.join(' ');
}
```
