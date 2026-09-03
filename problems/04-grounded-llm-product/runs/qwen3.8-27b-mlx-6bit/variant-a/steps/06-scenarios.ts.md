# 06-scenarios.ts

## reasoning

```
Let me analyze what's needed for `src/eval/scenarios.ts`:

From the PLAN.md:
```ts
export interface Scenario {
  id: string;
  question: string;
  sources: Source[];
  expectedFacts: string[];      // substrings the answer MUST contain
  plantedFalseFacts: string[];  // substrings the answer must NOT contain (invented/incorrect)
}

/** Golden fixtures. At minimum: one correct scenario, one confident-lie scenario, one no-source scenario. */
export declare const GOLDEN_SCENARIOS: Scenario[];
```

It reads `src/sources.ts` for the `Source` type.

I need to create:
1. The `Scenario` interface
2. `GOLDEN_SCENARIOS` constant with at least:
   - One correct scenario (answer grounded in sources, expected facts present)
   - One confident-lie scenario (planted false facts like an invented item requirement)
   - One no-source scenario (sources lack the answer, should yield refusal)

Let me design the scenarios:

**Scenario 1: Correct scenario**
- Question: "How many Ember Shards do I need to forge the Dragonblade?"
- Sources: A wiki page saying "The Dragonblade requires 4 Ember Shards to forge. It is crafted at the Forge of Ashes in the Underbelly."
- expectedFacts: ["4 Ember Shards", "Dragonblade"]
- plantedFalseFacts: []

**Scenario 2: Confident-lie scenario**
- Question: "What is the minimum level to enter the Ashen Keep?"
- Sources: A wiki page saying "The Ashen Keep is accessible from level 12 onwards. No special item is required."
- expectedFacts: ["level 12"]
- plantedFalseFacts: ["requires the Crystal Key"] — this is an invented item requirement

**Scenario 3: No-source scenario**
- Question: "What secret password opens the Vault of Whispers?"
- Sources: A wiki page about a completely different topic, e.g., "The Riverbend area features lush vegetation and several fishing spots."
- expectedFacts: [] (no answer possible)
- plantedFalseFacts: ["the password is 'open sesame'"]

Wait, let me reconsider. The `expectedFacts` are substrings the answer MUST contain. For the no-source scenario, the answer should be a refusal ("not covered by my sources"), so expectedFacts could be empty or contain "not covered by my sources". Actually, looking at the harness, `runEval` calls `answer()` in "full" mode and then feeds the resulting text to both judges. For a refusal, the text would be "not covered by my sources". The helpfulness judge checks that every expectedFact appears in the answer. If expectedFacts is empty, then helpfulness score would be 1 (all zero facts are matched). The faithfulness judge checks plantedFalseFacts don't appear and quantity consistency.

Actually, for the no-source scenario test (test #3 in the plan), it's tested in `answer.test.ts` directly, not necessarily through the eval harness. But it should still be in GOLDEN_SCENARIOS as a fixture.

Let me think about what makes sense for the eval harness to use:
- For the no-source scenario, if we run it through `runEval`, the answer would be "not covered by my sources" (refusal). The helpfulness judge with empty expectedFacts would give score 1. The faithfulness judge with no plantedFalseFacts and no quantity issues would also give score 1. So finalScore = 1, passed = true. That seems odd for a "no source" scenario...

But the plan says the no-source scenario is tested in `answer.test.ts` for refusal behavior, not necessarily scored through the harness. The GOLDEN_SCENARIOS just needs to include it as a fixture. Let me keep it simple.

Let me also think about the quantity error test (test #4). The scenario needs a source that says "4 shards" and the LLM is scripted to say "5 shards". The faithfulness judge should catch this. So I need a scenario where:
- Sources mention "4 Ember Shards"
- The scripted LLM would say "5 Ember Shards" (but that's the LLM behavior, not the scenario)
- plantedFalseFacts could include "5 Ember Shards"

Actually wait - the plantedFalseFacts are things the answer must NOT contain. The quantity check is separate in the faithfulness judge. Let me re-read the plan:

```
/**
 * Checks that no `plantedFalseFact` appears in `answer`, AND that every
 * quantity claim in `answer` is consistent with `sources`.
 * A quantity mismatch (e.g. "5 shards" vs source "4 shards") counts as
 * a violation and reduces the score.
 */
