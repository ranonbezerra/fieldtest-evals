# 05-answer.ts

## reasoning

```
Let me analyze the PLAN.md to understand what `src/answer.ts` needs to implement:

From the plan:
1. It exports `Mode` type ("full" | "hint")
2. It exports `AnswerInput` interface with question, sources, mode
3. It exports `AnswerResult` interface with text, refused, groundedSentences
4. It exports `answer()` function that:
   - Takes `input: AnswerInput`, `llm: LLMClient`, `redactionConfig?: RedactionConfig`
   - Returns `Promise<AnswerResult>`

Control flow:
1. Build prompt: "You are a game guide. Answer using ONLY these pages:\n" + sources joined by "\n---\n" + "\n\nQuestion: " + question
2. raw = await llm.generate(prompt)
3. sentences = gateSentences(raw, sources)
4. If groundedOnly(sentences).length === 0: return { text: "not covered by my sources", refused: true, groundedSentences: sentences }
5. text = groundedOnly(sentences).join(" ")
6. If input.mode === "hint" && redactionConfig: text = redactForHint(text, input.question, redactionConfig).text
7. return { text, refused: false, groundedSentences: sentences }

Imports needed:
- `Source` from `./sources.js` (type)
- `LLMClient` from `./llm-client.js` (type)
- `gateSentences`, `groundedOnly`, `GroundedSentence` from `./grounding.js`
- `redactForHint`, `RedactionConfig` from `./redaction.js`

Let me write this file now.
```

## reply

```ts
import type { Source } from "./sources.js";
import type { LLMClient } from "./llm-client.js";
import type { GroundedSentence } from "./grounding.js";
import { gateSentences, groundedOnly } from "./grounding.js";
import type { RedactionConfig } from "./redaction.js";
import { redactForHint } from "./redaction.js";

export type Mode = "full" | "hint";

export interface AnswerInput {
  question: string;
  sources: Source[];
  mode: Mode;
}

export interface AnswerResult {
  text: string;
  refused: boolean;
  groundedSentences: GroundedSentence[];
}

export async function answer(
  input: AnswerInput,
  llm: LLMClient,
  redactionConfig?: RedactionConfig,
): Promise<AnswerResult> {
  // 1. Build prompt
  const sourcesBlock = input.sources.map((s) => s.text).join("\n---\n");
  const prompt =
    "You are a game guide. Answer using ONLY these pages:\n" +
    sourcesBlock +
    "\n\nQuestion: " +
    input.question;

  // 2. Call LLM
  const raw = await llm.generate(prompt);

  // 3. Gate sentences
  const sentences = gateSentences(raw, input.sources);

  // 4. Refuse if no grounded sentences
  const grounded = groundedOnly(sentences);
  if (grounded.length === 0) {
    return {
      text: "not covered by my sources",
      refused: true,
      groundedSentences: sentences,
    };
  }

  // 5. Join grounded sentences
  let text = grounded.join(" ");

  // 6. Redact for hint mode
  if (input.mode === "hint" && redactionConfig) {
    text = redactForHint(text, input.question, redactionConfig).text;
  }

  // 7. Return result
  return { text, refused: false, groundedSentences: sentences };
}
```
