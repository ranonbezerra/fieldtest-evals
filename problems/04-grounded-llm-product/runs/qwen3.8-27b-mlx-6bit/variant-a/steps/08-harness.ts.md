# 08-harness.ts

## reasoning

```
The task is to write exactly one file: `src/eval/harness.ts`

From the PLAN.md, this file should contain:
- `EvalResult` interface
- `PASS_THRESHOLD` constant (0.8)
- `runEval` function

The plan specifies:

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

Ordering rule: `runEval` calls `answer()` once per scenario (mode `"full"`), then feeds the resulting text to both judges. Judges are independent; neither sees the other's output.

From the manifest:
- `src/eval/harness.ts` reads: `src/answer.ts`, `src/eval/scenarios.ts`, `src/eval/judges.ts`

So I need to import:
- `answer` from `../answer.js` (or `../answer`)
- `Scenario`, `GOLDEN_SCENARIOS` from `./scenarios.js` (or `./scenarios`)
- `helpfulnessJudge`, `faithfulnessJudge` from `./judges.js` (or `./judges`)
- `LLMClient` from `../llm-client.js` (or `../llm-client`)
- `RedactionConfig` from `../redaction.js` (or `../redaction`)

Looking at the existing files in the workspace:
- `src/answer.ts` imports from `"./sources.js"`, `"./llm-client.js"`, etc. - using `.js` extension
- `src/eval/scenarios.ts` imports from `"../sources"` - NO `.js` extension
- `src/eval/judges.ts` imports from `"../sources"` - NO `.js` extension

So the eval files use no `.js` extension. I'll follow that convention for imports within `src/eval/`.

Wait, let me look more carefully. The `scenarios.ts` uses `import { Source } from "../sources";` and `judges.ts` uses `import { Source } from "../sources";`. So within the eval directory, they import from parent without `.js`. I'll follow that pattern.

Now let me write the implementation:

```ts
import { answer } from "../answer";
import type { Scenario } from "./scenarios";
import type { LLMClient } from "../llm-client";
import type { RedactionConfig } from "../redaction";
import { helpfulnessJudge, faithfulnessJudge } from "./judges";

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
    const result = await answer(
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

Wait - I need to check: does the plan say `declare` for these? In the plan, it uses `export declare const` and `export declare function` which is TypeScript declaration syntax. But in the actual implementation file, I should use regular `export const` and `export async function`. The `declare` keyword in the plan is just showing the signature shape, not meaning I should literally use `declare`.

Also, looking at the existing code style - `scenarios.ts` uses `export const GOLDEN_SCENARIOS: Scenario[]` (no declare). So I'll use regular exports.

Let me also check: the plan says "Judges are independent; neither sees the other's output." This is naturally satisfied by calling them independently and only using their scores.

One thing to note: the `answer` function takes `redactionConfig` as optional third param. In `runEval`, the plan says mode is `"full"`. If mode is "full", the redaction step in `answer()` won't trigger (it checks `input.mode === "hint"`). So passing `redactionConfig` is harmless but also unnecessary for the full mode. However, the plan's signature for `runEval` includes it as a parameter, so I'll pass it through.

Let me finalize the file.
```

## reply

```ts
import { answer } from "../answer";
import type { Scenario } from "./scenarios";
import type { LLMClient } from "../llm-client";
import type { RedactionConfig } from "../redaction";
import { helpfulnessJudge, faithfulnessJudge } from "./judges";

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
    const result = await answer(
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
