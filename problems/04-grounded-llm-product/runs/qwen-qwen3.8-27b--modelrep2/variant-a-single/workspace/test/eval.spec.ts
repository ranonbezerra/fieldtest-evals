import 'reflect-metadata';
import { describe, expect, it } from 'vitest';

import { REFUSAL_MESSAGE } from '../src/assistant/types.js';
import { runGoldenEval } from '../src/eval/eval-harness.js';
import { GOLDEN_SCENARIOS } from '../src/eval/golden-scenarios.js';
import type { ScenarioEvaluation } from '../src/eval/types.js';

async function evaluationFor(id: string): Promise<ScenarioEvaluation> {
  const report = await runGoldenEval(GOLDEN_SCENARIOS);
  const evaluation = report.evaluations.find((entry) => entry.scenarioId === id);
  if (!evaluation) {
    throw new Error(`no evaluation for scenario ${id}`);
  }
  return evaluation;
}

describe('eval harness', () => {
  it('scores a correct grounded answer high', async () => {
    const evaluation = await evaluationFor('gate-open-good');

    expect(evaluation.refused).toBe(false);
    expect(evaluation.helpfulness.score).toBe(1);
    expect(evaluation.faithfulness.violations).toEqual([]);
    expect(evaluation.finalScore).toBeGreaterThanOrEqual(0.8);
    expect(evaluation.verdict).toBe('pass');
  });

  it('scores a scripted confident lie low', async () => {
    const evaluation = await evaluationFor('gate-open-confident-lie');

    expect(evaluation.refused).toBe(false);
    expect(evaluation.finalScore).toBeLessThan(0.5);
    expect(evaluation.verdict).toBe('fail');
  });

  it('yields refusal for a scenario whose sources lack the answer', async () => {
    const evaluation = await evaluationFor('uncovered-final-boss');

    expect(evaluation.refused).toBe(true);
    expect(evaluation.answer).toBe(REFUSAL_MESSAGE);
    expect(evaluation.verdict).toBe('pass');
  });

  it('catches a quantity error exactly (5 shards claimed, 4 in sources)', async () => {
    const evaluation = await evaluationFor('quantity-error-shards');

    expect(evaluation.faithfulness.violations).toEqual([
      { kind: 'quantity_mismatch', unit: 'shards', claimed: 5, source: 4 },
    ]);
    expect(evaluation.finalScore).toBeLessThan(0.5);
  });

  it('computes the final score as the minimum of the two judges', async () => {
    const report = await runGoldenEval(GOLDEN_SCENARIOS);

    for (const evaluation of report.evaluations) {
      if (evaluation.refused) {
        expect(evaluation.finalScore).toBe(0);
      } else {
        expect(evaluation.finalScore).toBe(Math.min(evaluation.helpfulness.score, evaluation.faithfulness.score));
      }
    }
    expect(report.summary).toEqual({ total: 4, passed: 2, failed: 2 });
  });
});
