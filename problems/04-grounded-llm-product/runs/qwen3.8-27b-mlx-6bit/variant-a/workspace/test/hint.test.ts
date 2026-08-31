import { describe, expect, it } from "vitest";
import { redactToHint } from "../src/hint.js";
import type { GroundedAnswer } from "../src/grounding.js";

describe("redactToHint", () => {
  it("removes boss names and item locations from a grounded answer", () => {
    const grounded: GroundedAnswer = {
      text: "Gorgon guards the crypt. The crypt holds the key.",
      sentences: ["Gorgon guards the crypt.", "The crypt holds the key."],
      refused: false,
    };

    const result = redactToHint(grounded, {
      redactTokens: ["gorgon", "crypt"],
      playerMentioned: [],
    });

    expect(result).toBe("[REDACTED] guards the [REDACTED]. The [REDACTED] holds the key.");
  });

  it("removes digit quantities not mentioned by the player", () => {
    const grounded: GroundedAnswer = {
      text: "You need 4 shards.",
      sentences: ["You need 4 shards."],
      refused: false,
    };

    const result = redactToHint(grounded, {
      redactTokens: [],
      playerMentioned: [],
    });

    expect(result).toBe("You need [REDACTED] shards.");
  });

  it("preserves a quantity the player already mentioned in the question", () => {
    const grounded: GroundedAnswer = {
      text: "You need 4 shards.",
      sentences: ["You need 4 shards."],
      refused: false,
    };

    const result = redactToHint(grounded, {
      redactTokens: [],
      playerMentioned: ["4"],
    });

    expect(result).toBe("You need 4 shards.");
  });
});
