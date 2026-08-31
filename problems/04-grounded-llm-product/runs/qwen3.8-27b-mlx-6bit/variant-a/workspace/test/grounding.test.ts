import { describe, expect, it } from "vitest";

import {
  GroundingError,
  groundAnswer,
  isGrounded,
  splitSentences,
  tokenSet,
} from "../src/grounding.js";

describe("splitSentences", () => {
  it("splits text on sentence-ending punctuation and trims each sentence", () => {
    expect(splitSentences("The gate opens. The key is red! What now?")).toEqual([
      "The gate opens.",
      "The key is red!",
      "What now?",
    ]);
  });

  it("keeps text without a terminator as a single sentence", () => {
    expect(splitSentences("The gate opens")).toEqual(["The gate opens"]);
  });

  it("returns an empty array for empty or whitespace-only text", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   ")).toEqual([]);
  });

  it("splits multiple sentences separated by spaces", () => {
    expect(splitSentences("Alpha beta. Gamma delta. Epsilon zeta?")).toEqual([
      "Alpha beta.",
      "Gamma delta.",
      "Epsilon zeta?",
    ]);
  });
});

describe("isGrounded", () => {
  const sourceTokens = tokenSet(
    "The ember key opens the gate. You need 4 shards."
  );

  it("returns true when every content token appears in the sources", () => {
    expect(isGrounded("The ember key opens the gate.", sourceTokens)).toBe(true);
    expect(isGrounded("You need 4 shards.", sourceTokens)).toBe(true);
  });

  it("is case-insensitive and ignores punctuation", () => {
    expect(isGrounded("The EMBER KEY, opens the gate!", sourceTokens)).toBe(true);
  });

  it("returns false when a content token is missing from the sources", () => {
    expect(isGrounded("The ember key opens the vault.", sourceTokens)).toBe(false);
  });

  it("returns false when a quantity differs from the sources", () => {
    expect(isGrounded("You need 5 shards.", sourceTokens)).toBe(false);
  });
});

describe("groundAnswer", () => {
  it("keeps grounded sentences and drops ungrounded sentences", () => {
    const sources = ["The ember key opens the gate."];
    const raw = "The ember key opens the gate. The vault needs 5 shards.";

    expect(groundAnswer(raw, sources)).toEqual({
      text: "The ember key opens the gate.",
      sentences: ["The ember key opens the gate."],
      refused: false,
    });
  });

  it("uses the union of tokens from every source", () => {
    const sources = [
      "The ember key opens the gate.",
      "You need 4 shards.",
    ];
    const raw = "The ember key opens the gate. You need 4 shards.";

    expect(groundAnswer(raw, sources)).toEqual({
      text: "The ember key opens the gate. You need 4 shards.",
      sentences: ["The ember key opens the gate.", "You need 4 shards."],
      refused: false,
    });
  });

  it("refuses when no sentence is grounded", () => {
    const sources = ["The ember key opens the gate."];
    const raw = "The vault needs 5 shards.";

    expect(groundAnswer(raw, sources)).toEqual({
      text: "not covered by my sources",
      sentences: [],
      refused: true,
    });
  });

  it("refuses when the raw answer has no sentences", () => {
    expect(groundAnswer("", ["The ember key opens the gate."])).toEqual({
      text: "not covered by my sources",
      sentences: [],
      refused: true,
    });
  });

  it("throws GroundingError when sources are empty", () => {
    let thrown: unknown;

    try {
      groundAnswer("The ember key opens the gate.", []);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GroundingError);
    expect((thrown as GroundingError).code).toBe("empty_sources");
  });
});
