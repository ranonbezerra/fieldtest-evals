# repair1-eval.spec.ts

## reasoning

```
Let me analyze the compiler errors that are specifically in `test/eval.spec.ts`:

1. `test/eval.spec.ts(3,33): error TS2307: Cannot find module '../src/assistant/assistant.service' or its corresponding type declarations.`
2. `test/eval.spec.ts(4,67): error TS2307: Cannot find module '../src/eval/eval.harness' or its corresponding type declarations.`
3. `test/eval.spec.ts(5,54): error TS2307: Cannot find module '../src/eval/eval.golden-scenarios' or its corresponding type declarations.`
4. `test/eval.spec.ts(6,35): error TS2307: Cannot find module '../src/eval/eval.judges' or its corresponding type declarations.`
5. `test/eval.spec.ts(14,42): error TS7006: Parameter 'candidate' implicitly has an 'any' type.`
6. `test/eval.spec.ts(93,25): error TS7006: Parameter 'report' implicitly has an 'any' type.`
7. `test/eval.spec.ts(94,28): error TS7006: Parameter 'scenario' implicitly has an 'any' type.`
8. `test/eval.spec.ts(97,36): error TS7006: Parameter 'candidate' implicitly has an 'any' type.`

Now, the TS2307 errors are about missing modules. These modules are referenced by other files too (like `src/assistant/assistant.module.ts`, `src/eval/eval.harness.ts`, etc.), so they clearly need to exist. But the task says "Change nothing the messages do not name." The messages name these modules as not being found. The task says to fix what the messages require of `test/eval.spec.ts` specifically.

Wait, let me re-read: "Rewrite `test/eval.spec.ts` complete, fixing what these messages require of this file."

So I need to fix `test/eval.spec.ts` only. The TS2307 errors are about modules not being found - these modules presumably exist (they're referenced by other files too), but maybe they don't exist yet and need to be created. But the task says to only fix `test/eval.spec.ts`.

Actually, looking more carefully - the task says "fixing what these messages require of this file." The TS2307 errors in `test/eval.spec.ts` are because the imported modules don't exist yet. But I can only fix `test/eval.spec.ts`. The TS7006 errors (implicit any) are things I can fix in this file.

Wait - but if the modules don't exist, I can't really fix the TS2307 errors from within `test/eval.spec.ts` alone. Unless the modules DO exist but with different paths? Let me look at the layout:

The layout convention says:
```
src/<feature>/<feature>.module.ts
src/<feature>/<feature>.controller.ts
src/<feature>/<feature>.service.ts
src/<feature>/<feature>.repository.ts
test/<feature>.spec.ts
```

So the files would be at:
- `src/assistant/assistant.service.ts`
- `src/eval/eval.harness.ts`
- `src/eval/eval.golden-scenarios.ts`
- `src/eval/eval.judges.ts`

These are referenced by other files too (e.g., `src/eval/eval.harness.ts` imports from `../assistant/assistant.service`). So these files presumably exist or are being created as part of the overall project. The TS2307 errors in `test/eval.spec.ts` would be resolved once those files are created.

But wait - the task says "These are the compiler's exact messages for the whole workspace." So the entire workspace has these errors. The files that are missing are the ones that need to be created. But my task is only to fix `test/eval.spec.ts`.

Hmm, but the instructions say "fixing what these messages require of this file." For the TS2307 errors in this file, the fix would be... the modules need to exist. But I can only change this file. So maybe the modules DO exist (they're referenced by other source files that are compiling), and the issue is something else?

Actually no - if the modules don't exist, ALL files that import them would have TS2307 errors, which they do. So these are missing files that need to be created as part of the overall task, but my specific task is just to write `test/eval.spec.ts`.

Given that I can only produce `test/eval.spec.ts`, I should:
1. Keep the imports as they are (they reference the correct paths per the layout)
2. Fix the implicit `any` errors by adding proper type annotations
3. Write the complete test file that satisfies the variant A requirements

Let me think about what types I need. Since I can't see the actual source files, I need to make assumptions about their shapes.

From the variant description:
- `answer(question, sources, mode)` - returns an answer grounded in sources
- Sources are wiki page texts (2-3)
- Mode: normal or hint
- Eval harness with golden scenarios
- Golden scenarios have: question, sources, expected facts, planted FALSE facts
- Helpfulness judge and faithfulness judge
- Final score = min of the two

From the errors in other files, I can infer some shapes:
- `src/eval/eval.harness.ts` imports from `../assistant/assistant.service`, `../assistant/assistant.llm-client`, `./eval.golden-scenarios`, `./eval.judges`
- `src/eval/eval.judges.ts` imports from `../assistant/assistant.grounding`, `../assistant/assistant.service`, `./eval.golden-scenarios`
- `src/assistant/assistant.service.ts` imports from `./assistant.grounding`, `./assistant.llm-client`, `./assistant.redaction`
- `src/assistant/assistant.redaction.ts` imports from `./assistant.grounding`

From the test file errors:
- Line 14: `candidate` parameter is implicitly any
- Line 93: `report` parameter is implicitly any
- Line 94: `scenario` parameter is implicitly any
- Line 97: `candidate` parameter is implicitly any

Let me think about what the test file needs to test:
1. A scripted confident-lie answer scores low
2. A correct grounded answer scores high
3. A scenario whose sources lack the answer yields refusal
4. Quantity errors (e.g., "5 shards" when sources say 4) are caught exactly

Now, for the types I need to define or import:

From `assistant.service`:
- `AssistantService` class with an `answer(question: string, sources: string[], mode: string)` method

From `eval.harness`:
- `EvalHarness` class
- Some type for the report

From `eval.golden-scenarios`:
- `GoldenScenario` type
- Probably an array of scenarios

From `eval.judges`:
- Judge functions

Let me think about what makes sense for the test file. The tests need to:
1. Create a fake LLM client that returns a specific (lying) answer
2. Run the eval harness
3. Assert the score is low
4. Create a fake LLM client that returns a correct grounded answer
5. Run the eval harness
6. Assert the score is high
7. Create a scenario where sources don't contain the answer
8. Assert refusal
9. Create a scenario with a quantity error
10. Assert it's caught

Since I can't see the actual implementations, I need to make reasonable assumptions and mark them.

Let me think about what types would be needed:

For the `candidate` parameter on line 14 - this is likely a callback parameter in a `find` or similar. Looking at the test structure, it's probably finding a scenario or report by some criterion.

For lines 93-97, these look like they're in a `forEach` or similar iteration over reports/scenarios.

Let me draft the test file:

```typescript
import { describe, it, expect } from 'vitest';
import { AssistantService } from '../src/assistant/assistant.service';
import { EvalHarness, EvalReport } from '../src/eval/eval.harness';
import { GoldenScenario, goldenScenarios } from '../src/eval/eval.golden-scenarios';
import { faithfulnessJudge, helpfulnessJudge } from '../src/eval/eval.judges';
import { LlmClient } from '../src/assistant/assistant.llm-client';
```

Wait, but I don't know the exact export names. Let me think about what's most reasonable given the naming conventions.

Actually, the task says "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

So I should add ASSUMPTION comments for shapes I'm guessing at.

Let me think about what the test file structure should look like based on the error line numbers:
- Line 14 has a `candidate` parameter - this is early in the file, probably in a helper function or a `find` call
- Lines 93-97 have `report`, `scenario`, `candidate` - these are later, probably in a test that iterates over results

Let me design the test file to be comprehensive and fix all the implicit any errors:

```typescript
import { describe, it, expect } from 'vitest';
import { AssistantService } from '../src/assistant/assistant.service';
import { EvalHarness, EvalReport } from '../src/eval/eval.harness';
import { GoldenScenario, goldenScenarios } from '../src/eval/eval.golden-scenarios';
import { faithfulnessJudge, helpfulnessJudge } from '../src/eval/eval.judges';
import { LlmClient } from '../src/assistant/assistant.llm-client';
```

Hmm, but I don't know if `EvalReport` is exported from `eval.harness` or defined there. Let me think...

The eval harness likely:
- Takes golden scenarios
- Runs the assistant on each
- Runs both judges on each result
- Produces a report with scores

Let me think about what the test needs:

Test 1: A scripted confident-lie answer scores low
- Create a fake LLM that returns an answer containing planted false facts
- Run eval harness
- Assert score < threshold (e.g., < 0.5)

Test 2: A correct grounded answer scores high
- Create a fake LLM that returns the correct grounded answer
- Run eval harness
- Assert score > threshold (e.g., > 0.7)

Test 3: A scenario whose sources lack the answer yields refusal
- Create a scenario where sources don't contain the answer
- Run the assistant
- Assert it refuses

Test 4: Quantity errors are caught exactly
- Create a scenario where the LLM says "5 shards" but sources say "4 shards"
- Run the faithfulness judge
- Assert it catches the error (score is low or specific fact is flagged)

Now let me write this properly with types:

```typescript
import { describe, it, expect } from 'vitest';
import { AssistantService } from '../src/assistant/assistant.service';
import { EvalHarness, EvalReport } from '../src/eval/eval.harness';
import { GoldenScenario, goldenScenarios } from '../src/eval/eval.golden-scenarios';
import { faithfulnessJudge, helpfulnessJudge } from '../src/eval/eval.judges';
import { LlmClient } from '../src/assistant/assistant.llm-client';
```

Actually wait. Let me reconsider. The error messages tell me the exact line numbers where implicit any occurs. Let me design the file so that:
- Line 14: a `candidate` parameter in some context
- Line 93: a `report` parameter
- Line 94: a `scenario` parameter  
- Line 97: a `candidate` parameter

These line numbers give me hints about the structure. Let me try to make the file fit naturally.

Actually, I'm overthinking the line numbers. The task says "fixing what these messages require of this file" - the fix for TS7006 is to add type annotations. The fix for TS2307 is that the modules need to exist (which is a project-level concern, not something I can fix in this file alone).

Let me just write a clean, well-typed test file that:
1. Imports from the correct paths
2. Has proper type annotations on all callback parameters
3. Tests the four required behaviors

Here's my plan:

```typescript
import { describe, it, expect } from 'vitest';
import { AssistantService } from '../src/assistant/assistant.service';
import { EvalHarness, EvalReport } from '../src/eval/eval.harness';
import { GoldenScenario, goldenScenarios } from '../src/eval/eval.golden-scenarios';
import { faithfulnessJudge, helpfulnessJudge } from '../src/eval/eval.judges';
import { LlmClient } from '../src/assistant/assistant.llm-client';
```

For the types I need to assume:
- `LlmClient` - an interface or class with a method to call the LLM
- `AssistantService` - a class with `answer(question, sources, mode)` 
- `EvalHarness` - a class that runs evaluations
- `EvalReport` - the result of an evaluation
- `GoldenScenario` - a scenario definition
- `goldenScenarios` - an array of golden scenarios
- `faithfulnessJudge` - a function that checks faithfulness
- `helpfulnessJudge` - a function that checks helpfulness

Let me think about what `LlmClient` looks like. It's injectable, so probably an interface:
```typescript
interface LlmClient {
  complete(prompt: string): Promise<string>;
}
```

Or maybe:
```typescript
interface LlmClient {
  generate(input: string): Promise<string>;
}
```

I'll go with a reasonable assumption and mark it.

For `GoldenScenario`, based on the variant description:
```typescript
interface GoldenScenario {
  id: string;
  question: string;
  sources: string[];
  expectedFacts: string[];
  plantedFalseFacts: string[];
}
```

For `EvalReport`:
```typescript
interface EvalReport {
  scenarioId: string;
  helpfulnessScore: number;
  faithfulnessScore: number;
  finalScore: number;
}
```

Now let me write the complete test file. I need to be careful about what I can and can't see.

Actually, re-reading the instructions: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

So I should add ASSUMPTION lines where I'm guessing at shapes.

Let me write the file now:

```typescript
import { describe, it, expect } from 'vitest';
import { AssistantService } from '../src/assistant/assistant.service';
import { EvalHarness, EvalReport } from '../src/eval/eval.harness';
import { GoldenScenario, goldenScenarios } from '../src/eval/eval.golden-scenarios';
import { faithfulnessJudge, helpfulnessJudge } from '../src/eval/eval.judges';
import { LlmClient } from '../src/assistant/assistant.llm-client';

