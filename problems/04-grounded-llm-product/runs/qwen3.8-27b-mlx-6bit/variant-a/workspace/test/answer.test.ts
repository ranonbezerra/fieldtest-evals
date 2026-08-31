import { describe, it, expect } from "vitest";
import { answer, GroundingError } from "../src/answer.js";
import { ScriptedLlm } from "../src/fake-llm.js";
import { judgeFaithfulness, judgeHelpfulness } from "../src/eval.js";

describe("answer", () => {
  it("scores high for a correct grounded answer", async () => {
    const sources = [
      "The Ember Gate requires 4 shards to open. The shards are found in the Caverns of Ash.",
    ];
    const question = "How many shards do I need for the Ember Gate?";
    const llm = new ScriptedLlm(
      new Map([
        [
          question,
          "The Ember Gate requires 4 shards to open. The shards are found in the Caverns of Ash.",
        ],
      ])
    );

    const result = await answer(
      { question, sources, mode: "full" },
      llm
    );

    expect(result.refused).toBe(false);
    const helpfulness = judgeHelpfulness(
      result.text,
      ["4 shards", "Caverns of Ash"]
    );
    const faithfulness = judgeFaithfulness(result.text, sources, []);
    expect(helpfulness).toBe(1);
    expect(faithfulness).toBe(1);
    expect(Math.min(helpfulness, faithfulness)).toBe(1);
  });

  it("scores low for a confident lie containing an invented item requirement", async () => {
    const sources = [
      "The Ember Gate requires 4 shards to open. The shards are found in the Caverns of Ash.",
    ];
    const question = "What do I need to open the Ember Gate?";
    const llm = new ScriptedLlm(
      new Map([
        [
          question,
          "The Ember Gate requires a Moonstone Key to open. The Moonstone Key is forged in the Forge of Dawn.",
        ],
      ])
    );

    const result = await answer(
      { question, sources, mode: "full" },
      llm
    );

    const faithfulness = judgeFaithfulness(
      result.text,
      sources,
      ["Moonstone Key"]
    );
    expect(faithfulness).toBe(0);
    expect(Math.min(1, faithfulness)).toBe(0);
  });

  it("refuses when the sources do not contain the answer", async () => {
    const sources = ["The village market sells bread and cheese."];
    const question = "How do I defeat the final boss?";
    const llm = new ScriptedLlm(
      new Map([
        [
          question,
          "The final boss is defeated by using the Blade of Eternity in the Crystal Spire.",
        ],
      ])
    );

    const result = await answer(
      { question, sources, mode: "full" },
      llm
    );

    expect(result.refused).toBe(true);
    expect(result.text).toBe("not covered by my sources");
  });

  it("catches quantity errors exactly (5 shards vs 4 in sources)", async () => {
    const sources = [
      "The Ember Gate requires 4 shards to open.",
    ];
    const question = "How many shards for the Ember Gate?";
    const llm = new ScriptedLlm(
      new Map([
        [
          question,
          "The Ember Gate requires 5 shards to open.",
        ],
      ])
    );

    const result = await answer(
      { question, sources, mode: "full" },
      llm
    );

    const faithfulness = judgeFaithfulness(
      result.text,
      sources,
      ["5 shards"]
    );
    expect(faithfulness).toBe(0);
  });

  it("raises GroundingError when sources are empty", async () => {
    const llm = new ScriptedLlm(new Map());

    await expect(
      answer({ question: "anything", sources: [], mode: "full" }, llm)
    ).rejects.toThrow(GroundingError);
  });

  it("derives hint mode from the grounded answer without re-prompting", async () => {
    const sources = [
      "The Ember Gate requires 4 shards to open. The shards are found in the Caverns of Ash.",
    ];
    const question = "How many shards do I need for the Ember Gate?";
    const llm = new ScriptedLlm(
      new Map([
        [
          question,
          "The Ember Gate requires 4 shards to open. The shards are found in the Caverns of Ash.",
        ],
      ])
    );

    const result = await answer(
      { question, sources, mode: "hint" },
      llm,
      {
        redactTokens: ["caverns", "of", "ash"],
        playerMentioned: ["shards", "4"],
      }
    );

    expect(result.refused).toBe(false);
    expect(result.text).not.toContain("Caverns");
    expect(result.text).not.toContain("Ash");
    expect(result.text).toContain("4");
  });
});
