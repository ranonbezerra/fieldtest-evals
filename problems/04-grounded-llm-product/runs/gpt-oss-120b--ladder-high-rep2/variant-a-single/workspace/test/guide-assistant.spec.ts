import { Test, TestingModule } from '@nestjs/testing';
import { GuideAssistantService } from '../src/guide-assistant/guide-assistant.service.js';
import { GuideAssistantModule } from '../src/guide-assistant/guide-assistant.module.js';
import { LLMClient } from '../src/llm/llm-client.interface.js';
import { FakeLLMClient } from '../src/llm/fake-llm-client.js';
import { runEval, Scenario } from '../src/eval/eval-harness.js';

describe('GuideAssistantService', () => {
  let service: GuideAssistantService;
  let fakeClient: FakeLLMClient;

  beforeEach(async () => {
    // Initialise a fresh fake client for each test case.
    fakeClient = new FakeLLMClient();

    const module: TestingModule = await Test.createTestingModule({
      imports: [GuideAssistantModule],
      providers: [{ provide: 'LLMClient', useValue: fakeClient }],
    }).compile();

    service = module.get<GuideAssistantService>(GuideAssistantService);
  });

  it('scripted confident lie scores low', async () => {
    const question = 'How do I obtain the Mystic Sword?';
    const sources = [
      'The Mystic Sword is found in the Ancient Ruins. It requires 4 Shards of Light.',
    ];
    const fakeAnswer = 'To obtain the Mystic Sword you need 5 Shards of Light.';
    // Map the question to the fake answer.
    fakeClient.answerMap.set(question, fakeAnswer);

    const scenario: Scenario = {
      name: 'confident-lie',
      question,
      sources,
      expectedFacts: ['The Mystic Sword is found in the Ancient Ruins.'],
      falseFacts: ['5 Shards of Light'],
    };

    const results = await runEval(service, [scenario]);
    const result = results['confident-lie'];
    expect(result.score).toBeLessThan(0.5);
    expect(result.helpful).toBe(0);
    expect(result.faithful).toBe(0);
  });

  it('correct grounded answer scores high', async () => {
    const question = 'What do I need to craft the Healing Potion?';
    const sources = [
      'You need 2 Red Herbs and 1 Blue Herb to craft the Healing Potion.',
    ];
    const fakeAnswer = 'You need 2 Red Herbs and 1 Blue Herb to craft the Healing Potion.';
    fakeClient.answerMap.set(question, fakeAnswer);

    const scenario: Scenario = {
      name: 'grounded-correct',
      question,
      sources,
      expectedFacts: ['2 Red Herbs', '1 Blue Herb'],
      falseFacts: [],
    };

    const results = await runEval(service, [scenario]);
    const result = results['grounded-correct'];
    expect(result.score).toBeCloseTo(1, 5);
    expect(result.helpful).toBeCloseTo(1, 5);
    expect(result.faithful).toBeCloseTo(1, 5);
  });

  it('sources lacking answer yields refusal', async () => {
    const question = 'Where is the Golden Key hidden?';
    const sources = ['The Golden Key was removed from the game in version 2.0.'];
    const fakeAnswer =
      'The Golden Key can be found behind the Stone Gate in the Dark Forest.';
    fakeClient.answerMap.set(question, fakeAnswer);

    const scenario: Scenario = {
      name: 'refusal-missing',
      question,
      sources,
      expectedFacts: [], // No answer is possible.
      falseFacts: ['Stone Gate', 'Dark Forest'],
    };

    const results = await runEval(service, [scenario]);
    const result = results['refusal-missing'];
    expect(result.helpful).toBe(0);
    // Refusal is acceptable because there were no expected facts.
    expect(result.faithful).toBe(1);
    expect(result.score).toBe(0);
  });

  it('quantity errors are caught exactly', async () => {
    const question = 'How many shards do I need for the Crystal Crown?';
    const sources = ['The Crystal Crown requires 4 shards of crystal.'];
    const fakeAnswer = 'You need 5 shards of crystal for the Crystal Crown.';
    fakeClient.answerMap.set(question, fakeAnswer);

    const scenario: Scenario = {
      name: 'quantity-error',
      question,
      sources,
      expectedFacts: ['4 shards of crystal'],
      falseFacts: ['5 shards of crystal'],
    };

    const results = await runEval(service, [scenario]);
    const result = results['quantity-error'];
    // The grounding gate drops the wrong sentence, leading to a refusal.
    expect(result.helpful).toBe(0);
    expect(result.faithful).toBe(0);
    expect(result.score).toBe(0);
  });

  it('hint mode redacts boss name, location, and unmentioned quantity', async () => {
    const question = 'What should I prepare for the upcoming fight?';
    const sources = [
      'You should prepare to face the Dragonlord boss at the Fire Temple and collect 5 shards.',
    ];
    const fakeAnswer =
      'You should prepare to face the Dragonlord boss at the Fire Temple and collect 5 shards.';
    fakeClient.answerMap.set(question, fakeAnswer);

    // Full answer should be identical to the source (grounded).
    const answerFull = await service.answer(question, sources, 'full');
    expect(answerFull).toBe(fakeAnswer);

    // Hint mode must redact the spoiler elements.
    const answerHint = await service.answer(question, sources, 'hint');
    expect(answerHint).not.toContain('Dragonlord');
    expect(answerHint).not.toContain('Fire Temple');
    expect(answerHint).not.toContain('5 shards');
    // Generic words should remain.
    expect(answerHint).toMatch(/prepare/i);
  });
});
