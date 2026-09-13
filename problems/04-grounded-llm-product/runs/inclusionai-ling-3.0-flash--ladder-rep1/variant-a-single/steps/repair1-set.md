# repair1-set

## reasoning

```
Let me analyze the errors:

1. `src/index.ts(1,10)`: "Re-exporting a type when 'isolatedModules' is enabled requires using 'export type'."
   - The first line of `src/index.ts` is `export { LLMClient } from "./llm-client.interface.js";` — LLMClient is a type (interface), so it needs `export type`.

2. Three errors in `test/answer.spec.ts`:
   - Line 140: `Property 'message' does not exist on type 'AnswerResult'` — accessing `.message` on a union type where only the "refused" variant has it.
   - Line 154: `Property 'content' does not exist on type 'AnswerResult'` — accessing `.content` where only "answered" and "hint" have it.
   - Line 169: Same as 140.

These are type narrowing issues. The test is accessing properties on the discriminated union without narrowing first. But wait — the task says "Fix all of them" and "Change exactly what the compiler requires." The errors are in the test file and the index file.

Let me look at the test file more carefully. The errors are at lines 140, 154, 169. Let me check what's happening:

From the test spec:
- Line ~140: `result.message` where result could be any AnswerResult — this happens in the "refuses when sources lack the answer" test where status is "refused"
- Line ~154: `result.content` where result could be any AnswerResult — this happens in the "answers when sources cover the answer" test where status is "answered"
- Line ~169: `result.message` again

Wait, but actually, TypeScript should be able to narrow these with `result.status === "refused"`. Let me look at the test code more carefully.

Looking at the test code:
```ts
const result = await service.answer(...);
expect(result.status).toBe("refused");
expect(result.message).toBe("not covered by my sources");
```

The issue is that `expect(result.status).toBe("refused")` doesn't narrow the type in TypeScript because `toBe` has a broad signature. This is a common issue. The fix would be to use a type assertion or narrow manually.

But the instruction says "Change exactly what the compiler requires" and "Do not add features." The test file is existing code. The errors are TypeScript type checking errors.

Options to fix:
1. Add explicit type narrowing in the test (e.g., `const refused = result as { status: "refused"; message: string }`)
2. Or use a helper

Actually, looking at the reference code more carefully — the test file IS the reference. The errors are real compilation errors. The task says "Fix all of them in one reply."

For the test errors, the simplest fix is to narrow the type. Common approaches:
- `expect(result).toMatchObject({ status: "refused" })` then cast
- Or just cast: `(result as { status: "refused"; message: string }).message`
- Or use an if/else to narrow

Let me think about what the minimal change is. The cleanest approach that doesn't add features:

For line 140 and 169 (accessing `.message`):
```ts
const refused = result as { status: "refused"; message: string };
expect(refused.message).toBe("not covered by my sources");
```

Or alternatively, we can check the status explicitly:
```ts
if (result.status === "refused") {
  expect(result.message).toBe("not covered by my sources");
}
```

For line 154 (accessing `.content`):
Similarly, narrow by status.

Actually, the simplest fix: since `result.status` was already checked, we can use a type guard. Let me just add explicit narrowing.

Wait — let me re-read the instructions: "Change exactly what the compiler requires." The test file errors need narrowing. Let me do it with minimal changes.

Now for `src/index.ts` — the `LLMClient` re-export needs `export type`.

Let me figure out what files to output. The errors are in:
1. `src/index.ts`
2. `test/answer.spec.ts`

Wait, but looking at the index.ts errors and the file listing — the index.ts is at the root level based on the path in the error: `src/index.ts`. Let me check — the reference shows `src/index.ts` as a file.

Let me now write the fixes.

For `src/index.ts`, change `export { LLMClient }` to `export type { LLMClient }`.

For `test/answer.spec.ts`, I need to fix the three type narrowing issues at lines 140, 154, and 169.

But I can't just show fragments — I need to show the complete file. However, the test file is very long. Let me think...

The instruction says "the complete file, first line to last." So I need to include the entire test/answer.spec.ts file. But I'm told "Never a fragment" — so I must reproduce the full file with fixes.

Let me reconstruct the test file from the reference and apply the fixes.

Actually, let me look at the line numbers more carefully. The reference test file has specific content. Lines 140, 154, 169 correspond to specific `expect` calls.

Let me count lines in the reference test file... it's quite long. Rather than counting precisely, I'll note the pattern of the errors:

The errors occur after `await service.answer(...)` calls where the result type isn't narrowed. The fix is to narrow the type before accessing union members.

I'll reconstruct the full file with the fixes applied.

Let me also check — the FakeLLM `generate()` method. In the interface it probably takes `(question, context)` but in the fake it only takes `response`. Let me check: `async generate(): Promise<string>` in the fake vs the interface. The test compiles the fake, so it must satisfy the interface via contextual typing... actually if `LLMClient` has `generate(question: string, context: string): Promise<string>`, then the fake implementing `generate(): Promise<string>` would be an error unless the interface has optional params or something. But since it's not in the error list, it must be fine.

OK let me reconstruct the full test/answer.spec.ts file. I'll be careful to reproduce it exactly from the reference, with the type fixes applied.

For the type narrowing fixes, I'll use explicit casting which is minimal:
- `(result as { status: "refused"; message: string }).message`
- `(result as { status: "answered"; content: string }).content`

Or alternatively, since we know the status at that point, I can use a temporary variable with type annotation.

Let me go with a clean approach. After `const result = await service.answer(...)`, I'll narrow using the status check or cast.

Actually, the most idiomatic TypeScript approach without adding new features: after checking `result.status`, do an explicit cast. Let me use:

```ts
if (result.status === "refused") {
  expect(result.message).toBe("not covered by my sources");
}
```

Wait, but that changes the test structure. The instruction says "Change exactly what the compiler requires." Let me use the minimal change — just cast.

Hmm, but actually a cleaner minimal fix: just assign to a typed variable.

Let me just look at what makes sense:

For line 140: `expect(result.message).toBe(...)` where result is AnswerResult and we know it's "refused".
Fix: `expect((result as { status: "refused"; message: string }).message).toBe(...)`

For line 154: `expect(result.content).toContain(...)` where we know it's "answered".
Fix: `expect((result as { status: "answered"; content: string }).content).toContain(...)`

For line 169: Same as 140.

Actually, I could also just change the `AnswerResult` type definition. But the instruction says don't change what's not required. The errors are in the test and index files, so those are what need fixing.

Wait — could the issue be that `AnswerResult` should be defined differently? No, it's a discriminated union and that's correct TypeScript. The tests just need to narrow.

Let me finalize my approach and write out the two files.

For the index.ts, let me check what it needs to export from the reference:

```ts
export { LLMClient } from "./llm-client.interface.js";
export { AnswerService, type AnswerResult, type Mode } from "./answer.service.js";
export {
  groundAnswer,
  isSentenceGrounded,
  extractProperNouns,
  extractQuantities,
  splitSentences,
} from "./grounding.gate.js";
export { redactForHint } from "./hint.redactor.js";
export {
  helpfulnessJudge,
  faithfulnessJudge,
} from "./eval.judges.js";
export { EvalHarness } from "./eval-harness.js";
export type { Scenario, EvalResult, Outcome } from "./eval-harness.js";
export {
  SCENARIO_CONFIDENT_LIE,
  SCENARIO_CORRECT,
  SCENARIO_SOURCES_LACK,
  SCENARIO_QUANTITY_ERROR,
} from "./eval-scenarios.js";
```

Only the first line has a type-only export that needs `export type`. The others already use `type` keyword inline.

So the fix is just: `export type { LLMClient } from "./llm-client.interface.js";`

Now let me construct the full test file. I need to reproduce it completely with fixes at the three locations.

Let me trace the line numbers in the reference. The test file is about 170+ lines. The errors are at lines 140, 154, 169. Let me figure out what those correspond to in the reference:

The "Answer service" section starts around line 120-something. Let me count more carefully:

Lines 1-3: import
Lines 5-13: FakeLLM class
Lines 15: describe("grounding gate")
Lines 16-50ish: grounding gate tests
Lines ~52-70: quantity checking
Lines ~72-85: proper nouns
Lines ~87-95: quantities
Lines ~97-120: Answer service tests
Lines ~122+: hint mode tests

Let me count the answer service tests section more carefully:

```
describe("Answer service", () => {
  it("refuses when sources lack the answer", async () => {
    const llm = new FakeLLM(
      "The Phantom Key is in the Shadow Temple.",
    );
    const service = new AnswerService(llm);
    const result = await service.answer(
      "Where is the Phantom Key?",
      ["The Dragon King is the final boss."],
      "normal",
    );
    expect(result.status).toBe("refused");     // ~line 139
    expect(result.message).toBe("not covered by my sources");  // line 140

  it("answers when sources cover the answer", async () => {
    ...
    expect(result.status).toBe("answered");    // ~line 153
    expect(result.content).toContain("4");     // line 154

  it("catches quantity error exactly and refuses", async () => {
    ...
    expect(result.status).toBe("refused");     // ~line 168
    expect(result.message).toBe("not covered by my sources");  // line 169
```

So the fixes are:
- Line 140: `result.message` → cast to access `.message`
- Line 154: `result.content` → cast to access `.content`  
- Line 169: `result.message` → cast to access `.message`

Now let me write out the complete files.
```

## reply

### src/index.ts
```ts
export type { LLMClient } from "./llm-client.interface.js";
export { AnswerService, type AnswerResult, type Mode } from "./answer.service.js";
export {
  groundAnswer,
  isSentenceGrounded,
  extractProperNouns,
  extractQuantities,
  splitSentences,
} from "./grounding.gate.js";
export { redactForHint } from "./hint.redactor.js";
export {
  helpfulnessJudge,
  faithfulnessJudge,
} from "./eval.judges.js";
export { EvalHarness } from "./eval-harness.js";
export type { Scenario, EvalResult, Outcome } from "./eval-harness.js";
export {
  SCENARIO_CONFIDENT_LIE,
  SCENARIO_CORRECT,
  SCENARIO_SOURCES_LACK,
  SCENARIO_QUANTITY_ERROR,
} from "./eval-scenarios.js";
```

### test/answer.spec.ts
```ts
import { describe, it, expect } from "vitest";
import type { LLMClient } from "../src/llm-client.interface.js";
import { AnswerService } from "../src/answer.service.js";
import {
  isSentenceGrounded,
  extractProperNouns,
  extractQuantities,
  groundAnswer,
} from "../src/grounding.gate.js";
import { redactForHint } from "../src/hint.redactor.js";

class FakeLLM implements LLMClient {
  constructor(private readonly response: string) {}
  async generate(): Promise<string> {
    return this.response;
  }
}

// ── Grounding gate ──────────────────────────────────────────────────────────

describe("grounding gate", () => {
  it("drops a sentence whose proper noun is not in sources", () => {
    const sources = ["The Dragon King drops 4 fire shards."];
    expect(
      isSentenceGrounded(
        "The Shadow Lord drops 5 dragon stones.",
        sources,
      ),
    ).toBe(false);
  });

  it("drops a sentence whose quantity does not match sources", () => {
    const sources = ["The Dragon King drops 4 fire shards."];
    // 5 fire shards ≠ 4 fire shards in sources
    expect(
      isSentenceGrounded(
        "The Dragon King drops 5 fire shards.",
        sources,
      ),
    ).toBe(false);
  });

  it("keeps a sentence fully supported by sources", () => {
    const sources = ["The Dragon King drops 4 fire shards."];
    expect(
      isSentenceGrounded(
        "The Dragon King drops 4 fire shards.",
        sources,
      ),
    ).toBe(true);
  });

  it("returns null when no sentence survives", () => {
    const sources = ["The Dragon King drops 4 fire shards."];
    const result = groundAnswer(
      "The Shadow Lord drops 5 dragon stones.",
      sources,
    );
    expect(result).toBeNull();
  });

  it("returns the grounded text when sentences survive", () => {
    const sources = [
      "The Dragon King is the final boss.",
      "The Dragon King drops 4 fire shards.",
    ];
    const result = groundAnswer(
      "The Shadow Lord drops 5 dragon stones. The Dragon King drops 4 fire shards.",
      sources,
    );
    expect(result).toBe("The Dragon King drops 4 fire shards.");
  });
});

// ── Quantity checking is exact ──────────────────────────────────────────────

describe("quantity checking", () => {
  it('catches "5 shards" when sources say 4', () => {
    const sources = ["The Dragon King drops 4 fire shards."];
    const grounded = groundAnswer(
      "The Dragon King drops 5 fire shards.",
      sources,
    );
    expect(grounded).toBeNull();
  });

  it("accepts the exact quantity from sources", () => {
    const sources = ["The Dragon King drops 4 fire shards."];
    const grounded = groundAnswer(
      "The Dragon King drops 4 fire shards.",
      sources,
    );
    expect(grounded).not.toBeNull();
    expect(grounded!).toContain("4");
  });
});

// ── Proper noun extraction ─────────────────────────────────────────────────

describe("extractProperNouns", () => {
  it("extracts multi-word proper nouns", () => {
    expect(
      extractProperNouns("The Dragon King is powerful."),
    ).toContain("Dragon King");
  });

  it("returns an empty array when no proper nouns", () => {
    expect(extractProperNouns("It is raining.")).toEqual([]);
  });
});

// ── Quantity extraction ────────────────────────────────────────────────────

describe("extractQuantities", () => {
  it("extracts number-noun pairs", () => {
    expect(extractQuantities("He drops 4 fire shards.")).toEqual([
      { number: 4, noun: "fire shards" },
    ]);
  });

  it("returns empty when no quantities", () => {
    expect(extractQuantities("No numbers here.")).toEqual([]);
  });
});

// ── Answer service ──────────────────────────────────────────────────────────

describe("AnswerService", () => {
  it("refuses when sources lack the answer", async () => {
    const llm = new FakeLLM(
      "The Phantom Key is in the Shadow Temple.",
    );
    const service = new AnswerService(llm);
    const result = await service.answer(
      "Where is the Phantom Key?",
      ["The Dragon King is the final boss."],
      "normal",
    );
    expect(result.status).toBe("refused");
    expect((result as { status: "refused"; message: string }).message).toBe("not covered by my sources");
  });

  it("answers when sources cover the answer", async () => {
    const llm = new FakeLLM(
      "The Dragon King drops 4 fire shards.",
    );
    const service = new AnswerService(llm);
    const result = await service.answer(
      "How many fire shards?",
      ["The Dragon King drops 4 fire shards."],
      "normal",
    );
    expect(result.status).toBe("answered");
    expect((result as { status: "answered"; content: string }).content).toContain("4");
  });

  it("catches quantity error exactly and refuses", async () => {
    const sources = ["The Dragon King drops 4 fire shards."];
    const llm = new FakeLLM(
      "The Dragon King drops 5 fire shards.",
    );
    const service = new AnswerService(llm);
    const result = await service.answer(
      "How many fire shards?",
      sources,
      "normal",
    );
    expect(result.status).toBe("refused");
    expect((result as { status: "refused"; message: string }).message).toBe("not covered by my sources");
  });
});

// ── Hint mode redaction ─────────────────────────────────────────────────────

describe("hint mode redaction", () => {
  it("removes boss name, location, and unmentioned quantity", () => {
    const grounded =
      "The Dragon King at the Crystal Cavern requires 5 fire shards.";
    const question = "How should I prepare?";
    const redacted = redactForHint(grounded, question);

    expect(redacted).not.toContain("Dragon King");
    expect(redacted).not.toContain("Crystal Cavern");
    expect(redacted).not.toContain("5");
  });

  it("keeps quantities mentioned in the player's question", () => {
    const grounded = "You need 3 moon gems and 5 fire shards.";
    const question = "I have 3 moon gems, where do I get more?";
    const redacted = redactForHint(grounded, question);

    expect(redacted).toContain("3");
    expect(redacted).not.toContain("5");
  });
});
```
