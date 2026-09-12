import { describe, it, expect } from 'vitest';
import { GuideAssistantService } from '../src/guide-assistant/guide-assistant.service.js';
import { LLMClient } from '../src/guide-assistant/llm-client.interface.js';
import { helpfulnessJudge, faithfulnessJudge } from '../src/guide-assistant/eval.js';

class FakeLLMClient implements LLMClient {
  constructor(private readonly answer: string) {}
  async generate(_prompt: string): Promise<string> {
    return this.answer;
  }
}

/** Helper to create a service wired to a deterministic fake LLM. */
function createService(fakeAnswer: string): GuideAssistantService {
  const client = new FakeLLMClient(fakeAnswer);
  return new GuideAssistantService(client);
}

describe('GuideAssistantService – grounding and hint mode', () => {
  it('confident lie scores low', async () => {
    const question = 'How many shards do I need?';
    const sources = ['You need 3 shards to craft the Mystic Sword.'];
    const llmAnswer = 'You need 5 shards to craft the Mystic Sword.';
    const service = createService(llmAnswer);
    const answer = await service.answer(question, sources, 'full');

    expect(answer).toBe('not covered by my sources');

    const scenario = {
      name: 'confident-lie',
      question,
      sources,
      expectedFacts: ['You need 3 shards'],
      falseFacts: [],
      expectAnswer: true,
      llmAnswer,
    };
    const helpful = helpfulnessJudge(answer, scenario);
    const faithful = faithfulnessJudge(answer, sources);
    expect(helpful).toBe(0);
    expect(faithful).toBe(1);
    expect(Math.min(helpful, faithful)).toBe(0);
  });

  it('correct grounded answer scores high', async () => {
    const question = 'How many shards do I need?';
    const sources = ['You need 3 shards to craft the Mystic Sword.'];
    const llmAnswer = 'You need 3 shards to craft the Mystic Sword.';
    const service = createService(llmAnswer);
    const answer = await service.answer(question, sources, 'full');

    expect(answer).toBe('You need 3 shards to craft the Mystic Sword.');

    const scenario = {
      name: 'correct-answer',
      question,
      sources,
      expectedFacts: ['You need 3 shards'],
      falseFacts: [],
      expectAnswer: true,
      llmAnswer,
    };
    const helpful = helpfulnessJudge(answer, scenario);
    const faithful = faithfulnessJudge(answer, sources);
    expect(helpful).toBe(1);
    expect(faithful).toBe(1);
    expect(Math.min(helpful, faithful)).toBe(1);
  });

  it('sources lacking answer result in correct refusal', async () => {
    const question = 'Where is the golden key?';
    const sources = ['The silver key lies in the castle courtyard.'];
    const llmAnswer = 'The golden key is hidden in the forest.';
    const service = createService(llmAnswer);
    const answer = await service.answer(question, sources, 'full');

    expect(answer).toBe('not covered by my sources');

    const scenario = {
      name: 'missing-answer',
      question,
      sources,
      expectedFacts: [],
      falseFacts: [],
      expectAnswer: false,
      llmAnswer,
    };
    const helpful = helpfulnessJudge(answer, scenario);
    const faithful = faithfulnessJudge(answer, sources);
    expect(helpful).toBe(1);
    expect(faithful).toBe(1);
    expect(Math.min(helpful, faithful)).toBe(1);
  });

  it('quantity mismatch is caught and leads to refusal', async () => {
    const question = 'How many shards do I need?';
    const sources = ['You need 4 shards to craft the Mystic Sword.'];
    const llmAnswer = 'You need 5 shards to craft the Mystic Sword.';
    const service = createService(llmAnswer);
    const answer = await service.answer(question, sources, 'full');

    expect(answer).toBe('not covered by my sources');

    const scenario = {
      name: 'quantity-mismatch',
      question,
      sources,
      expectedFacts: ['You need 4 shards'],
      falseFacts: [],
      expectAnswer: true,
      llmAnswer,
    };
    const helpful = helpfulnessJudge(answer, scenario);
    const faithful = faithfulnessJudge(answer, sources);
    expect(helpful).toBe(0);
    expect(faithful).toBe(1);
    expect(Math.min(helpful, faithful)).toBe(0);
  });

  it('hint mode redacts boss names, locations, and unmentioned quantities', async () => {
    const question = 'How do I get the shards?';
    const sources = [
      'Defeat the DragonLord in the Ember Cave. You need 3 shards.',
    ];
    const llmAnswer = 'Defeat the DragonLord in the Ember Cave. You need 3 shards.';
    const service = createService(llmAnswer);
    const hint = await service.answer(question, sources, 'hint');

    // Ensure spoiler‑sensitive tokens are removed.
    expect(hint).not.toContain('DragonLord');
    expect(hint).not.toContain('Ember');
    expect(hint).not.toContain('Cave');
    expect(hint).not.toContain('3');

    // Generic item reference should remain.
    expect(hint).toContain('shards');
  });
});
