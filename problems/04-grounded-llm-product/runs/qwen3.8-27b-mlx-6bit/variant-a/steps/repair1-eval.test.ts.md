# repair1-eval.test.ts

## reasoning

```
The error is:
```
test/eval.test.ts(38,1): error TS1005: '}' expected.
```

This means there's a missing closing brace at line 38. I need to rewrite the complete `test/eval.test.ts` file that covers the tests specified in PLAN.md section 5:

1. A scripted LLM that returns a confident-lie (contains a planted false fact) yields `finalScore < PASS_THRESHOLD`.
2. A scripted LLM that returns a correct grounded answer (all expected facts, no false facts) yields `finalScore ≥ PASS_THRESHOLD`.
3. A scripted LLM that says "5 shards" while the source says "4 shards" causes `faithfulnessScore < PASS_THRESHOLD` (quantity mismatch caught exactly).

Let me look at the PLAN.md to understand the interfaces:

- `runEval(scenarios, llm, redactionConfig?)` returns `Promise<EvalResult[]>`
- `EvalResult` has: `scenarioId`, `helpfulnessScore`, `faithfulnessScore`, `finalScore`, `passed`
- `PASS_THRESHOLD` is 0.8
- `ScriptedLLMClient` takes `string[]` in constructor
- `Scenario` has: `id`, `question`, `sources`, `expectedFacts`, `plantedFalseFacts`
- `Source` has: `id`, `title`, `text`

The tests need to use `runEval` with scenarios and a scripted LLM client. The scenarios used in the eval tests should be custom ones that match what we need for each test case.

Let me write the test file:

```typescript
import { describe, it, expect } from "vitest";
import { runEval, PASS_THRESHOLD } from "../src/eval/harness.js";
import { ScriptedLLMClient } from "../src/llm-client.js";
import type { Scenario, Source } from "../src/sources.js";
// wait, Scenario is in src/eval/scenarios.ts
import type { Scenario } from "../src/eval/scenarios.js";
import type { Source } from "../src/sources.js";
```

Wait, let me re-check the plan. The `Scenario` type is in `src/eval/scenarios.ts`. Let me look at the manifest:

```
src/eval/scenarios.ts | reads: src/sources.ts | Scenario type and GOLDEN_SCENARIOS fixtures
```

So `Scenario` is exported from `src/eval/scenarios.ts`.

Now let me write the tests. I need to create scenarios inline for each test:

Test 1: Confident lie - the LLM returns text containing a planted false fact. The faithfulness judge should catch it and score low.

Test 2: Correct grounded answer - the LLM returns text with all expected facts and no false facts. Both judges score high.

Test 3: Quantity error - the LLM says "5 shards" but source says "4 shards". The faithfulness judge catches the quantity mismatch.

Let me think about what the grounding gate does. It splits sentences and checks if ≥70% of content-word bigrams appear in sources. So for the LLM's response to pass the gate, it needs to share enough bigrams with the sources.

For test 1 (confident lie): The LLM returns something that is mostly grounded but contains a planted false fact. For example, if the source says "The Shadow Lord guards the Crystal Cave" and the LLM says "The Shadow Lord guards the Crystal Cave. You need a Phoenix Feather to enter." The "Phoenix Feather" is the planted false fact. The first sentence is grounded, the second might not be (depending on bigram overlap). Actually, let me think more carefully...

The grounding gate drops ungrounded sentences. So if the false fact sentence is ungrounded, it would be dropped and the answer would be clean. That's a problem for testing the "confident lie" scenario.

Wait, let me re-read the plan. The grounding gate is meant to catch ungrounded sentences. But a "confident lie" in the context of the eval is when the LLM produces something that IS grounded (passes the gate) but is factually wrong according to the planted false facts.

So for the confident lie test, the LLM's answer should be grounded (pass the gate) but contain a fact that contradicts the source. For example:
- Source: "You need 4 shards to open the gate."
- LLM says: "You need 5 shards to open the gate."

This would pass the grounding gate because most bigrams overlap ("need", "shards", "open", "the", "gate"), but the faithfulness judge should catch that "5 shards" contradicts the source's "4 shards".

Actually wait - that's test 3 (quantity error). Let me differentiate:

Test 1 (confident lie): The LLM invents something that isn't in the sources at all, like "You must defeat the Phoenix King first." The planted false fact is "Phoenix King". But if this sentence is ungrounded, it gets dropped by the gate...

Hmm, let me think about this differently. The eval harness tests the judges' ability to catch issues. Let me look at what `runEval` does:

```
runEval calls answer() once per scenario (mode "full"), then feeds the resulting text to both judges.
```

So the flow is: LLM generates → gate sentences → if grounded, pass to judges.

For the confident lie to be caught by the faithfulness judge (not just dropped by the gate), the lie needs to be grounded enough to pass the gate. 

Actually, re-reading the plan more carefully:

> A quantity mismatch (e.g. "5 shards" vs source "4 shards") counts as a violation and reduces the score.

And the faithfulness judge:
> Checks that no `plantedFalseFact` appears in `answer`, AND that every quantity claim in `answer` is consistent with `sources`.

So the faithfulness judge checks:
1. No planted false fact appears in the answer
2. Quantity claims are consistent with sources

For test 1, I need a planted false fact that would appear in the grounded answer. Let me think...

If the source says "The Shadow Lord guards the Crystal Cave. You need 4 shards to open the gate." and the LLM says "The Shadow Lord guards the Crystal Cave. You need 4 shards and a Phoenix Feather to open the gate." - then "Phoenix Feather" is the planted false fact. The sentence might still be grounded enough (bigram overlap) to pass the gate, and the faithfulness judge would catch "Phoenix Feather" as a planted false fact.

Actually, I think I'm overcomplicating this. Let me just make sure:
- The LLM output passes the grounding gate (enough bigram overlap)
- It contains a planted false fact
- The faithfulness judge catches it → low score

Let me design the scenarios:

**Test 1 - Confident lie:**
- Source: "The Crystal Cave is guarded by the Shadow Lord. You need 4 shards to open the gate."
- LLM response: "The Crystal Cave is guarded by the Shadow Lord. You need 4 shards and a Phoenix Feather to open the gate."
- expectedFacts: ["Shadow Lord", "4 shards"]
- plantedFalseFacts: ["Phoenix Feather"]

The second sentence "You need 4 shards and a Phoenix Feather to open the gate" - bigrams would be: "you need", "need 4", "4 shards", "shards and", "and a", "a phoenix", "phoenix feather", "feather to", "to open", "open the", "the gate". The source has: "you need", "need 4", "4 shards", "shards to", "to open", "open the", "the gate". So overlap is maybe 5/11 = ~45%. That might not pass the 70% threshold.

Hmm, I need the false fact to be embedded in a way that the sentence still passes the gate. Let me try:

- Source: "The Crystal Cave is guarded by the Shadow Lord. You need 4 shards to open the gate in the cave."
- LLM response: "The Crystal Cave is guarded by the Shadow Lord. You need 4 shards and a Phoenix Feather to open the gate in the cave."

Bigrams of second sentence: "you need", "need 4", "4 shards", "shards and", "and a", "a phoenix", "phoenix feather", "feather to", "to open", "open the", "the gate", "gate in", "in the", "the cave" = 14 bigrams
Source bigrams include: "you need", "need 4", "4 shards", "shards to", "to open", "open the", "the gate", "gate in", "in the", "the cave" = 10 matching
Overlap: 10/14 ≈ 71% ≥ 70% ✓

So it passes the gate. And "Phoenix Feather" is in the answer, which is a planted false fact → faithfulness judge catches it.

**Test 2 - Correct answer:**
- Source: "The Crystal Cave is guarded by the Shadow Lord. You need 4 shards to open the gate in the cave."
- LLM response: "The Crystal Cave is guarded by the Shadow Lord. You need 4 shards to open the gate in the cave."
- expectedFacts: ["Shadow Lord", "4 shards"]
- plantedFalseFacts: ["Phoenix Feather"]

Both sentences are fully grounded. All expected facts present. No false facts. Both judges score 1.0.

**Test 3 - Quantity error:**
- Source: "The Crystal Cave is guarded by the Shadow Lord. You need 4 shards to open the gate in the cave."
- LLM response: "The Crystal Cave is guarded by the Shadow Lord. You need 5 shards to open the gate in the cave."
- expectedFacts: ["Shadow Lord", "shards"]  (note: NOT "4 shards" since the answer says "5 shards")
- plantedFalseFacts: []

Wait, if expectedFacts includes "4 shards" and the answer says "5 shards", then the helpfulness judge would also score low. But the test specifically says "quantity mismatch caught exactly" referring to faithfulness. Let me re-read:

> A scripted LLM that says "5 shards" while the source says "4 shards" causes `faithfulnessScore < PASS_THRESHOLD` (quantity mismatch caught exactly).

So the test specifically asserts that `faithfulnessScore < PASS_THRESHOLD`. It doesn't say anything about helpfulness. The expectedFacts could include "shards" (not "4 shards") so helpfulness might still be okay, but faithfulness catches the quantity mismatch.

Actually, let me just make expectedFacts be ["Shadow Lord", "shards"] so helpfulness can still pass, and the faithfulness judge catches "5 shards" vs source "4 shards".

Wait, but if I use `runEval`, it runs the full pipeline. Let me just focus on what each test asserts:

Test 1: `finalScore < PASS_THRESHOLD`
Test 2: `finalScore ≥ PASS_THRESHOLD`
Test 3: `faithfulnessScore < PASS_THRESHOLD`

Now let me also think about the `runEval` signature. It takes `scenarios: Scenario[]`. So I can pass an array with a single scenario for each test.

Let me write the complete file now:

```typescript
import { describe, it, expect } from "vitest";
import { runEval, PASS_THRESHOLD } from "../src/eval/harness.js";
import { ScriptedLLMClient } from "../src/llm-client.js";
import type { Scenario } from "../src/eval/scenarios.js";
import type { Source } from "../src/sources.js";

