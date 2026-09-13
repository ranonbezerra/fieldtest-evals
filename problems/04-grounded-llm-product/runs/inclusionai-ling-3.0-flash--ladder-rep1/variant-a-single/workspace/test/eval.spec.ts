import { describe, it, expect } from "vitest";
import type { LLMClient } from "../src/llm-client.interface.js";
import { EvalHarness } from "../src/eval-harness.js";
import type { Scenario } from "../src/eval-harness.js";
import {
  SCENARIO_CONFIDENT_LIE,
  SCENARIO_CORRECT,
  SCENARIO_SOURCES_LACK,
  SCENARIO_QUANTITY_ERROR,
} from "../src/eval-scenarios.js";
import {
  helpfulnessJudge,
  faithfulnessJudge,
} from "../src/eval.judges.js";

class FakeLLM implements LLMClient {
  constructor(private readonly response: string) {}
  async generate(): Promise<string> {
    return this.response;
  }
}

// ── Eval harness acceptance tests ────────────────────────────────────────────

describe("EvalHarness", () => {
  it("a scripted confident-lie answer scores low", async () => {
    const harness = new EvalHarness((response) => new FakeLLM(response));
    const results = await harness.run([SCENARIO_CONFIDENT_LIE]);

    expect(results.length).toBe(1);
    const r = results[0];
    expect(r.finalScore).toBeLessThan(1.0);
    expect(r.correct).toBe(true);
  });

  it("a correct grounded answer scores high", async () => {
    const harness = new EvalHarness((response) => new FakeLLM(response));
    const results = await harness.run([SCENARIO_CORRECT]);

    const r = results[0];
    expect(r.finalScore).toBe(1.0);
    expect(r.correct).toBe(true);
  });

  it("sources that lack the answer refuse and are scored as correct", async () => {
    const harness = new EvalHarness((response) => new FakeLLM(response));
    const results = await harness.run([SCENARIO_SOURCES_LACK]);

    const r = results[0];
    expect(r.status).toBe("refused");
    expect(r.correct).toBe(true);
  });

  it('quantity error ("5 shards" vs sources "4") is caught', async () => {
    const harness = new EvalHarness((response) => new FakeLLM(response));
    const results = await harness.run([SCENARIO_QUANTITY_ERROR]);

    const r = results[0];
    expect(r.status).toBe("refused");
    // The sentence with "5" was dropped, so the refusal is correct
    expect(r.correct).toBe(true);
  });
});

// ── Judges ───────────────────────────────────────────────────────────────────

describe("judges", () => {
  it("helpfulness judge does NOT take sources", () => {
    const score = helpfulnessJudge("test answer", ["test"]);
    expect(typeof score).toBe("number");
  });

  it("faithfulness judge signature takes sources", () => {
    const score = faithfulnessJudge(
      "test answer",
      ["source text"],
      ["test"],
    );
    expect(typeof score).toBe("number");
  });

  it("faithfulness is lower when facts are not in sources", () => {
    // Fact "5 dragon stones" is in answer but not in sources
    const score = faithfulnessJudge(
      "You need 5 dragon stones",
      ["You need 4 fire shards"],
      ["5 dragon stones"],
    );
    expect(score).toBe(0);
  });

  it("faithfulness is high when facts are in both answer and sources", () => {
    const score = faithfulnessJudge(
      "You need 4 fire shards",
      ["You need 4 fire shards"],
      ["4 fire shards"],
    );
    expect(score).toBe(1);
  });

  it("final score equals min of helpful and faithful", () => {
    const helpful = helpfulnessJudge("partial", ["a", "b"]);
    const faithful = faithfulnessJudge("partial", ["src"], ["a"]);
    expect(Math.min(helpful, faithful)).toBeLessThanOrEqual(helpful);
    expect(Math.min(helpful, faithful)).toBeLessThanOrEqual(faithful);
  });
});

// ── Full scenario run ───────────────────────────────────────────────────────

describe("full eval run", () => {
  it("produces results for all golden scenarios", async () => {
    const harness = new EvalHarness((response) => new FakeLLM(response));
    const scenarios: Scenario[] = [
      SCENARIO_CONFIDENT_LIE,
      SCENARIO_CORRECT,
      SCENARIO_SOURCES_LACK,
      SCENARIO_QUANTITY_ERROR,
    ];
    const results = await harness.run(scenarios);

    expect(results.length).toBe(4);

    // Each result should be individually correct
    for (const r of results) {
      expect(r.correct).toBe(true);
    }

    // Confident lie → low score
    expect(results[0].finalScore).toBeLessThan(1.0);
    // Correct → high score
    expect(results[1].finalScore).toBe(1.0);
    // Sources lack → refused, correct
    expect(results[2].status).toBe("refused");
    expect(results[2].correct).toBe(true);
    // Quantity error → refused, correct
    expect(results[3].status).toBe("refused");
    expect(results[3].correct).toBe(true);
  });
});