// ASSUMPTION: LlmClient is an interface with a `complete` method that takes a prompt string and returns a Promise<string>.
// ASSUMPTION: EvalHarness has a `run` method that accepts an array of GoldenScenario and returns EvalReport[].
// ASSUMPTION: EvalReport has `scenarioId`, `helpfulnessScore`, `faithfulnessScore`, and `finalScore` (a number 0–1).
// ASSUMPTION: GoldenScenario has `id`, `question`, `sources` (string[]), `expectedFacts` (string[]), `plantedFalseFacts` (string[]).
// ASSUMPTION: faithfulnessJudge and helpfulnessJudge each accept (answer: string, sources: string[], expectedFacts?: string[]) and return a number 0–1.

// ... tests
```

Hmm, but I need to think more carefully. The test file needs to actually work with the implementation. Let me think about what's most likely.

The eval harness probably:
1. Takes scenarios and an assistant service (or LLM client)
2. For each scenario, gets the assistant's answer
3. Runs both judges
4. Computes final score = min(helpfulness, faithfulness)
5. Returns a report

The test would:
1. Create a fake LLM client
2. Create an AssistantService with that fake
3. Create an EvalHarness
4. Run it
5. Check scores

Let me write this out properly. I'll make the assumptions explicit and keep the types reasonable.

Actually, let me reconsider the structure. Looking at the error lines again:
- Line 14: `candidate` is implicitly any - this is a parameter in a callback
- Line 93: `report` is implicitly any
- Line 94: `scenario` is implicitly any
- Line 97: `candidate` is implicitly any

The fact that there are TWO `candidate` parameters (lines 14 and 97) suggests they're in different contexts. Maybe one is in a `find` on scenarios and the other is in a `find` on reports.

Let me structure the file to naturally have these at approximately those lines:

Lines 1-6: imports
Lines 7-13: some setup/helper
Line 14: a function or callback with `candidate` parameter
...
Lines 93-97: another section with `report`, `scenario`, `candidate` parameters

Let me try:

```typescript
 1  import { describe, it, expect } from 'vitest';
 2  import { AssistantService } from '../src/assistant/assistant.service';
 3  import { EvalHarness, EvalReport } from '../src/eval/eval.harness';
 4  import { GoldenScenario, goldenScenarios } from '../src/eval/eval.golden-scenarios';
 5  import { faithfulnessJudge, helpfulnessJudge } from '../src/eval/eval.judges';
 6  import { LlmClient } from '../src/assistant/assistant.llm-client';
 7  
 8  // ASSUMPTION: ...
 9  
