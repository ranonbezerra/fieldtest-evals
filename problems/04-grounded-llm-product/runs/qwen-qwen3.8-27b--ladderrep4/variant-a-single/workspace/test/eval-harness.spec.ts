import { describe, expect, it } from 'vitest';
import { REFUSAL_TEXT } from '../src/guide/answer.types';
import { GOLDEN_SCENARIOS, type GoldenScenario } from '../src/eval/eval-scenarios';
import { createEvalHarness } from '../src/eval/harness';
import { judgeFaithfulness, judgeHelpfulness } from '../src/eval/judges';

const reports = await createEvalHarness().run(GOLDEN_SCENARIOS);
const byId = new Map(reports.map((report): [string, (typeof reports)[number]] => [report.scenarioId, report]));

function scenario(id: string): GoldenScenario {
  const found = GOLDEN_SCENARIOS.find((s) => s.id === id);
  if (found === undefined) throw new Error(`missing scenario ${id}`);
  return found;
}

describe('eval harness', () => {
  it('scores a scripted confident lie low', () => {
    const lie = byId.get('fluent-lie')!;
    // The misattribution passed the lexical gate (its answer is the model's
    // text verbatim)...
    expect(lie.answer).toBe(lie.rawAnswer);
    // ...but the source-aware faithfulness judge catches it, and the min keeps
    // the overall score low even though helpfulness is high.
    expect(lie.faithfulness).toBeLessThan(0.5);
    expect(lie.helpfulness).toBeGreaterThan(lie.faithfulness);
    expect(lie.score).toBe(Math.min(lie.helpfulness, lie.faithfulness));
    expect(lie.score).toBeLessThan(0.5);
    expect((lie.helpfulness + lie.faithfulness) / 2).toBeGreaterThan(lie.score);
  });

  it('scores a correct grounded answer high', () => {
    const good = byId.get('grounded-answer')!;
    expect(good.refused).toBe(false);
    expect(good.helpfulness).toBeGreaterThanOrEqual(0.8);
    expect(good.faithfulness).toBeGreaterThanOrEqual(0.8);
    expect(good.score).toBeGreaterThanOrEqual(0.8);
  });

  it('scores a refusal as correct when the sources lack the answer', () => {
    const refusal = byId.get('refusal-correct')!;
    expect(refusal.refused).toBe(true);
    expect(refusal.answer).toBe(REFUSAL_TEXT);
    expect(refusal.score).toBeGreaterThanOrEqual(0.9);
  });

  it('catches the planted quantity error exactly (5 against a source that says 4)', () => {
    const quantity = byId.get('quantity-error')!;
    expect(quantity.rawAnswer).toContain('5 sunshard keys');
    expect(quantity.answer).not.toContain('5 sunshard keys');
    expect(quantity.droppedSentences.join(' ')).toContain('5 sunshard keys');
    expect(quantity.score).toBeLessThan(0.5);
  });

  it('the faithfulness judge receives the sources and catches a lie the gate lets through', () => {
    const fluentLie = scenario('fluent-lie');
    // Repeats source sentences verbatim, then invents an item requirement:
    // high fluency, low faithfulness.
    const lie =
      'Sunshard keys are stored in the vault in Sunspire Cathedral. The vault opens during the blue moon. You must also bring a Moonstone Sigil to the warden.';
    const faithful = judgeFaithfulness(lie, fluentLie.sources, fluentLie);
    const helpful = judgeHelpfulness(lie, fluentLie);
    expect(helpful.score).toBeGreaterThan(faithful.score);
    expect(faithful.score).toBeLessThan(0.5);
    expect(faithful.reasons.join(' ')).toMatch(/moonstone sigil/i);
  });

  it('a useless refusal in an answerable scenario scores low', () => {
    const grounded = scenario('grounded-answer');
    const helpful = judgeHelpfulness(REFUSAL_TEXT, grounded);
    expect(helpful.score).toBeLessThan(0.5);
    const faithful = judgeFaithfulness(REFUSAL_TEXT, grounded.sources, grounded);
    expect(faithful.score).toBe(1);
    expect(Math.min(helpful.score, faithful.score)).toBeLessThan(0.5);
  });
});
