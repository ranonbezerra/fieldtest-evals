# repair2-eval.service.ts

## reasoning

```
We need to write eval.service.ts with correct imports. Likely other files missing. We assume paths: answer.service.ts, fake-llm-client.service.ts, llm-client.interface.ts. We can create placeholder imports? Just import types? Provide minimal implementation to compile.

Implement class EvalService with methods per description: evaluate(question, sources, expectedFacts, falseFacts, mode). Use answer service and maybe LLM client. We'll just import AnswerService from './answer.service'; import FakeLlmClientService? maybe not needed. Provide simple logic.

Assume AnswerService has method answer(question, sources, mode). We'll call it.

Implement evaluate returning score number.

Add necessary exports.

Write file.
```

## reply

```ts
// src/answer/eval.service.ts

import { Injectable } from '@nestjs/common';

// ASSUMPTION: The AnswerService exists in the same folder and exports a class
// with a method `answer(question: string, sources: string[], mode: 'full' | 'hint')`
// that returns a string (the generated answer).
import { AnswerService } from './answer.service';

// ASSUMPTION: The LLM client interface exists at './llm-client.interface' but is not
// required directly in this file; the AnswerService internally uses it.
// We therefore do not import it here.

// Helper types for the evaluation harness
type Mode = 'full' | 'hint';

interface EvaluationResult {
  helpfulnessScore: number; // 0‑1
  faithfulnessScore: number; // 0‑1
  finalScore: number; // min(helpfulness, faithfulness)
}

/**
 * EvalService provides a very small evaluation harness for the grounded‑LLM answer
 * pipeline. It receives a question, the retrieved source texts, the expected
 * factual statements, and a set of planted false statements. It uses the
 * AnswerService to generate an answer (full or hint mode) and then judges the
 * answer for helpfulness and faithfulness.
 *
 * The implementation purposefully stays simple: it checks that every expected
 * fact appears verbatim in the answer, that no false fact appears, and that the
 * answer respects the requested mode (i.e., hints must not contain any banned
 * tokens such as boss names, item locations, or quantities that exceed what the
 * player already mentioned – this simple version just checks for the presence of
 * a placeholder token `<<REDACTED>>` which the AnswerService is expected to insert).
 *
 * The service returns an object with the two scores and the final score.
 */
@Injectable()
export class EvalService {
  constructor(private readonly answerService: AnswerService) {}

  /**
   * Run a single evaluation scenario.
   *
   * @param question          The player's question.
   * @param sources           An array of source texts fetched from the wiki.
   * @param expectedFacts     Array of strings that must be present in a correct answer.
   * @param falseFacts        Array of strings that must NOT be present.
   * @param mode              'full' for a complete answer, 'hint' for redacted hint.
   * @returns                 An object containing the two sub‑scores and the final score.
   */
  async evaluate(
    question: string,
    sources: string[],
    expectedFacts: string[],
    falseFacts: string[],
    mode: Mode = 'full',
  ): Promise<EvaluationResult> {
    // 1. Generate answer using the AnswerService.
    const answer = await this.answerService.answer(question, sources, mode);

    // 2. Faithfulness: every expected fact must be present, no false fact may appear.
    const faithfulnessScore = this.judgeFaithfulness(answer, expectedFacts, falseFacts);

    // 3. Helpfulness: in 'hint' mode we expect a redaction token; in 'full' mode we
    //    expect the answer not to be the generic refusal message.
    const helpfulnessScore = this.judgeHelpfulness(answer, mode);

    // 4. Final score is the minimum of the two.
    const finalScore = Math.min(faithfulnessScore, helpfulnessScore);

    return { helpfulnessScore, faithfulnessScore, finalScore };
  }

  /**
   * Faithfulness judge.
   *
   * Returns a score between 0 and 1:
   *   - 1 if *all* expected facts are found and *none* of the false facts are found.
   *   - 0 otherwise.
   */
  private judgeFaithfulness(
    answer: string,
    expectedFacts: string[],
    falseFacts: string[],
  ): number {
    // Normalise strings for simple containment checks.
    const normalized = answer.toLowerCase();

    const allExpectedPresent = expectedFacts.every((fact) =>
      normalized.includes(fact.toLowerCase()),
    );

    const anyFalsePresent = falseFacts.some((fact) =>
      normalized.includes(fact.toLowerCase()),
    );

    return allExpectedPresent && !anyFalsePresent ? 1 : 0;
  }

  /**
   * Helpfulness judge.
   *
   * In 'full' mode we consider the answer helpful if it is not the refusal
   * envelope. In 'hint' mode we consider it helpful if it contains the
   * `<<REDACTED>>` token (which the AnswerService should insert for redacted
   * portions). Any deviation yields a score of 0.
   */
  private judgeHelpfulness(answer: string, mode: Mode): number {
    const refusalEnvelope = /^{\s*"error":\s*{[^}]*}}\s*$/s;

    if (mode === 'full') {
      // Any non‑refusal answer is considered helpful for this simple harness.
      return refusalEnvelope.test(answer) ? 0 : 1;
    }

    // hint mode
    // The answer should contain the redaction placeholder.
    const containsRedaction = answer.includes('<<REDACTED>>');
    // It also must not be a refusal envelope.
    const notRefusal = !refusalEnvelope.test(answer);

    return containsRedaction && notRefusal ? 1 : 0;
  }
}
```
