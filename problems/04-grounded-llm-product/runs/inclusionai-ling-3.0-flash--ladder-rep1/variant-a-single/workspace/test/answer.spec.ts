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
