import { describe, expect, it } from "vitest";
import { judgeFaithfulness, judgeHelpfulness } from "../src/eval.js";

describe("judgeHelpfulness", () => {
  it("returns 1 when all expected facts are present after normalization", () => {
    const answerText = "The Dragon Gate requires 4 shards. The vault holds 5 keys.";
    const expectedFacts = [
      "dragon gate requires 4 SHARDS",
      "vault holds 5 KEYS",
    ];

    expect(judgeHelpfulness(answerText, expectedFacts)).toBe(1);
  });

  it("returns a fraction when only some expected facts are present", () => {
    const answerText = "The Dragon Gate requires 4 shards.";
    const expectedFacts = [
      "dragon gate requires 4 shards",
      "vault holds 5 keys",
    ];

    expect(judgeHelpfulness(answerText, expectedFacts)).toBe(0.5);
  });
});

describe("judgeFaithfulness", () => {
  it("returns 1 when every sentence is grounded and no planted-false fact appears", () => {
    const sources = [
      "The dragon gate requires 4 shards.",
      "The vault holds 5 keys.",
    ];
    const answerText = "The dragon gate requires 4 shards. The vault holds 5 keys.";
    const plantedFalseFacts = ["The dragon gate requires 5 shards."];

    expect(judgeFaithfulness(answerText, sources, plantedFalseFacts)).toBe(1);
  });

  it("returns 0 when a planted-false fact string appears in the answer", () => {
    const sources = [
      "The dragon gate requires 4 shards.",
      "The vault holds 5 keys.",
    ];
    const answerText = "The dragon gate requires 5 shards.";
    const plantedFalseFacts = ["The dragon gate requires 5 shards."];

    expect(judgeFaithfulness(answerText, sources, plantedFalseFacts)).toBe(0);
  });
});