const source: Source = {
  id: "cave",
  title: "Crystal Cave",
  text: "The Crystal Cave is guarded by the Shadow Lord. You need 4 shards to open the gate in the cave.",
};

describe("eval harness", () => {
  it("scores a confident-lie answer below the pass threshold", async () => {
    const scenario: Scenario = {
      id: "lie",
      question: "How do I open the gate in the Crystal Cave?",
      sources: [source],
      expectedFacts: ["Shadow Lord", "shards"],
      plantedFalseFacts: ["Phoenix Feather"],
    };

    const llm = new ScriptedLLMClient([
      "The Crystal Cave is guarded by the Shadow Lord. You need 4 shards and a Phoenix Feather to open the gate in the cave.",
    ]);

    const results = await runEval([scenario], llm);
    expect(results[0].finalScore).toBeLessThan(PASS_THRESHOLD);
  });

  it("scores a correct grounded answer at or above the pass threshold", async () => {
    const scenario: Scenario = {
      id: "correct",
      question: "How do I open the gate in the Crystal Cave?",
      sources: [source],
      expectedFacts: ["Shadow Lord", "4 shards"],
      plantedFalseFacts: ["Phoenix Feather"],
    };

    const llm = new ScriptedLLMClient([
      "The Crystal Cave is guarded by the Shadow Lord. You need 4 shards to open the gate in the cave.",
    ]);

    const results = await runEval([scenario], llm);
    expect(results[0].finalScore).toBeGreaterThanOrEqual(PASS_THRESHOLD);
  });

  it("catches a quantity mismatch exactly", async () => {
    const scenario: Scenario = {
      id: "quantity-error",
      question: "How many shards do I need?",
      sources: [source],
      expectedFacts: ["Shadow Lord", "shards"],
      plantedFalseFacts: [],
    };

    const llm = new ScriptedLLMClient([
      "The Crystal Cave is guarded by the Shadow Lord. You need 5 shards to open the gate in the cave.",
    ]);

    const results = await runEval([scenario], llm);
    expect(results[0].faithfulnessScore).toBeLessThan(PASS_THRESHOLD);
  });
});
```

Wait, I need to double-check the import paths. The project uses ESM with `"type": "module"`. In the plan, the files are:
- `src/eval/harness.ts`
- `src/llm-client.ts`
- `src/eval/scenarios.ts`
- `src/sources.ts`

From `test/eval.test.ts`, the relative paths would be:
- `../src/eval/harness.js`
- `../src/llm-client.js`
- `../src/eval/scenarios.js`
- `../src/sources.js`

That looks correct for ESM.

Now let me verify the bigram overlap calculation for test 1 more carefully:

Source text: "The Crystal Cave is guarded by the Shadow Lord. You need 4 shards to open the gate in the cave."

I'll extract content words (lowercase, probably excluding stopwords). Actually, I don't know the exact implementation of `gateSentences` - it's in `src/grounding.ts` which I don't have. But the plan says "content-word bigrams" and ≥ 70% overlap.

Let me be more careful. The plan says:
> a sentence is grounded if ≥ 70 % of its content-word bigrams appear in at least one source

So for the sentence "You need 4 shards and a Phoenix Feather to open the gate in the cave":
Content words (excluding "you", "a", "the", "in"): need, 4, shards, and, phoenix, feather, to, open, gate, cave
Hmm, actually I don't know exactly which words are "content words" in the implementation. Some implementations include numbers as content words, some don't.

This is getting tricky because I can't see the actual implementation of `gateSentences`. Let me think about what's safe.

For test 2 (correct answer), the LLM response is identical to the source text, so all bigrams will match → 100% overlap → definitely passes.

For test 3 (quantity error), the LLM response differs from the source only in "5" vs "4". If numbers are content words, the bigram "need 5" won't match "need 4", and "5 shards" won't match "4 shards". But "shards to", "to open", etc. will still match. Let's count:

Sentence: "You need 5 shards to open the gate in the cave."
Content-word bigrams (assuming all words except "you", "a", "the", "in" are content): need-5, 5-shards, shards-to, to-open, open-gate, gate-cave (or open-the, the-gate, gate-in, in-the, the-cave depending on how they handle function words)

This is getting too speculative. Let me just make the tests work by ensuring the LLM responses are close enough to the source that they'll pass the gate. For test 2, exact match guarantees it. For tests 1 and 3, the responses are very close to the source with only small modifications.

Actually, I realize I should think about this differently. The test needs to PASS, meaning:
- Test 1: The lie sentence must pass the gate (so it appears in the output) AND the faithfulness judge must catch the false fact.
- Test 3: The quantity-error sentence must pass the gate AND the faithfulness judge must catch the mismatch.

If the sentence doesn't pass the gate, it gets dropped, and the answer would be just the first grounded sentence. Then:
- For test 1: "Phoenix Feather" wouldn't be in the answer, faithfulness would score high, and the test would FAIL.
- For test 3: "5 shards" wouldn't be in the answer, faithfulness would score high, and the test would FAIL.

So I need to ensure these sentences pass the gate. The safest approach is to make them very similar to the source text with minimal deviation.

Let me reconsider. Maybe I should make the planted false fact appear in a way that maximizes bigram overlap. Or maybe I should just trust that with 70% threshold and a sentence that's 90%+ similar to source, it'll pass.

For test 1: "You need 4 shards and a Phoenix Feather to open the gate in the cave."
vs source: "You need 4 shards to open the gate in the cave."

The only additions are "and a Phoenix Feather". Most bigrams will still match. I think this will pass.

For test 3: "You need 5 shards to open the gate in the cave."
vs source: "You need 4 shards to open the gate in the cave."

Only difference is "5" vs "4". If numbers are tokenized as separate tokens, then "need 5" ≠ "need 4" and "5 shards" ≠ "4 shards". But all other bigrams match. If we have ~8-10 bigrams total and 2 don't match, that's ~75-80% overlap. Should pass at 70%.

I'll go with my current design. Let me finalize the file.

Actually wait - I just realized something. Let me re-read the error:

```
test/eval.test.ts(38,1): error TS1005: '}' expected.
```

This is a syntax error - a missing closing brace at line 38. The original file had a structural issue. My rewrite fixes this by being syntactically correct.

Let me also make sure I'm not importing anything that doesn't exist. Looking at the plan:
- `src/eval/harness.ts` exports `runEval`, `PASS_THRESHOLD`, `EvalResult`
- `src/llm-client.ts` exports `LLMClient`, `ScriptedLLMClient`
- `src/eval/scenarios.ts` exports `Scenario`, `GOLDEN_SCENARIOS`
- `src/sources.ts` exports `Source`

I only need: `runEval`, `PASS_THRESHOLD`, `ScriptedLLMClient`, `Scenario` (type), `Source` (type).

This looks good. Let me write the final version.
```

