import { describe, expect, it } from 'vitest';
import { AssistantService } from '../src/assistant/assistant.service';
import { ScriptedLlmClient } from '../src/assistant/assistant.llm-client';
import { REFUSAL_TEXT } from '../src/assistant/assistant.types';
import { EvalHarness } from '../src/eval/eval.harness';
import type { EvalScenario, ScenarioReport } from '../src/eval/eval.harness';
import { FaithfulnessJudge } from '../src/eval/eval.judges';
import { GOLDEN_SCENARIOS, SCRIPTED_ANSWERS } from '../src/eval/eval.scenarios';

function scenarioById(id: string): EvalScenario {
  const scenario = GOLDEN_SCENARIOS.find((entry) => entry.id === id);
  if (scenario === undefined) throw new Error(`unknown scenario: ${id}`);
  return scenario;
}

function runScenario(id: string): Promise<ScenarioReport> {
  const scenario = scenarioById(id);
  const llm = new ScriptedLlmClient(() => SCRIPTED_ANSWERS[scenario.id]);
  return new EvalHarness(new AssistantService(llm)).run(scenario);
}

describe('eval harness: golden scenarios', () => {
  it('scores a correct grounded answer high', async () => {
    const report = await runScenario('sun-gate-grounded');
    expect(report.finalAnswer.refused).toBe(false);
    expect(report.evaluation.score).toBeGreaterThanOrEqual(0.9);
  });

  it('scores a scripted confident lie low', async () => {
    const report = await runScenario('sun-gate-confident-lie');
    expect(report.evaluation.score).toBeLessThan(0.25);
    // The gate refused the lie, so the player got no answer:
    expect(report.finalAnswer.refused).toBe(true);
    expect(report.finalAnswer.text).toBe(REFUSAL_TEXT);
    expect(report.finalAnswer.dropped).toEqual(['You need 5 shards to open the Sun Gate.']);
    expect(report.evaluation.helpfulness).toBe(0);
    // A refusal says nothing false, so faithfulness stays high and the
    // helpfulness score is what drives the final score down.
    expect(report.evaluation.faithfulness).toBe(1);
  });

  it('scores a repeated planted false fact low even when it passes the surface gate', async () => {
    const report = await runScenario('sun-gate-invented-requirement');
    expect(report.finalAnswer.refused).toBe(false); // the lie survived the gate
    expect(report.evaluation.faithfulnessDetail.violatedFacts).toContain(
      'The Ashen Key is required to open the Sun Gate',
    );
    expect(report.evaluation.score).toBeLessThan(0.25);
  });

  it('yields refusal when the sources lack the answer', async () => {
    const report = await runScenario('dragon-hoard-unanswerable');
    expect(report.finalAnswer.refused).toBe(true);
    expect(report.finalAnswer.text).toBe(REFUSAL_TEXT);
    // A correct refusal (nothing to answer with) scores high on both judges.
    expect(report.evaluation.score).toBeGreaterThanOrEqual(0.9);
  });

  it('final score is the min of helpfulness and faithfulness for every scenario', async () => {
    for (const scenario of GOLDEN_SCENARIOS) {
      const llm = new ScriptedLlmClient(() => SCRIPTED_ANSWERS[scenario.id]);
      const report = await new EvalHarness(new AssistantService(llm)).run(scenario);
      expect(report.evaluation.score).toBe(
        Math.min(report.evaluation.helpfulness, report.evaluation.faithfulness),
      );
    }
  });
});

describe('faithfulness judge: quantity errors are caught exactly', () => {
  const scenario = scenarioById('sun-gate-confident-lie');
  const judge = new FaithfulnessJudge();

  it('flags "5 shards" when the sources say 4', () => {
    const outcome = judge.judge('You need 5 shards to open the Sun Gate.', scenario.sources, scenario.forbiddenFacts);
    expect(outcome.score).toBe(0);
    const issue = outcome.sentences[0].issues.find((entry) => entry.kind === 'quantity_mismatch');
    expect(issue).toMatchObject({ kind: 'quantity_mismatch', unit: 'shards', claimed: 5, inSources: [4] });
    expect(outcome.violatedFacts).toContain('You need 5 shards to open the Sun Gate');
  });

  it('does not flag "4 shards", the quantity the sources state', () => {
    const outcome = judge.judge('You need 4 shards to open the Sun Gate.', scenario.sources, scenario.forbiddenFacts);
    expect(outcome.score).toBe(1);
    expect(outcome.sentences[0].issues).toEqual([]);
    expect(outcome.violatedFacts).toEqual([]);
  });
});