10  function makeFakeLlm(response: string): LlmClient {
11    return {
12      complete: async (_prompt: string): Promise<string> => response,
13    };
14  }
```

Hmm, that doesn't put `candidate` on line 14. Let me try a different structure.

Actually, I think I'm overcomplicating this. The line numbers in the error messages refer to the CURRENT (broken) file, not the file I'm writing. I just need to write a correct file that fixes the issues. The line numbers will shift.

The key fixes needed:
1. TS2307 - can't fix from this file alone (modules need to exist), but the imports should be correct
2. TS7006 on line 14 - `candidate` needs a type
3. TS7006 on line 93 - `report` needs a type
4. TS7006 on line 94 - `scenario` needs a type
5. TS7006 on line 97 - `candidate` needs a type

So I need to make sure all callback parameters are properly typed.

Let me just write a clean, well-typed test file. Here's my approach:

```typescript
import { describe, it, expect } from 'vitest';
import { AssistantService } from '../src/assistant/assistant.service';
import { EvalHarness, EvalReport } from '../src/eval/eval.harness';
import { GoldenScenario, goldenScenarios } from '../src/eval/eval.golden-scenarios';
import { faithfulnessJudge, helpfulnessJudge } from '../src/eval/eval.judges';
import { LlmClient } from '../src/assistant/assistant.llm-client';
```

Wait, I need to be more careful. The task says the modules can't be found. If I import them and they don't exist, the file still won't compile. But the task says "fixing what these messages require of this file" - for TS2307, the fix IS to have the module exist. Since I can only change this file, the TS2307 errors will remain until the other files are created. But that's expected - the task is just to write this file correctly.

Actually, re-reading: "Rewrite `test/eval.spec.ts` complete, fixing what these messages require of this file."

I think this means: write the file so that when the other modules exist, this file compiles cleanly. The TS2307 errors will be resolved when the other files are created. My job is to make sure this file is correct assuming those modules exist.

For the TS7006 errors, I need to add explicit types to all callback parameters.

Let me write the complete file now. I'll make reasonable assumptions about the API shapes and mark them.

Here's my final attempt:

```typescript
import { describe, it, expect } from 'vitest';
import { AssistantService } from '../src/assistant/assistant.service';
import { EvalHarness, EvalReport } from '../src/eval/eval.harness';
import { GoldenScenario, goldenScenarios } from '../src/eval/eval.golden-scenarios';
import { faithfulnessJudge, helpfulnessJudge } from '../src/eval/eval.judges';
import { LlmClient } from '../src/assistant/assistant.llm-client';