## reply

```typescript
import { describe, it, expect } from "vitest";
import { runEval, PASS_THRESHOLD } from "../src/eval/harness.js";
import { ScriptedLLMClient } from "../src/llm-client.js";
import type { Scenario } from "../src/eval/scenarios.js";
import type { Source } from "../src/sources.js";

const source: Source = {
  id: "cave",
  title: "Crystal Cave",
  text: "The Crystal Cave is guarded by the Shadow Lord. You need 4 shards to open the gate in the cave.",
};

describe("eval harness", () => {
  it("scores a confident-lie answer below the pass threshold", async () => {
    const scenario: Scenario = {
      id: "lie",
      question: "How do I open the gate in the Crystal Cave?",
      sources: [source],
      expectedFacts: ["Shadow Lord", "shards"],
      plantedFalseFacts: ["Phoenix Feather"],
    };

    const llm = new ScriptedLLMClient([
      "The Crystal Cave is guarded by the Shadow Lord. You need 4 shards and a Phoenix Feather to open the gate in the cave.",
    ]);

    const results = await runEval([scenario], llm);
    expect(results[0].finalScore).toBeLessThan(PASS_THRESHOLD);
  });

  it("scores a correct grounded answer at or above the pass threshold", async () => {
    const scenario: Scenario = {
      id: "correct",
      question: "How do I open the gate in the Crystal Cave?",
      sources: [source],
      expectedFacts: ["Shadow Lord", "4 shards"],
      plantedFalseFacts: ["Phoenix Feather"],
    };

    const llm = new ScriptedLLMClient([
      "The Crystal Cave is guarded by the Shadow Lord. You need 4 shards to open the gate in the cave.",
    ]);

    const results = await runEval([scenario], llm);
    expect(results[0].finalScore).toBeGreaterThanOrEqual(PASS_THRESHOLD);
  });

  it("catches a quantity mismatch exactly", async () => {
    const scenario: Scenario = {
      id: "quantity-error",
      question: "How many shards do I need?",
      sources: [source],
      expectedFacts: ["Shadow Lord", "shards"],
      plantedFalseFacts: [],
    };

    const llm = new ScriptedLLMClient([
      "The Crystal Cave is guarded by the Shadow Lord. You need 5 shards to open the gate in the cave.",
    ]);

    const results = await runEval([scenario], llm);
    expect(results[0].faithfulnessScore).toBeLessThan(PASS_THRESHOLD);
  });
});
```
