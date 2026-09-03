# repair2-harness.ts

## reasoning

```
The compiler errors are all about missing `.js` extensions in relative import paths. I need to fix `src/eval/harness.ts` by adding `.js` extensions to all its relative imports.

Looking at the errors for `src/eval/harness.ts`:
1. Line 1, col 24: `'../answer'` → should be `'../answer.js'`
2. Line 2, col 31: `'./scenarios'` → should be `'./scenarios.js'`
3. Line 3, col 32: `'../llm-client'` → should be `'../llm-client.js'`
4. Line 4, col 38: `'../redaction'` → should be `'../redaction.js'`
5. Line 5, col 53: `'./judges'` → should be `'./judges.js'`

Now I need to reconstruct the full file based on the PLAN.md. The plan specifies:

```ts
export interface EvalResult {
  scenarioId: string;
  helpfulnessScore: number;
  faithfulnessScore: number;
  finalScore: number;          // min(helpfulness, faithfulness)
  passed: boolean;             // finalScore >= PASS_THRESHOLD
}

export declare const PASS_THRESHOLD: number; // 0.8

/** Run `answer()` for each scenario, then score with both judges. */
export declare function runEval(
  scenarios: Scenario[],
  llm: LLMClient,
  redactionConfig?: RedactionConfig,
): Promise<EvalResult[]>;
```

The ordering rule says: `runEval` calls `answer()` once per scenario (mode `"full"`), then feeds the resulting text to both judges.

The imports needed based on the manifest:
- `src/answer.ts` → for `answer()` and `AnswerResult`
- `src/eval/scenarios.ts` → for `Scenario`
- `src/llm-client.ts` → for `LLMClient`
- `src/redaction.ts` → for `RedactionConfig`
- `src/eval/judges.ts` → for `helpfulnessJudge`, `faithfulnessJudge`, `JudgeVerdict`

Let me write the complete file with `.js` extensions on all relative imports.
```

## reply

```ts
import { answer, type AnswerResult } from "../answer.js";
import type { Scenario } from "./scenarios.js";
import type { LLMClient } from "../llm-client.js";
import type { RedactionConfig } from "../redaction.js";
import { helpfulnessJudge, faithfulnessJudge } from "./judges.js";

export interface EvalResult {
  scenarioId: string;
  helpfulnessScore: number;
  faithfulnessScore: number;
  finalScore: number;
  passed: boolean;
}

export const PASS_THRESHOLD = 0.8;

export async function runEval(
  scenarios: Scenario[],
  llm: LLMClient,
  redactionConfig?: RedactionConfig,
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  for (const scenario of scenarios) {
    const result: AnswerResult = await answer(
      {
        question: scenario.question,
        sources: scenario.sources,
        mode: "full",
      },
      llm,
      redactionConfig,
    );

    const helpfulness = helpfulnessJudge(result.text, scenario.expectedFacts);
    const faithfulness = faithfulnessJudge(
      result.text,
      scenario.sources,
      scenario.plantedFalseFacts,
    );

    const finalScore = Math.min(helpfulness.score, faithfulness.score);

    results.push({
      scenarioId: scenario.id,
      helpfulnessScore: helpfulness.score,
      faithfulnessScore: faithfulness.score,
      finalScore,
      passed: finalScore >= PASS_THRESHOLD,
    });
  }

  return results;
}
```
