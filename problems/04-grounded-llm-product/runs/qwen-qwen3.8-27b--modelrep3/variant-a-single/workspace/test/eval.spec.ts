import { describe, expect, it } from 'vitest';
import { PASS_THRESHOLD, runScenario, runSuite } from '../src/eval/harness.js';
import { faithfulnessJudge, helpfulnessJudge } from '../src/eval/judges.js';
import { GOLDEN_SCENARIOS, KINDLE_ALTAR, SHARD_HUNT } from '../src/eval/scenarios.js';
import { ALL_WIKI_PAGES } from '../src/guide/fixtures.js';
import { GuideService } from '../src/guide/guide.service.js';
import { ScriptedLlmClient } from '../src/guide/scripted-llm-client.js';

const CORRECT_KINDLE = 'The Ember Altar demands 4 ember shards before it can be kindled.';
const CONFIDENT_LIE = 'The Ember Altar requires 5 ember shards and a Moonblade to kindle.';
const CORRECT_NEXT =
  "Ember shards grow on the pale reeds along the Mirefen's eastern bank. " +
  'The Duskfang Warden guards the Ember Altar. ' +
  'You need 4 ember shards in all.';

describe('eval harness', () => {
  it('scores a correct grounded answer high', async () => {
    const service = new GuideService(new ScriptedLlmClient([{ match: 'kindle', reply: CORRECT_KINDLE }]));
    const report = await runScenario(service, KINDLE_ALTAR);

    expect(report.answer.status).toBe('answered');
    expect(report.helpfulness.score).toBe(1);
    expect(report.faithfulness.score).toBe(1);
    expect(report.finalScore).toBeGreaterThanOrEqual(PASS_THRESHOLD);
    expect(report.pass).toBe(true);
  });

  it('scores a scripted confident lie low', async () => {
    const service = new GuideService(new ScriptedLlmClient([{ match: 'kindle', reply: CONFIDENT_LIE }]));
    const report = await runScenario(service, KINDLE_ALTAR);

    expect(report.finalScore).toBeLessThan(0.4);
    expect(report.pass).toBe(false);
  });

  it('uses the min of the two judges as the final score', async () => {
    const service = new GuideService(new ScriptedLlmClient([
      { match: 'What do', reply: 'The Duskfang Warden guards the Ember Altar.' },
    ]));
    const report = await runScenario(service, SHARD_HUNT);

    expect(report.faithfulness.score).toBe(1);
    expect(report.helpfulness.score).toBeCloseTo(0.5);
    expect(report.finalScore).toBeCloseTo(0.5);
    expect(report.finalScore).toBe(Math.min(report.helpfulness.score, report.faithfulness.score));
    expect(report.pass).toBe(false);
  });

  it('runs the whole golden suite and every report obeys finalScore = min(judges)', async () => {
    const service = new GuideService(new ScriptedLlmClient([
      { match: 'kindle', reply: CORRECT_KINDLE },
      { match: 'What do', reply: CORRECT_NEXT },
    ]));
    const reports = await runSuite(service, GOLDEN_SCENARIOS);

    expect(reports.map((r) => r.scenarioId)).toEqual(['kindle-altar', 'shard-hunt']);
    for (const report of reports) {
      expect(report.finalScore).toBe(Math.min(report.helpfulness.score, report.faithfulness.score));
      expect(report.pass).toBe(report.finalScore >= PASS_THRESHOLD);
    }
    expect(reports.every((r) => r.pass)).toBe(true);
  });
});

describe('judges', () => {
  it('faithfulness catches a planted quantity error on ungated text', () => {
    const verdict = faithfulnessJudge('The altar requires 5 ember shards.', ALL_WIKI_PAGES, ['5 ember shards']);

    expect(verdict.score).toBe(0);
    expect(verdict.findings.join(' ')).toMatch(/planted false fact present: "5 ember shards"/);
  });

  it('faithfulness rewards fully source-supported text', () => {
    const verdict = faithfulnessJudge(CORRECT_KINDLE, ALL_WIKI_PAGES, ['5 ember shards', 'Moonblade']);

    expect(verdict.score).toBe(1);
    expect(verdict.findings).toEqual([]);
  });

  it('helpfulness scores partial fact coverage proportionally', () => {
    const verdict = helpfulnessJudge('The altar is in the Mirefen.', ['4 ember shards', 'the Mirefen']);

    expect(verdict.score).toBeCloseTo(0.5);
    expect(verdict.findings.join(' ')).toMatch(/missing expected fact: "4 ember shards"/);
  });

  it('helpfulness gives zero to a refusal', () => {
    const verdict = helpfulnessJudge('', ['4 ember shards']);

    expect(verdict.score).toBe(0);
  });
});
