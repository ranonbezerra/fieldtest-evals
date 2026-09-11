import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { EvalHarness } from '../src/eval/eval-harness';
import { FORGE_PAGE_KEEP, FORGE_PAGE_SOCKET, GOLDEN_SCENARIOS } from '../src/eval/golden-scenarios';
import { judgeFaithfulness, judgeHelpfulness } from '../src/eval/judges';
import { GuideService } from '../src/guide/guide.service';
import { REFUSAL, ScriptedLlmClient } from '../src/guide/llm.client';

const SOURCES = [FORGE_PAGE_SOCKET, FORGE_PAGE_KEEP];

function makeHarness(): EvalHarness {
  const client = new ScriptedLlmClient({
    replies: GOLDEN_SCENARIOS.map(scenario => ({ when: scenario.matchWhen, reply: scenario.llmReply })),
    fallback: '',
  });
  return new EvalHarness(new GuideService(client), client);
}

async function runScenario(id: string) {
  const report = await makeHarness().run(GOLDEN_SCENARIOS);
  const run = report.runs.find(candidate => candidate.scenarioId === id);
  if (!run) throw new Error(`scenario ${id} missing from report`);
  return run;
}

describe('eval harness over golden scenarios', () => {
  it('scores a scripted confident lie low', async () => {
    const run = await runScenario('invented-item-requirement');
    expect(run.rawReply).toMatch(/obsidian chalice/i); // the lie was planted and reached the judges
    expect(run.faithful).toBe(0);
    expect(run.helpful).toBe(0);
    expect(run.score).toBe(0);
    expect(run.systemRefused).toBe(true); // the gate refuses the lie on the production path
    expect(run.systemAnswer).toBe(REFUSAL);
  });

  it('scores a correct grounded answer high', async () => {
    const run = await runScenario('grounded-correct');
    expect(run.helpful).toBe(1);
    expect(run.faithful).toBe(1);
    expect(run.score).toBe(1);
  });

  it('scores refusal as correct when the sources lack the answer', async () => {
    const run = await runScenario('answer-not-in-sources');
    expect(run.rawReply).toBe(REFUSAL);
    expect(run.helpful).toBe(1);
    expect(run.faithful).toBe(1);
    expect(run.score).toBe(1);
  });

  it('catches a quantity error exactly: "5 shards" against sources saying 4', async () => {
    const run = await runScenario('wrong-quantity');
    expect(run.rawReply).toMatch(/5 ember shards/);
    expect(run.faithful).toBe(0.5); // exactly one of the two sentences is unsupported
    expect(run.helpful).toBe(0);
    expect(run.score).toBe(0);
    expect(run.systemAnswer).not.toContain('5'); // the gate dropped the wrong-quantity sentence
  });

  it('combines the judges as min(helpful, faithful)', async () => {
    const report = await makeHarness().run(GOLDEN_SCENARIOS);
    expect(report.runs).toHaveLength(GOLDEN_SCENARIOS.length);
    for (const run of report.runs) {
      expect(run.score).toBe(Math.min(run.helpful, run.faithful));
    }
    expect(report.overall).toBe(0.5); // (1 + 0 + 0 + 1) / 4
  });
});

describe('judges', () => {
  it('the faithfulness judge takes the sources and changes its verdict with them', () => {
    const answer = 'You need 4 ember shards to light the Beacon Forge.';
    expect(judgeFaithfulness(answer, SOURCES, 'how do I light the forge?')).toBe(1);
    expect(
      judgeFaithfulness(answer, ['The lighthouse keeper polishes the lanterns each dusk.'], 'how do I light the forge?'),
    ).toBe(0);
  });

  it('a confident useless refusal scores low on helpfulness; a correct refusal scores high', () => {
    const answered = GOLDEN_SCENARIOS.find(scenario => scenario.id === 'grounded-correct');
    const unanswerable = GOLDEN_SCENARIOS.find(scenario => scenario.id === 'answer-not-in-sources');
    if (!answered || !unanswerable) throw new Error('scenario fixture missing');
    expect(judgeHelpfulness(REFUSAL, answered)).toBe(0);
    expect(judgeHelpfulness(REFUSAL, unanswerable)).toBe(1);
  });

  it('a fluent lie that states a planted false fact scores zero on both judges', () => {
    const scenario = GOLDEN_SCENARIOS.find(candidate => candidate.id === 'grounded-correct');
    if (!scenario) throw new Error('scenario fixture missing');
    const fluentLie = 'You need 4 ember shards, plus the Obsidian Chalice, to light the Beacon Forge.';
    expect(judgeHelpfulness(fluentLie, scenario)).toBe(0);
    expect(judgeFaithfulness(fluentLie, SOURCES, 'how do I light the forge?')).toBe(0);
  });
});
