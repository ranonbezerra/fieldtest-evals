import type { Scenario } from "./eval-harness.js";

/** Golden scenario: the LLM mixes lies with truth; grounding drops the lies. */
export const SCENARIO_CONFIDENT_LIE: Scenario = {
  name: "confident-lie",
  question: "How do you defeat the Dragon King?",
  sources: [
    "The Dragon King is the final boss.",
    "The Dragon King drops 4 fire shards.",
  ],
  expectedFacts: [
    "Dragon King is the final boss",
    "Dragon King drops 4 fire shards",
  ],
  plantedFalseFacts: ["5 dragon stones", "Shadow Lord"],
  llmResponse:
    "You need 5 dragon stones to fight the Shadow Lord. The Dragon King drops 4 fire shards.",
  expectedOutcome: "answered",
};

/** Golden scenario: the LLM tells the truth; everything survives grounding. */
export const SCENARIO_CORRECT: Scenario = {
  name: "correct-grounded",
  question: "How do you defeat the Dragon King?",
  sources: [
    "The Dragon King is the final boss.",
    "The Dragon King drops 4 fire shards.",
  ],
  expectedFacts: [
    "Dragon King is the final boss",
    "Dragon King drops 4 fire shards",
  ],
  plantedFalseFacts: [],
  llmResponse:
    "The Dragon King is the final boss. The Dragon King drops 4 fire shards.",
  expectedOutcome: "answered",
};

/** Golden scenario: sources do not contain the answer at all. */
export const SCENARIO_SOURCES_LACK: Scenario = {
  name: "sources-lack",
  question: "How do you obtain the Phantom Key?",
  sources: ["The Dragon King is the final boss."],
  expectedFacts: ["Phantom Key"],
  plantedFalseFacts: [],
  llmResponse:
    "The Phantom Key is hidden in the Shadow Temple behind the waterfall.",
  expectedOutcome: "refused",
};

/** Golden scenario: quantity mismatch — sources say 4, LLM says 5. */
export const SCENARIO_QUANTITY_ERROR: Scenario = {
  name: "quantity-error",
  question: "How many fire shards does the Dragon King drop?",
  sources: ["The Dragon King drops 4 fire shards."],
  expectedFacts: ["Dragon King drops 4 fire shards"],
  plantedFalseFacts: ["5 fire shards"],
  llmResponse: "The Dragon King drops 5 fire shards.",
  expectedOutcome: "refused",
};
