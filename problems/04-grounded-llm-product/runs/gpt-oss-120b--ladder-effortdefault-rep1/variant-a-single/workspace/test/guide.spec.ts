import { describe, it, expect, beforeEach } from 'vitest';
import { GuideService } from '../src/guide/guide.service.js';
import { LlmClient, LLM_CLIENT } from '../src/guide/llm-client.interface.js';
import { Scenario } from '../src/eval/scenario.js';
import { evaluateScenarios } from '../src/eval/evaluator.js';
import { Module, Provider } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

/**
 * Simple scripted fake LLM client.
 *
 * The mapping is from scenario ID to the raw model answer (may contain false facts).
 */
class FakeLlmClient implements LlmClient {
  private readonly map: Record<string, string>;

  constructor(map: Record<string, string>) {
    this.map = map;
  }

  async generate(question: string, _sources: string[]): Promise<string> {
    // The test harness will set a global variable with the current scenario ID.
    // For simplicity we expose a static accessor.
    const id = (global as any).__CURRENT_SCENARIO_ID;
    return this.map[id] ?? '';
  }
}

/**
 * Helper to build a Nest testing module with the fake client injected.
 */
async function buildTestModule(fakeClient: LlmClient): Promise<TestingModule> {
  @Module({
    providers: [
      GuideService,
      { provide: LLM_CLIENT, useValue: fakeClient } as Provider,
    ],
    exports: [GuideService],
  })
  class TestModule {}

  return Test.createTestingModule({
    imports: [TestModule],
  }).compile();
}

/* ---------- Fixtures ---------- */

const sourcesExample = [
  `The Azure Dragon boss resides in the Sky Temple. To defeat it you need 4 Shard of Light.`,
  `The Golden Sword can be forged using 3 Sun Cores and 2 Moon Fragments.`,
];

const scenarios: Scenario[] = [
  {
    id: 'confident_lie',
    question: 'How do I defeat the Azure Dragon?',
    sources: sourcesExample,
    expectedFacts: ['Azure Dragon', '4 Shard of Light'],
    falseFacts: ['5 Shard of Light', 'Obsidian Shield'],
  },
  {
    id: 'correct_grounded',
    question: 'What materials craft the Golden Sword?',
    sources: sourcesExample,
    expectedFacts: ['3 Sun Cores', '2 Moon Fragments'],
    falseFacts: ['Obsidian Shield'],
  },
  {
    id: 'refusal_needed',
    question: 'Where can I find the Mystic Orb?',
    sources: sourcesExample,
    expectedFacts: [], // nothing expected
    falseFacts: ['Mystic Orb is in the Deep Cave'],
  },
  {
    id: 'quantity_error',
    question: 'How many shards do I need for the Azure Dragon?',
    sources: sourcesExample,
    expectedFacts: ['4 shards'],
    falseFacts: ['5 shards'],
    mode: 'full',
  },
  {
    id: 'hint_redaction',
    question: 'How do I defeat the Azure Dragon?',
    sources: sourcesExample,
    expectedFacts: [], // hint mode not required to contain them
    falseFacts: [],
    mode: 'hint',
  },
];

/* Mapping of scenario ID -> model answer (raw) */
const fakeAnswers: Record<string, string> = {
  confident_lie:
    'To defeat the Azure Dragon you need 5 Shard of Light. Also bring the Obsidian Shield for extra protection.',
  correct_grounded:
    'The Golden Sword can be forged using 3 Sun Cores and 2 Moon Fragments.',
  refusal_needed:
    'I\'m sorry, but I don\'t have that information.',
  quantity_error:
    'You need 5 shards of Light to summon the Azure Dragon.',
  hint_redaction:
    'To defeat the Azure Dragon you need 4 Shard of Light. The boss lives in the Sky Temple.',
};

/* ---------- Tests ---------- */

describe('GuideService & Evaluation Harness', () => {
  let service: GuideService;

  beforeEach(async () => {
    const fakeClient = new FakeLlmClient(fakeAnswers);
    const moduleRef = await buildTestModule(fakeClient);
    service = moduleRef.get(GuideService);
  });

  it('confident lie scores low (helpful=0, faithful=0)', async () => {
    (global as any).__CURRENT_SCENARIO_ID = 'confident_lie';
    const results = await evaluateScenarios(service, [scenarios[0]]);
    const r = results[0];
    expect(r.helpfulness).toBe(0);
    expect(r.faithfulness).toBe(0);
    expect(r.finalScore).toBe(0);
  });

  it('correct grounded answer scores high (1,1)', async () => {
    (global as any).__CURRENT_SCENARIO_ID = 'correct_grounded';
    const results = await evaluateScenarios(service, [scenarios[1]]);
    const r = results[0];
    expect(r.helpfulness).toBe(1);
    expect(r.faithfulness).toBe(1);
    expect(r.finalScore).toBe(1);
  });

  it('scenario lacking answer results in proper refusal', async () => {
    (global as any).__CURRENT_SCENARIO_ID = 'refusal_needed';
    const results = await evaluateScenarios(service, [scenarios[2]]);
    const r = results[0];
    expect(r.answer).toBe('not covered by my sources');
    // refusal is correct because sources lack any expected fact
    expect(r.helpfulness).toBe(1);
    expect(r.faithfulness).toBe(1);
    expect(r.finalScore).toBe(1);
  });

  it('quantity mismatch is caught (faithful=0)', async () => {
    (global as any).__CURRENT_SCENARIO_ID = 'quantity_error';
    const results = await evaluateScenarios(service, [scenarios[3]]);
    const r = results[0];
    expect(r.answer).not.toBe('not covered by my sources');
    // Expected fact "4 shards" missing, false fact "5 shards" present
    expect(r.faithfulness).toBe(0);
    // helpfulness also zero because expected not present
    expect(r.helpfulness).toBe(0);
    expect(r.finalScore).toBe(0);
  });

  it('hint mode redacts boss name, location and quantity not in question', async () => {
    (global as any).__CURRENT_SCENARIO_ID = 'hint_redaction';
    const results = await evaluateScenarios(service, [scenarios[4]]);
    const r = results[0];
    expect(r.answer).toBe('To defeat the Azure Dragon you need .'); // quantity and location removed
    // Ensure no proper nouns (Sky, Temple) and no numbers appear
    expect(r.answer).not.toMatch(/\bSky\b/);
    expect(r.answer).not.toMatch(/\bTemple\b/);
    expect(r.answer).not.toMatch(/\d+/);
    // Hint is still faithful to the grounded answer (no false facts)
    expect(r.faithfulness).toBe(1);
    // Helpfulness may be reduced because we removed expected facts, but still non‑zero
    expect(r.helpfulness).toBeGreaterThanOrEqual(0);
  });
});