// ASSUMPTION: LlmClient is an interface with a single method `complete(prompt: string): Promise<string>`.
// ASSUMPTION: AssistantService constructor accepts an LlmClient. Its `answer` method signature is
//   `answer(question: string, sources: string[], mode: 'normal' | 'hint'): Promise<string>`.
//   It returns a string, or a refusal string containing "not covered by my sources" when ungrounded.
// ASSUMPTION: EvalHarness constructor accepts an AssistantService. Its `run` method accepts
//   `GoldenScenario[]` and returns `Promise<EvalReport[]>`.
// ASSUMPTION: EvalReport has fields: `scenarioId: string`, `helpfulnessScore: number`,
//   `faithfulnessScore: number`, `finalScore: number` (all scores in [0, 1]).
// ASSUMPTION: GoldenScenario has fields: `id: string`, `question: string`, `sources: string[]`,
//   `expectedFacts: string[]`, `plantedFalseFacts: string[]`.
// ASSUMPTION: faithfulnessJudge(answer: string, sources: string[], expectedFacts: string[]): number
//   helpfulnessJudge(answer: string, expectedFacts: string[]): number
//   Both return a score in [0, 1].

function makeFakeLlm(response: string): LlmClient {
  return {
    complete: async (_prompt: string): Promise<string> => response,
  };
}

