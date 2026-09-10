# repair1-assistant.service.ts

## reasoning

```
Let me analyze the compiler errors that are specifically about `src/assistant/assistant.service.ts`:

1. `src/assistant/assistant.service.ts(3,30): error TS2307: Cannot find module './assistant.grounding' or its corresponding type declarations.`
2. `src/
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import {
  GroundingResult,
  GroundingVerdict,
  Sentence,
  groundAnswer,
} from './assistant.grounding';
import { LlmClient, LlmRequest, LlmResponse } from './assistant.llm-client';
import { redactAnswer } from './assistant.redaction';

// ASSUMPTION: I cannot see the source files for './assistant.grounding',
// './assistant.llm-client', or './assistant.redaction'. I inferred the shapes
// from the import sites, parameter usage, and the variant spec.

export type AnswerMode = 'full' | 'hint';

export interface AnswerSource {
  title: string;
  text: string;
}

export interface AnswerResult {
  text: string;
  grounded: boolean;
  mode: AnswerMode;
}

@Injectable()
export class AssistantService {
  constructor(private readonly llm: LlmClient) {}

  async answer(
    question: string,
    sources: AnswerSource[],
    mode: AnswerMode = 'full',
  ): Promise<AnswerResult> {
    const sourceText = sources.map((s) => s.text).join('\n\n');

    const llmResponse: LlmResponse = await this.llm.complete({
      question,
      sources: sourceText,
    } as LlmRequest);

    const rawAnswer: string = llmResponse.text;

    const grounding: GroundingResult = groundAnswer(rawAnswer, sources);

    if (!grounding.grounded) {
      return {
        text: 'not covered by my sources',
        grounded: false,
        mode: 'full',
      };
    }

    if (mode === 'hint') {
      const redacted: string = redactAnswer(rawAnswer, sources);
      return {
        text: redacted,
        grounded: true,
        mode: 'hint',
      };
    }

    const groundedText: string = grounding.sentences
      .filter((s: Sentence) => s.verdict === GroundingVerdict.Grounded)
      .map((s: Sentence) => s.text)
      .join(' ');

    return {
      text: groundedText,
      grounded: true,
      mode: 'full',
    };
  }
}
```
