import { beforeAll, describe, expect, it } from 'vitest';

import { type AssistantAnswer } from '../src/assistant/assistant.service.js';
import { type EvalReport, runEval } from '../src/eval/eval-harness.js';
import { judgeFaithfulness } from '../src/eval/judges.js';
import { GOLDEN_SCENARIOS } from '../src/eval/golden-scenarios.js';

describe('eval harness on the golden scenarios', () => {
  let report: EvalReport = { scenarios: [], averageScore: 0 };

  beforeAll(async () => {
    report = await runEval(GOLDEN_SCENARIOS);
  });

  function byId(id: string) {
    const found = report.scenarios.find((s) => s.id === id);
    expect(found).toBeDefined();
    return found!;
  }

  it('a scripted confident lie scores low', () => {
    const lie = byId('confident-lie');
    // The lie uses only words the pages contain, so it survives the lexical
    // gate...
    expect(lie.answer.status).toBe('answered');
    expect(lie.answer.text).toContain('weak to fire');
    // ...and the faithfulness judge is what catches it.
    const planted = lie.faithfulness.violations.filter((v) => v.type === 'planted_false_fact');
    expect(planted.some((v) => v.detail.includes('weak to fire'))).toBe(true);
    expect(lie.finalScore).toBeLessThan(0.3);
  });

  it('a correct grounded answer scores high', () => {
    const good = byId('grounded-correct');
    expect(good.answer.status).toBe('answered');
    expect(good.helpfulness.score).toBe(1);
    expect(good.faithfulness.score).toBe(1);
    expect(good.finalScore).toBeGreaterThanOrEqual(0.9);
  });

  it('a scenario whose sources lack the answer yields the refusal', () => {
    const noCoverage = byId('no-coverage');
    expect(noCoverage.answer.status).toBe('refused');
    expect(noCoverage.answer.text).toBe('not covered by my sources');
    expect(noCoverage.finalScore).toBe(1);
  });

  it('scores a hallucinated quantity low end-to-end', () => {
    const quantity = byId('quantity-hallucination');
    expect(quantity.answer.status).toBe('refused');
    expect(quantity.finalScore).toBeLessThan(0.3);
  });

  it('catches a quantity error exactly: "5 shards" when the sources say 4', () => {
    const wrong: AssistantAnswer = { status: 'answered', text: 'You need 5 shards to open the gate.' };
    const judged = judgeFaithfulness(wrong, ['The gate opens with 4 shards.'], []);
    const mismatches = judged.violations.filter((v) => v.type === 'quantity_mismatch');
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].said).toBe('5');
    expect(mismatches[0].sourceSays).toBe('4');
    expect(mismatches[0].term).toBe('shards');
    expect(judged.score).toBeLessThan(1);
  });

  it('does not flag a quantity that matches the sources', () => {
    const right: AssistantAnswer = { status: 'answered', text: 'You need 4 shards to open the gate.' };
    const judged = judgeFaithfulness(right, ['The gate opens with 4 shards.'], []);
    expect(judged.violations).toEqual([]);
    expect(judged.score).toBe(1);
  });

  it('final score is the min of the helpfulness and faithfulness scores', () => {
    for (const scenario of report.scenarios) {
      expect(scenario.finalScore).toBe(Math.min(scenario.helpfulness.score, scenario.faithfulness.score));
    }
  });
});