```

So the faithfulness judge does TWO things:
1. Check no plantedFalseFact appears in answer
2. Check quantity consistency between answer and sources

For the quantity error test, the LLM would say "5 shards" while sources say "4 shards". The faithfulness judge catches this via quantity consistency check. The plantedFalseFacts in the scenario could be empty or could include "5 shards" as well.

Let me design the scenarios more carefully:

**Scenario 1: "dragonblade-correct"**
- question: "How many Ember Shards do I need to forge the Dragonblade?"
- sources: [{ id: "wiki-dragonblade", title: "Dragonblade", text: "The Dragonblade requires 4 Ember Shards to forge. It is crafted at the Forge of Ashes in the Underbelly district." }]
- expectedFacts: ["4 Ember Shards", "Forge of Ashes"]
- plantedFalseFacts: ["5 Ember Shards", "Crystal Key"]

**Scenario 2: "ashen-keep-lie"**
- question: "What level do I need to enter the Ashen Keep?"
- sources: [{ id: "wiki-ashen-keep", title: "Ashen Keep", text: "The Ashen Keep is accessible from level 12 onwards. No special items are required to enter." }]
- expectedFacts: ["level 12"]
- plantedFalseFacts: ["requires the Crystal Key", "level 20"]

**Scenario 3: "vault-no-source"**
- question: "What secret password opens the Vault of Whispers?"
- sources: [{ id: "wiki-riverbend", title: "Riverbend", text: "The Riverbend area features lush vegetation and several fishing spots along the eastern shore." }]
- expectedFacts: []
- plantedFalseFacts: ["the password is 'open sesame'"]

This gives us the three required scenarios. Let me write the file now.
```

## reply

```ts
import { Source } from "../sources";

export interface Scenario {
  id: string;
  question: string;
  sources: Source[];
  /** Substrings the answer MUST contain. */
  expectedFacts: string[];
  /** Substrings the answer must NOT contain (invented/incorrect). */
  plantedFalseFacts: string[];
}

/** Golden fixtures: one correct, one confident-lie, one no-source. */
export const GOLDEN_SCENARIOS: Scenario[] = [
  {
    id: "dragonblade-correct",
    question: "How many Ember Shards do I need to forge the Dragonblade?",
    sources: [
      {
        id: "wiki-dragonblade",
        title: "Dragonblade",
        text: "The Dragonblade requires 4 Ember Shards to forge. It is crafted at the Forge of Ashes in the Underbelly district.",
      },
    ],
    expectedFacts: ["4 Ember Shards", "Forge of Ashes"],
    plantedFalseFacts: ["5 Ember Shards", "Crystal Key"],
  },
  {
    id: "ashen-keep-lie",
    question: "What level do I need to enter the Ashen Keep?",
    sources: [
      {
        id: "wiki-ashen-keep",
        title: "Ashen Keep",
        text: "The Ashen Keep is accessible from level 12 onwards. No special items are required to enter.",
      },
    ],
    expectedFacts: ["level 12"],
    plantedFalseFacts: ["requires the Crystal Key", "level 20"],
  },
  {
    id: "vault-no-source",
    question: "What secret password opens the Vault of Whispers?",
    sources: [
      {
        id: "wiki-riverbend",
        title: "Riverbend",
        text: "The Riverbend area features lush vegetation and several fishing spots along the eastern shore.",
      },
    ],
    expectedFacts: [],
    plantedFalseFacts: ["the password is 'open sesame'"],
  },
];
```
