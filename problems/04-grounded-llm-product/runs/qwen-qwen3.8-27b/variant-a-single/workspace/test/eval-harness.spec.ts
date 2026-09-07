import { describe, expect, it } from 'vitest';

import {
  GOLDEN_SCENARIOS,
  CELLAR_PAGES,
} from '../src/eval/golden-scenarios.js';
import { runEval, type GoldenScenario, type ScenarioReport } from '../src/eval/eval-harness.js';
import { FaithfulnessJudge } from '../src/eval/judges.js';

describe('eval harness', () => {
  it('scores a scripted confident-lie answer low', async () => {
    const report = await runEval(GOLDEN_SCENARIOS.filter((s) => s.id === 'confident-lie-low'));
    const r = report.reports[0];

    expect(r.refusal).toBe(true);
    expect(r.helpfulness).toBe(0);
    expect(r.finalScore).toBeLessThan(0.25);
    expect(r.pass).toBe(false);
  });

  it('scores a correct grounded answer high', async () => {
    const report = await runEval(GOLDEN_SCENARIOS.filter((s) => s.id === 'grounded-answer-high'));
    const r = report.reports[0];

    expect(r.refusal).toBe(false);
    expect(r.helpfulness).toBe(1);
    expect(r.faithfulness).toBe(1);
    expect(r.finalScore).toBe(1);
    expect(r.pass).toBe(true);
  });

  it('yields a passing refusal when the sources lack the answer', async () => {
    const report = await runEval(GOLDEN_SCENARIOS.filter((s) => s.id === 'uncovered-refusal'));
    const r = report.reports[0];

    expect(r.refusal).toBe(true);
    expect(r.helpfulness).toBe(1);
    expect(r.faithfulness).toBe(1);
    expect(r.finalScore).toBe(1);
    expect(r.pass).toBe(true);
  });

  it('catches quantity errors exactly: five shards fails, four shards passes', async () => {
    const judge = new FaithfulnessJudge();

    expect(judge.judge('Bring five shards to the door.', CELLAR_PAGES)).toBe(0);
    expect(judge.judge('Bring four shards to the door.', CELLAR_PAGES)).toBe(1);
  });

  it('scores a planted false fact as unfaithful even when the rest is grounded', async () => {
    const judge = new FaithfulnessJudge();

    const score = judge.judge('Bring four shards and a Moonlight Shard.', CELLAR_PAGES, {
      plantedFalseFacts: ['moonlight shard'],
    });
    expect(score).toBe(0);
  });

  it('uses the minimum of helpfulness and faithfulness as the final score', async () => {
    const scenario: GoldenScenario = {
      id: 'partial-helpfulness',
      question: 'Where is the cellar and what does its door need?',
      sources: CELLAR_PAGES,
      mode: 'answer',
      llmReply: 'Weaken the Gravel Wretch. The cellar lies behind the bakery.',
      expectedFacts: ['behind the bakery', 'no keyhole'],
    };
    const report = await runEval([scenario]);
    const r = report.reports[0];

    expect(r.helpfulness).toBe(0.5);
    expect(r.faithfulness).toBe(1);
    expect(r.finalScore).toBe(0.5);
    expect(r.pass).toBe(false);
  });

  it('flags exactly the planted-lie scenario across the full golden suite', async () => {
    const report = await runEval(GOLDEN_SCENARIOS);
    const byId = Object.fromEntries(report.reports.map((r) => [r.id, r])) as Record<string, ScenarioReport>;

    expect(byId['grounded-answer-high'].finalScore).toBe(1);
    expect(byId['confident-lie-low'].finalScore).toBe(0);
    expect(byId['uncovered-refusal'].finalScore).toBe(1);
    expect(byId['quantity-mismatch-dropped'].finalScore).toBe(1);
    expect(byId['hint-redacted'].finalScore).toBe(1);

    // Only the deliberately planted lie fails; the suite as a whole does not pass.
    expect(byId['confident-lie-low'].pass).toBe(false);
    for (const id of ['grounded-answer-high', 'uncovered-refusal', 'quantity-mismatch-dropped', 'hint-redacted']) {
      expect(byId[id].pass).toBe(true);
    }
    expect(report.passed).toBe(false);
    expect(report.average).toBeCloseTo(0.8);
  });
});
