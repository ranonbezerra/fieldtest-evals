import { describe, expect, it } from 'vitest';

import { AnswerService } from '../src/answer/answer.service.js';
import { REFUSAL_TEXT } from '../src/answer/answer.types.js';
import { EvalHarness, type ScenarioResult } from '../src/eval/eval-harness.js';
import { combineScores, FaithfulnessJudge } from '../src/eval/judges.js';
import {
  EMBER_GATE_PAGE,
  EMBER_SHARDS_PAGE,
  GOLDEN_SCENARIOS,
  type GoldenScenario,
} from '../src/eval/scenarios.js';

const SOURCES = [EMBER_GATE_PAGE, EMBER_SHARDS_PAGE];

function runSuite(): ScenarioResult[] {
  const harness = new EvalHarness();
  const service = new AnswerService(harness.buildLlm(GOLDEN_SCENARIOS));
  return harness.run(GOLDEN_SCENARIOS, service);
}

function byId(results: ScenarioResult[], id: string): ScenarioResult {
  const result = results.find((r) => r.id === id);
  if (!result) throw new Error(`scenario "${id}" missing from results`);
  return result;
}

function scenarioById(id: string): GoldenScenario {
  const scenario = GOLDEN_SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(`unknown scenario "${id}"`);
  return scenario;
}

describe('eval harness over the golden scenarios', () => {
  it('runs every golden scenario', () => {
    const results = runSuite();
    expect(results).toHaveLength(GOLDEN_SCENARIOS.length);
    expect(results.map((r) => r.id)).toEqual(GOLDEN_SCENARIOS.map((s) => s.id));
  });

  it('scores a correct grounded answer high', () => {
    const grounded = byId(runSuite(), 'grounded-answer');
    expect(grounded.status).toBe('answered');
    expect(grounded.answer).toBe(
      'The Ember Gate stands in the Hollow Vale. You need four ember shards, placed on its four braziers.',
    );
    expect(grounded.score).toBeGreaterThanOrEqual(0.9);
  });

  it('scores a scripted confident lie low', () => {
    const lie = byId(runSuite(), 'confident-lie');
    expect(lie.status).toBe('refused');
    expect(lie.answer).toBe(REFUSAL_TEXT);
    expect(lie.helpful).toBe(0);
    expect(lie.score).toBeLessThan(0.2);
  });

  it('scores a correct refusal (sources lack the answer) as correct', () => {
    const refusal = byId(runSuite(), 'sources-lack-answer');
    expect(refusal.status).toBe('refused');
    expect(refusal.answer).toBe(REFUSAL_TEXT);
    expect(refusal.score).toBeGreaterThanOrEqual(0.9);
  });

  it('catches "5 shards" against sources saying 4, exactly', () => {
    const scenario = scenarioById('quantity-mismatch');
    const result = byId(runSuite(), 'quantity-mismatch');

    // The gate drops the wrong-quantity sentence, and only that sentence.
    expect(result.droppedSentences).toEqual(['You need five ember shards to open it.']);
    expect(result.answer).not.toMatch(/five|\b5\b/);

    // The faithfulness judge, run on the raw planted text, names the exact mismatch.
    const verdict = new FaithfulnessJudge().judge(scenario.scriptedAnswer, {
      sources: scenario.sources,
      falseFacts: scenario.falseFacts,
    });
    expect(verdict.findings.some((f) => /five ember shards/i.test(f))).toBe(true);
    expect(verdict.findings.some((f) => f.includes('5') && f.includes('4'))).toBe(true);
  });

  it('passes the sources to the faithfulness judge, and its findings depend on them', () => {
    const lie = 'To open the Ember Gate, farm five moon shards in the Dusk Caverns.';
    const judge = new FaithfulnessJudge();

    const withSources = judge.judge(lie, { sources: SOURCES, falseFacts: ['five moon shards'] });
    const withoutSources = judge.judge(lie, { sources: [], falseFacts: ['five moon shards'] });

    // With the sources in front of it, the judge names the exact quantity mismatch.
    expect(withSources.findings.some((f) => f.includes('5') && f.includes('4'))).toBe(true);
    expect(withSources.score).toBeLessThan(0.5);
    // Without them it cannot name the mismatch — only flag it as unknown.
    expect(withoutSources.findings.some((f) => f.includes('5') && f.includes('4'))).toBe(false);
  });
});

describe('score combination', () => {
  it('combines helpfulness and faithfulness as min, not mean', () => {
    expect(combineScores(1, 1)).toBe(1);
    expect(combineScores(0.95, 0.4)).toBe(0.4);
    expect(combineScores(0.2, 0.95)).toBe(0.2);
    // A fluent lie (high style score, low faithfulness) cannot hide behind averaging.
    expect(combineScores(0.9, 0.1)).toBeLessThan((0.9 + 0.1) / 2);
  });
});
