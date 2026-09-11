import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { EvalService, type EvalReport } from '../src/eval/eval.service.js';
import {
  CANNED_ANSWERS,
  GOLDEN_SCENARIOS,
  WIKI_PAGES,
  type GoldenScenario,
} from '../src/eval/golden-scenarios.js';
import { scoreFaithfulness, scoreHelpfulness } from '../src/eval/judges.js';
import { REFUSAL_TEXT, type AnswerResult } from '../src/guide/answer-result.js';
import { filterGroundedSentences } from '../src/guide/grounding-gate.js';
import { ScriptedLlmClient } from '../src/guide/llm-client.js';
import { GuideService } from '../src/guide/guide.service.js';

const runHarness = async (): Promise<EvalReport> => {
  const guide = new GuideService(new ScriptedLlmClient(CANNED_ANSWERS));
  return new EvalService(guide).run(GOLDEN_SCENARIOS);
};

const row = (report: EvalReport, id: string) => {
  const found = report.scenarios.find((r) => r.id === id);
  if (!found) throw new Error(`no report row for scenario ${id}`);
  return found;
};

describe('eval harness — golden scenarios', () => {
  it('scores a scripted confident lie low', async () => {
    const report = await runHarness();
    const r = row(report, 'invented-item-lie');

    expect(r.status).toBe('refused');
    expect(r.output).toBe(REFUSAL_TEXT);
    expect(r.output).not.toContain('Moonstone');
    expect(r.helpful).toBe(0);
    expect(r.faithful).toBe(1);
    expect(r.score).toBeLessThan(0.5);
  });

  it('scores a correct grounded answer high', async () => {
    const report = await runHarness();
    const r = row(report, 'shards-for-gate');

    expect(r.status).toBe('answered');
    expect(r.helpful).toBe(1);
    expect(r.faithful).toBe(1);
    expect(r.score).toBeGreaterThanOrEqual(0.9);
    expect(r.output).toContain('Four Ember Shards are required.');
    expect(r.output).toContain('The Cinder Gate accepts no other offering.');
    expect(r.output).not.toContain('Bring two Ashen Keys');
  });

  it('scores a refusal as correct when the sources lack the answer', async () => {
    const report = await runHarness();
    const r = row(report, 'not-covered-by-sources');

    expect(r.status).toBe('refused');
    expect(r.output).toBe(REFUSAL_TEXT);
    expect(r.helpful).toBe(1);
    expect(r.faithful).toBe(1);
    expect(r.score).toBeGreaterThanOrEqual(0.9);
  });

  it('catches "five shards" against sources that say four, exactly', async () => {
    const report = await runHarness();
    const scenario = GOLDEN_SCENARIOS.find((s) => s.id === 'quantity-trap')!;
    const r = row(report, 'quantity-trap');

    expect(r.status).toBe('refused');
    expect(r.score).toBeLessThan(0.5);

    const wrong = filterGroundedSentences(
      "Five Ember Shards power the sanctum's altar.",
      scenario.sources,
    );
    const right = filterGroundedSentences(
      "Four Ember Shards power the sanctum's altar.",
      scenario.sources,
    );
    expect(wrong.kept).toEqual([]);
    expect(right.kept).toEqual(["Four Ember Shards power the sanctum's altar."]);
  });

  it('reports the final score as the min of the two judges', async () => {
    const report = await runHarness();

    for (const r of report.scenarios) {
      expect(r.score).toBe(Math.min(r.helpful, r.faithful));
    }
    // shards-for-gate 1, invented-item-lie 0, not-covered 1, quantity-trap 0
    expect(report.meanScore).toBeCloseTo(0.5);
  });
});

describe('judges', () => {
  it('the faithfulness judge takes the sources and scores a fluent lie low', () => {
    const scenario = GOLDEN_SCENARIOS.find((s) => s.id === 'not-covered-by-sources')!;
    const lie: AnswerResult = {
      status: 'answered',
      text: 'The Ashen Warden drops two Ember Shards and a golden blade.',
      keptSentences: ['The Ashen Warden drops two Ember Shards and a golden blade.'],
      droppedSentences: [],
    };

    const faithful = scoreFaithfulness(lie, scenario.sources, scenario);
    const helpful = scoreHelpfulness(lie, scenario);

    expect(faithful).toBe(0);
    expect(helpful).toBe(0);
    expect(Math.min(helpful, faithful)).toBe(0);
  });

  it('min, not average: a fluent half-true answer cannot hide behind its helpfulness', () => {
    const scenario: GoldenScenario = {
      id: 'min-rule',
      question: 'How many Ember Shards do I need?',
      sources: [WIKI_PAGES.emberSanctum, WIKI_PAGES.cinderGate],
      expectedFacts: ['four ember shards'],
      falseFacts: [],
    };
    const partial: AnswerResult = {
      status: 'answered',
      text: 'Four Ember Shards are required. The shrine is on the roof.',
      keptSentences: ['Four Ember Shards are required.', 'The shrine is on the roof.'],
      droppedSentences: [],
    };

    const helpful = scoreHelpfulness(partial, scenario);
    const faithful = scoreFaithfulness(partial, scenario.sources, scenario);
    const min = Math.min(helpful, faithful);

    expect(helpful).toBe(1);
    expect(faithful).toBe(0.5);
    expect(min).toBe(0.5);
    expect(min).toBeLessThan((helpful + faithful) / 2);
  });
});