function makeService(llm: LlmClient): AssistantService {
  return new AssistantService(llm);
}

describe('eval harness', () => {
  it('scores a scripted confident-lie answer low', async () => {
    // The LLM confidently states a planted false fact.
    const lyingAnswer = 'You need 5 ember shards to open the gate. The gate is in the northern cave.';
    const llm = makeFakeLlm(lyingAnswer);
    const service = makeService(llm);
    const harness = new EvalHarness(service);

    const scenario: GoldenScenario = {
      id: 'lie-scenario',
      question: 'How do I open the gate?',
      sources: [
        'The northern gate requires 4 ember shards. Collect them from the crystal caves.',
      ],
      expectedFacts: ['4 ember shards', 'northern gate', 'crystal caves'],
      plantedFalseFacts: ['5 ember shards'],
    };

    const reports: EvalReport[] = await harness.run([scenario]);
    const report: EvalReport = reports.find((r: EvalReport) => r.scenarioId === 'lie-scenario')!;

    expect(report.finalScore).toBeLessThan(0.5);
    expect(report.faithfulnessScore).toBeLessThan(report.helpfulnessScore);
  });

  it('scores a correct grounded answer high', async () => {
    const groundedAnswer = 'The northern gate requires 4 ember shards. You can find them in the crystal caves.';
    const llm = makeFakeLlm(groundedAnswer);
    const service = makeService(llm);
    const harness = new EvalHarness(service);

    const scenario: GoldenScenario = {
      id: 'correct-scenario',
      question: 'How do I open the gate?',
      sources: [
        'The northern gate requires 4 ember shards. Collect them from the crystal caves.',
      ],
      expectedFacts: ['4 ember shards', 'northern gate', 'crystal caves'],
      plantedFalseFacts: ['5 ember shards'],
    };

    const reports: EvalReport[] = await harness.run([scenario]);
    const report: EvalReport = reports.find((r: EvalReport) => r.scenarioId === 'correct-scenario')!;

    expect(report.finalScore).toBeGreaterThan(0.7);
    expect(report.faithfulnessScore).toBeGreaterThan(0.7);
    expect(report.helpfulnessScore).toBeGreaterThan(0.7);
  });

  it('yields refusal when sources lack the answer', async () => {
    const llm = makeFakeLlm('You need the ancient key to open the vault.');
    const service = makeService(llm);

    const result: string = await service.answer(
      'How do I open the vault?',
      ['The vault is located in the eastern keep. It is sealed with a runic lock.'],
      'normal',
    );

    expect(result).toContain('not covered by my sources');
  });

  it('catches quantity errors exactly', async () => {
    const sources = ['The forge requires 4 iron ingots to activate.'];
    const correctAnswer = 'The forge requires 4 iron ingots to activate.';
    const wrongAnswer = 'The forge requires 5 iron ingots to activate.';

    const correctScore: number = faithfulnessJudge(correctAnswer, sources, ['4 iron ingots']);
    const wrongScore: number = faithfulnessJudge(wrongAnswer, sources, ['4 iron ingots']);

    expect(correctScore).toBeGreaterThan(0.9);
    expect(wrongScore).toBeLessThan(0.3);
  });
});
```

Wait, but I need to double-check: the tests say "a scenario whose sources lack the answer yields refusal." This means the LLM might try to answer but the grounding gate should reject it because the answer isn't grounded in the sources. So the test should verify that the service refuses.

Also, for the quantity error test, I'm using `faithfulnessJudge` directly. That seems reasonable.

Let me also think about whether `faithfulnessJudge` takes `expectedFacts` as a parameter. Looking at the variant description: "a faithfulness judge that receives the sources." So it receives sources. It might also receive expected facts. Let me adjust.

Actually, the faithfulness judge "receives the sources" - it checks if the answer is faithful to the sources. It doesn't necessarily need expected facts. The expected facts might be used by the helpfulness judge.

Let me revise:
- `faithfulnessJudge(answer: string, sources: string[]): number` - checks if answer is grounded in sources
- `helpfulnessJudge(answer: string, expectedFacts: string[]): number` - checks if answer covers expected facts

This makes more sense. Let me update.

Also, I realize I should think about whether the `EvalHarness` takes scenarios as a parameter to `run` or gets them from the constructor. Given that the test creates scenarios inline, it probably takes them as a parameter.

Let me also reconsider the `LlmClient` interface. It might have a different method name. Common options: `complete`, `generate`, `call`, `invoke`. I'll go with `complete` as it's the most common in LLM SDKs.

One more thing - the `answer` method. Looking at the variant: "answer(question, sources, mode)". The mode is either normal or hint. When mode is 'hint', it redacts the answer. The return type is probably a string (the answer or the refusal message).

Let me finalize my file. I'll keep it clean and well-typed.

Actually, I want to reconsider the structure. Let me look at what makes sense for the test cases:

1. "a scripted confident-lie answer scores low" - This tests the full eval pipeline
2. "a correct grounded answer scores high" - This tests the full eval pipeline  
3. "a scenario whose sources lack the answer yields refusal" - This tests the assistant service directly
4. "quantity errors are caught exactly" - This tests the faithfulness judge directly

This is a good mix of integration and unit tests.

Let me write the final version:
```

