# repair2-scenarios.ts

## reasoning

```
The error message for `src/eval/scenarios.ts` is:

```
src/eval/scenarios.ts(1,24): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../sources.js'?
```

This means line 1, column 24 of `src/eval/scenarios.ts` has an import from `../sources` that needs to be `../sources.js`.

Looking at the plan, `src/eval/scenarios.ts` should:
- Import `Source` from `../sources`
- Export the `Scenario` interface
- Export `GOLDEN_SCENARIOS` with at minimum: one correct scenario, one confident-lie scenario, one no-source scenario

The fix is simply changing the import from `../sources` to `../sources.js`.

Let me write the complete file with the correct import extension and the required exports per the plan.

From the plan:
```ts
export interface Scenario {
  id: string;
  question: string;
  sources: Source[];
  expectedFacts: string[];      // substrings the answer MUST contain
  plantedFalseFacts: string[];  // substrings the answer must NOT contain (invented/incorrect)
}

export declare const GOLDEN_SCENARIOS: Scenario[];
```

And the plan says "At minimum: one correct scenario, one confident-lie scenario, one no-source scenario."

I need to provide actual fixture data. Let me create reasonable game-related fixtures.

For the correct scenario:
- A question about a game mechanic
- Sources that contain the answer
- Expected facts that appear in the sources
- No planted false facts (or empty array)

For the confident-lie scenario:
- Same or similar question/sources
- The LLM would return something with a planted false fact
- The plantedFalseFacts array contains the invented claim

For the no-source scenario:
- A question whose answer is NOT in the provided sources
- Sources that don't contain the relevant info

Let me think about what makes sense for the tests:

Test 1 (eval.test.ts): A scripted LLM that returns a confident-lie (contains a planted false fact) yields `finalScore < PASS_THRESHOLD`.
Test 2 (eval.test.ts): A scripted LLM that returns a correct grounded answer (all expected facts, no false facts) yields `finalScore ≥ PASS_THRESHOLD`.
Test 3 (answer.test.ts): When sources do not contain the answer, `answer()` returns `refused: true`.
Test 4 (eval.test.ts): A scripted LLM that says "5 shards" while the source says "4 shards" causes `faithfulnessScore < PASS_THRESHOLD`.

So I need scenarios that support these tests. Let me design them:

1. "correct" scenario - question about how to defeat a boss, sources contain the answer with expected facts
2. "confident-lie" scenario - same setup but the plantedFalseFacts contains an invented item requirement
3. "no-source" scenario - question about something not covered in the sources
4. Maybe a "quantity-error" scenario for test 4 - source says "4 shards" but the LLM would say "5 shards"

Wait, looking more carefully at the tests:
- Test 4 says "A scripted LLM that says '5 shards' while the source says '4 shards'" - this means the scenario's sources contain "4 shards" and the expected facts might include "4 shards", while plantedFalseFacts might include "5 shards". The faithfulnessJudge checks quantity consistency against sources.

Actually, re-reading the faithfulnessJudge: "Checks that no plantedFalseFact appears in answer, AND that every quantity claim in answer is consistent with sources."

So the faithfulness judge independently checks quantities against sources. The plantedFalseFacts are additional substrings that must not appear.

Let me design the scenarios:

Scenario 1 (id: "correct"):
- question: "How do I defeat the Shadow Warden?"
- sources: A wiki page saying "The Shadow Warden can be defeated by using 4 Frost Shards to weaken its armor. Approach from the north corridor."
- expectedFacts: ["4 Frost Shards", "north corridor"]
- plantedFalseFacts: []

Scenario 2 (id: "confident-lie"):
- question: "How do I defeat the Shadow Warden?"
- sources: Same as above
- expectedFacts: ["4 Frost Shards", "north corridor"]
- plantedFalseFacts: ["5 Ember Orbs"]  // an invented item requirement

Scenario 3 (id: "no-source"):
- question: "How do I craft a Dragon Scale?"
- sources: The Shadow Warden page (which doesn't mention Dragon Scales)
- expectedFacts: ["Dragon Scale"]
- plantedFalseFacts: []

Scenario 4 (id: "quantity-error"):
- question: "How many Frost Shards do I need?"
- sources: A page saying "You need 4 Frost Shards"
- expectedFacts: ["4 Frost Shards"]
- plantedFalseFacts: ["5 shards"]

Wait, but the tests use scripted LLMs. The scenarios define the inputs (question + sources) and the expected/planted facts. The LLM response is provided by the test via ScriptedLLMClient. So the scenarios just need to have the right sources and fact lists.

Let me finalize. I'll keep it simple and aligned with what the tests need.
```

## reply

```ts
import type { Source } from "../sources.js";

export interface Scenario {
  id: string;
  question: string;
  sources: Source[];
  expectedFacts: string[];
  plantedFalseFacts: string[];
}

const shadowWardenSource: Source = {
  id: "src-shadow-warden",
  title: "Shadow Warden",
  text: "The Shadow Warden guards the Obsidian Keep. To defeat it, you must weaken its armor using 4 Frost Shards obtained from the Frozen Cavern. Approach from the north corridor to avoid its sweeping attack pattern.",
};

const dragonScaleSource: Source = {
  id: "src-dragon-scale",
  title: "Dragon Scale",
  text: "A Dragon Scale is a rare crafting material dropped by the Ember Drake in the Volcanic Depths. It requires Level 12 to equip.",
};

export const GOLDEN_SCENARIOS: Scenario[] = [
  {
    id: "correct",
    question: "How do I defeat the Shadow Warden?",
    sources: [shadowWardenSource],
    expectedFacts: ["4 Frost Shards", "north corridor"],
    plantedFalseFacts: [],
  },
  {
    id: "confident-lie",
    question: "How do I defeat the Shadow Warden?",
    sources: [shadowWardenSource],
    expectedFacts: ["4 Frost Shards", "north corridor"],
    plantedFalseFacts: ["5 Ember Orbs"],
  },
  {
    id: "no-source",
    question: "How do I defeat the Shadow Warden?",
    sources: [dragonScaleSource],
    expectedFacts: ["4 Frost Shards", "north corridor"],
    plantedFalseFacts: [],
  },
  {
    id: "quantity-error",
    question: "How many Frost Shards do I need to weaken the Shadow Warden?",
    sources: [shadowWardenSource],
    expectedFacts: ["4 Frost Shards"],
    plantedFalseFacts: ["5 shards"],
  },
];
```
