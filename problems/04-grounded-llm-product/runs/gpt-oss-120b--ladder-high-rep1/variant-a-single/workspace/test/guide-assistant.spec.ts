import { describe, it, expect } from 'vitest';
import { AnswerService } from '../src/guide-assistant/answer.service';
import { FakeLLMClient } from '../src/guide-assistant/fake-llm-client';
import { evaluateScenario, Scenario } from '../src/guide-assistant/eval';

describe('AnswerService grounding gate', () => {
  it('drops ungrounded sentence with wrong quantity and refuses when nothing grounded', async () => {
    const question = 'How many shards do I need?';
    const sources = ['You need 4 shards to summon the boss.'];
    const fakeAnswer = 'You need 5 shards to summon the boss.';
    const service = new AnswerService(new FakeLLMClient(fakeAnswer));

    const answer = await service.answer(question, sources, 'full');
    expect(answer).toBe('not covered by my sources');
  });

  it('keeps grounded sentence and drops ungrounded one', async () => {
    const question = 'How many shards and crystals do I need?';
    const sources = ['You need 4 shards.', 'You need 3 crystals.'];
    const fakeAnswer = 'You need 4 shards. You also need 5 crystals.';
    const service = new AnswerService(new FakeLLMClient(fakeAnswer));

    const answer = await service.answer(question, sources, 'full');
    expect(answer).toBe('You need 4 shards.');
    expect(answer).not.toContain('5 crystals');
  });

  it('produces hint mode without boss names, locations, or unmentioned quantities', async () => {
    const question = 'What do I need?';
    const sources = [
      'To defeat the Dragon King, you must gather 3 Fire Crystals in the Ancient Ruins.'
    ];
    const fakeAnswer =
      'To defeat the Dragon King, you must gather 3 Fire Crystals in the Ancient Ruins.';
    const service = new AnswerService(new FakeLLMClient(fakeAnswer));

    const hint = await service.answer(question, sources, 'hint');

    // Ensure all prohibited tokens are absent.
    expect(hint).not.toMatch(/Dragon/i);
    expect(hint).not.toMatch(/King/i);
    expect(hint).not.toMatch(/Ancient/i);
    expect(hint).not.toMatch(/Ruins/i);
    expect(hint).not.toMatch(/\b3\b/);
  });
});

describe('Evaluation harness', () => {
  const answerServiceFactory = (fakeAnswer: string) => {
    return new AnswerService(new FakeLLMClient(fakeAnswer));
  };

  it('confident lie scores low', async () => {
    const scenario: Scenario = {
      id: 'confident-lie',
      question: 'How many shards do I need?',
      sources: ['You need 4 shards to summon the boss.'],
      expectedFacts: ['4 shards'],
      falseFacts: [],
      shouldRefuse: false,
      fakeAnswer: 'You need 5 shards to summon the boss.'
    };

    const result = await evaluateScenario(scenario, answerServiceFactory);
    expect(result.finalScore).toBe(0);
    expect(result.helpfulness).toBe(0);
    expect(result.faithfulness).toBe(0);
  });

  it('correct grounded answer scores high', async () => {
    const scenario: Scenario = {
      id: 'correct-answer',
      question: 'How many shards do I need?',
      sources: ['You need 4 shards to summon the boss.'],
      expectedFacts: ['4 shards'],
      falseFacts: [],
      shouldRefuse: false,
      fakeAnswer: 'You need 4 shards to summon the boss.'
    };

    const result = await evaluateScenario(scenario, answerServiceFactory);
    expect(result.finalScore).toBe(1);
    expect(result.helpfulness).toBe(1);
    expect(result.faithfulness).toBe(1);
  });

  it('sources lacking answer leads to correct refusal', async () => {
    const scenario: Scenario = {
      id: 'refusal-needed',
      question: 'What is the name of the hidden boss?',
      sources: ['The hidden area is locked behind a puzzle.'],
      expectedFacts: [],
      falseFacts: [],
      shouldRefuse: true,
      fakeAnswer: 'The hidden boss is called Dark Lord.'
    };

    const result = await evaluateScenario(scenario, answerServiceFactory);
    expect(result.finalScore).toBe(1);
    expect(result.helpfulness).toBe(1);
    expect(result.faithfulness).toBe(1);
  });
});