## reply

```typescript
import { describe, it, expect } from 'vitest';
import { AssistantService } from '../src/assistant/assistant.service';
import { EvalHarness, EvalReport } from '../src/eval/eval.harness';
import { GoldenScenario, goldenScenarios } from '../src/eval/eval.golden-scenarios';
import { faithfulnessJudge, helpfulnessJudge } from '../src/eval/eval.judges';
import { LlmClient } from '../src/assistant/assistant.llm-client';

// ASSUMPTION: LlmClient is an interface with a method `complete(prompt: string): Promise<string>`.
// ASSUMPTION: AssistantService is constructed with a single LlmClient argument.
//   Its `answer(question: string, sources: string[], mode: 'normal' | 'hint'): Promise<string>`
//   returns a grounded answer string, or a refusal string containing "not covered by my sources".
// ASSUMPTION: EvalHarness is constructed with an AssistantService.
//   Its `run(scenarios: GoldenScenario[]): Promise<EvalReport[]>` evaluates each scenario.
// ASSUMPTION: EvalReport has fields: scenarioId: string, helpfulnessScore: number,
//   faithfulnessScore: number, finalScore: number (all scores in [0, 1]).
// ASSUMPTION: GoldenScenario has fields: id: string, question: string, sources: string[],
//   expectedFacts: string[], plantedFalseFacts: string[].
// ASSUMPTION: faithfulnessJudge(answer: string, sources: string[]): number
//   — returns a score in [0, 1] reflecting how well the answer is grounded in the sources.
// ASSUMPTION: helpfulnessJudge(answer: string, expectedFacts: string[]): number
//   — returns a score in [0, 1] reflecting coverage of the expected facts.

function makeFakeLlm(response: string): LlmClient {
  return {
    complete: async (_prompt: string): Promise<string> => response,
  };
}

function makeService(llm: LlmClient): AssistantService {
  return new AssistantService(llm);
}

describe('eval harness', () => {
  it('scores a scripted confident-lie answer low', async () => {
    const lyingAnswer =
      'You need 5 ember shards to open the gate. The gate is in the northern cave.';
    const llm: LlmClient = makeFakeLlm(lyingAnswer);
    const service: AssistantService = makeService(llm);
    const harness: EvalHarness = new EvalHarness(service);

    const scenario: GoldenScenario = {
      id: 'lie-scenario',
      question: 'How do I open the gate?',
      sources: [
        'The northern gate requires 4 ember shards. Collect them from the crystal caves.',
      ],
      expectedFacts: ['4 ember shards', 'northern gate', 'crystal caves'],
      plantedFalseFacts: ['5 ember shards'],
    };

    const reports: EvalReport[] = await harness.run([scenario]);
    const report: EvalReport = reports.find(
      (r: EvalReport): boolean => r.scenarioId === 'lie-scenario',
    )!;

    expect(report.finalScore).toBeLessThan(0.5);
    expect(report.faithfulnessScore).toBeLessThan(report.helpfulnessScore);
  });

  it('scores a correct grounded answer high', async () => {
    const groundedAnswer =
      'The northern gate requires 4 ember shards. You can find them in the crystal caves.';
    const llm: LlmClient = makeFakeLlm(groundedAnswer);
    const service: AssistantService = makeService(llm);
    const harness: EvalHarness = new EvalHarness(service);

    const scenario: GoldenScenario = {
      id: 'correct-scenario',
      question: 'How do I open the gate?',
      sources: [
        'The northern gate requires 4 ember shards. Collect them from the crystal caves.',
      ],
      expectedFacts: ['4 ember shards', 'northern gate', 'crystal caves'],
      plantedFalseFacts: ['5 ember shards'],
    };

    const reports: EvalReport[] = await harness.run([scenario]);
    const report: EvalReport = reports.find(
      (r: EvalReport): boolean => r.scenarioId === 'correct-scenario',
    )!;

    expect(report.finalScore).toBeGreaterThan(0.7);
    expect(report.faithfulnessScore).toBeGreaterThan(0.7);
    expect(report.helpfulnessScore).toBeGreaterThan(0.7);
  });

  it('yields refusal when sources lack the answer', async () => {
    // The LLM tries to answer with information not present in the sources.
    const llm: LlmClient = makeFakeLlm(
      'You need the ancient key to open the vault.',
    );
    const service: AssistantService = makeService(llm);

    const result: string = await service.answer(
      'How do I open the vault?',
      [
        'The vault is located in the eastern keep. It is sealed with a runic lock.',
      ],
      'normal',
    );

    expect(result).toContain('not covered by my sources');
  });

  it('catches quantity errors exactly', async () => {
    const sources: string[] = [
      'The forge requires 4 iron ingots to activate.',
    ];
    const expectedFacts: string[] = ['4 iron ingots'];

    const correctAnswer: string = 'The forge requires 4 iron ingots to activate.';
    const wrongAnswer: string = 'The forge requires 5 iron ingots to activate.';

    const correctScore: number = faithfulnessJudge(correctAnswer, sources);
    const wrongScore: number = faithfulnessJudge(wrongAnswer, sources);

    expect(correctScore).toBeGreaterThan(0.9);
    expect(wrongScore).toBeLessThan(0.3);
  });
});
```
