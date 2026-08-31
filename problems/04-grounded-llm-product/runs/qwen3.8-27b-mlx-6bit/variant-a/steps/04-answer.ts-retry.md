# 04-answer.ts-retry

## reply

```ts
import type { LlmClient } from "./llm-client.js";
import { GroundingError, groundAnswer } from "./grounding.js";
import type { HintConfig } from "./hint.js";
import { redactToHint } from "./hint.js";

export type AnswerMode = "full" | "hint";

export interface AnswerRequest {
  question: string;
  sources: string[];
  mode: AnswerMode;
}

export interface AnswerResult {
  text: string;
  refused: boolean;
}

// Re-exported for callers that import the error from this module.
export { GroundingError };

export async function answer(
  req: AnswerRequest,
  llm: LlmClient,
  hint?: HintConfig
): Promise<AnswerResult> {
  if (req.sources.length === 0) {
    throw new GroundingError();
  }

  const rawAnswer = await llm.generate(req.question, req.sources);
  const grounded = groundAnswer(rawAnswer, req.sources);

  if (req.mode === "full") {
    return { text: grounded.text, refused: grounded.refused };
  }

  if (hint === undefined) {
    throw new Error("hint config is required for hint mode");
  }

  const redacted = redactToHint(grounded, hint);
  return { text: redacted, refused: grounded.refused };
}
```
