import { describe, it, expect } from "vitest";
import { answer } from "../src/answer.js";
import type { Source } from "../src/sources.js";
import { ScriptedLLMClient } from "../src/llm-client.js";
import type { RedactionConfig } from "../src/redaction.js";

const dragonSource: Source = {
  id: "src-1",
  title: "Dragon Lord",
  text: "The Dragon Lord guards the Ember Sanctum.",
};

const gateSource: Source = {
  id: "src-2",
  title: "The Gate",
  text: "The gate requires 4 shards plus 6 keys.",
};

describe("answer", () => {
  it("refuses when no sentence is grounded", async () => {
    const llm = new ScriptedLLMClient([
      "You must bring a golden harp to the crystal cave and sing the ancient song.",
    ]);

    const result = await answer(
      {
        question: "How do I pass the checkpoint?",
        sources: [dragonSource],
        mode: "full",
      },
      llm,
    );

    expect(result.refused).toBe(true);
    expect(result.text).toBe("not covered by my sources");
  });

  it("refuses when sources array is empty", async () => {
    const llm = new ScriptedLLMClient(["The answer is forty-two."]);

    const result = await answer(
      {
        question: "What is the meaning of life?",
        sources: [],
        mode: "full",
      },
      llm,
    );

    expect(result.refused).toBe(true);
    expect(result.text).toBe("not covered by my sources");
  });

  it("full mode returns grounded sentences verbatim", async () => {
    const source: Source = {
      id: "src-full",
      title: "Guide",
      text: "The Dragon Lord guards the Ember Sanctum. The gate requires 4 shards plus 6 keys.",
    };
    const llm = new ScriptedLLMClient([
      "The Dragon Lord guards the Ember Sanctum. The gate requires 4 shards plus 6 keys.",
    ]);

    const result = await answer(
      { question: "What do I need?", sources: [source], mode: "full" },
      llm,
    );

    expect(result.refused).toBe(false);
    expect(result.text).toContain("Dragon Lord");
    expect(result.text).toContain("Ember Sanctum");
    expect(result.text).toContain("4 shards");
  });

  it("ungrounded sentences are dropped from output", async () => {
    const llm = new ScriptedLLMClient([
      "The Dragon Lord guards the Ember Sanctum. You must bring a golden harp to the crystal cave.",
    ]);

    const result = await answer(
      {
        question: "Who guards the sanctum?",
        sources: [dragonSource],
        mode: "full",
      },
      llm,
    );

    expect(result.refused).toBe(false);
    expect(result.text).toContain("Dragon Lord");
    expect(result.text).not.toContain("golden harp");
    expect(result.text).not.toContain("crystal cave");
  });

  it("hint mode redacts boss names from the grounded answer", async () => {
    const llm = new ScriptedLLMClient(["The Dragon Lord guards the Ember Sanctum."]);
    const config: RedactionConfig = { bossNames: ["Dragon Lord"] };

    const result = await answer(
      {
        question: "Who guards the sanctum?",
        sources: [dragonSource],
        mode: "hint",
      },
      llm,
      config,
    );

    expect(result.refused).toBe(false);
    expect(result.text).not.toMatch(/dragon lord/i);
    expect(result.text).toContain("[REDACTED]");
  });

  it("hint mode clamps quantities to those in the question", async () => {
    const llm = new ScriptedLLMClient(["The gate requires 4 shards plus 6 keys."]);

    // 4 is in the question → preserved; 6 is not → redacted
    const resultWith4 = await answer(
      {
        question: "I have 4 shards, do I need more?",
        sources: [gateSource],
        mode: "hint",
      },
      new ScriptedLLMClient(["The gate requires 4 shards plus 6 keys."]),
    );
    expect(resultWith4.text).toContain("4");
    expect(resultWith4.text).not.toContain("6");

    // Neither 4 nor 6 is in the question → both redacted
    const resultNoMatch = await answer(
      {
        question: "How many items do I need?",
        sources: [gateSource],
        mode: "hint",
      },
      new ScriptedLLMClient(["The gate requires 4 shards plus 6 keys."]),
    );
    expect(resultNoMatch.text).not.toContain("4");
    expect(resultNoMatch.text).not.toContain("6");
  });

  it("hint mode strips location prepositional phrases", async () => {
    const source: Source = {
      id: "src-loc",
      title: "Key Location",
      text: "The key is in Ember Sanctum. The gate requires 4 shards plus 6 keys.",
    };
    const llm = new ScriptedLLMClient(["The key is in Ember Sanctum."]);

    const result = await answer(
      { question: "Where is the key?", sources: [source], mode: "hint" },
      llm,
    );

    expect(result.refused).toBe(false);
    expect(result.text).not.toMatch(/in Ember Sanctum/i);
    expect(result.text).toContain("[REDACTED]");
  });

  it("hint mode does not call the LLM a second time", async () => {
    const config: RedactionConfig = { bossNames: ["Dragon Lord"] };
    // Only one reply available; a second call would throw "exhausted"
    const llm = new ScriptedLLMClient(["The Dragon Lord guards the Ember Sanctum."]);

    const result = await answer(
      {
        question: "Who guards the sanctum?",
        sources: [dragonSource],
        mode: "hint",
      },
      llm,
      config,
    );

    expect(result.refused).toBe(false);
    expect(result.text).toContain("[REDACTED]");
  });

  it("groundedSentences field is populated even on refusal", async () => {
    const llm = new ScriptedLLMClient([
      "You must bring a golden harp to the crystal cave and sing the ancient song.",
    ]);

    const result = await answer(
      {
        question: "How do I pass the checkpoint?",
        sources: [dragonSource],
        mode: "full",
      },
      llm,
    );

    expect(result.refused).toBe(true);
    expect(result.groundedSentences.length).toBeGreaterThan(0);
    for (const s of result.groundedSentences) {
      expect(s.grounded).toBe(false);
    }
  });

  it("ScriptedLLMClient exhaustion propagates as an error", async () => {
    const llm = new ScriptedLLMClient([]);

    await expect(
      answer(
        {
          question: "Anything?",
          sources: [dragonSource],
          mode: "full",
        },
        llm,
      ),
    ).rejects.toThrow("ScriptedLLMClient exhausted");
  });

  it("boundary: single sentence that is fully grounded passes", async () => {
    const source: Source = {
      id: "src-boundary",
      title: "Realm",
      text: "crystal ember sanctum gate shard quest realm forge blade iron anchor",
    };
    const llm = new ScriptedLLMClient([
      "crystal ember sanctum gate shard quest realm forge blade iron anchor.",
    ]);

    const result = await answer(
      { question: "Tell me about the realm.", sources: [source], mode: "full" },
      llm,
    );

    expect(result.refused).toBe(false);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("boundary: sentence at exactly the 0.7 threshold", async () => {
    // Source has bigrams: (crystal,ember),(ember,sanctum),(sanctum,gate),(gate,shard),
    // (shard,quest),(quest,realm),(realm,forge),(forge,blade),(blade,iron) = 9
    // Sentence has bigrams: (crystal,ember),(ember,sanctum),(sanctum,gate),(gate,shard),
    // (shard,quest),(quest,realm),(realm,forge),(forge,iron),(iron,blade),(blade,anchor) = 10
    // Matched: 7 of 10 → exactly 0.7
    const source: Source = {
      id: "src-threshold",
      title: "Threshold",
      text: "crystal ember sanctum gate shard quest realm forge blade iron",
    };
    const llm = new ScriptedLLMClient([
      "crystal ember sanctum gate shard quest realm forge iron blade anchor.",
    ]);

    const result = await answer(
      { question: "Describe the path.", sources: [source], mode: "full" },
      llm,
    );

    expect(result.refused).toBe(false);
    expect(result.text.length).toBeGreaterThan(0);
  });
});
