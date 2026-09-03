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
