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
