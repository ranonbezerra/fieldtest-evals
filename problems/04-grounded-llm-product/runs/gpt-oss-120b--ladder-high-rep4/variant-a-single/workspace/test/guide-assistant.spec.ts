import { describe, it, expect } from 'vitest';
import { AnswerService } from '../src/guide-assistant/answer.service.js';
import { LLMClient } from '../src/guide-assistant/llm-client.interface.js';
import { evaluateScenario, GOLDEN_SCENARIOS } from '../src/guide-assistant/eval.js';

/**
 * Simple deterministic LLM client used in tests.
 * It ignores the prompt and always returns the pre‑configured answer.
 */
class TestLLMClient implements LLMClient {
  constructor(private readonly answer: string) {}
  async generate(_: string): Promise<string> {
    return this.answer;
  }
}

describe('Guide Assistant Evaluation Harness', () => {
  it('scripted confident lie scores low', async () => {
    const scenario = GOLDEN_SCENARIOS.find((s: any) => s.id === 'confident_lie')!;
    const llm = new TestLLMClient(scenario.llmAnswer);
    const svc = new AnswerService(llm);
    const result = await evaluateScenario(svc, scenario);
    expect(result.final).toBe(0);
    expect(result.answer).toBe('not covered by my sources');
  });

  it('correct grounded answer scores high', async () => {
    const scenario = GOLDEN_SCENARIOS.find((s: any) => s.id === 'correct')!;
    const llm = new TestLLMClient(scenario.llmAnswer);
    const svc = new AnswerService(llm);
    const result = await evaluateScenario(svc, scenario);
    expect(result.final).toBe(1);
    expect(result.answer).toBe(scenario.llmAnswer);
  });

  it('sources lacking the answer produce a refusal and score as correct', async () => {
    const scenario = GOLDEN_SCENARIOS.find((s: any) => s.id === 'refusal')!;
    const llm = new TestLLMClient(scenario.llmAnswer);
    const svc = new AnswerService(llm);
    const result = await evaluateScenario(svc, scenario);
    expect(result.final).toBe(1);
    expect(result.answer).toBe('not covered by my sources');
  });

  it('quantity errors are caught exactly (5 shards vs 4 shards)', async () => {
    const scenario = GOLDEN_SCENARIOS.find((s: any) => s.id === 'quantity_error')!;
    const llm = new TestLLMClient(scenario.llmAnswer);
    const svc = new AnswerService(llm);
    const result = await evaluateScenario(svc, scenario);
    expect(result.final).toBe(0);
    expect(result.answer).toBe('not covered by my sources');
  });

  it('hint mode redacts boss names, locations and unmentioned quantities', async () => {
    const scenario = GOLDEN_SCENARIOS.find((s: any) => s.id === 'hint')!;
    const llm = new TestLLMClient(scenario.llmAnswer);
    const svc = new AnswerService(llm);
    const result = await evaluateScenario(svc, scenario, 'hint');
    const hint = result.answer;

    // Ensure boss name parts are removed.
    expect(hint).not.toContain('Lord');
    expect(hint).not.toContain('Shadows');

    // Ensure location is removed.
    expect(hint).not.toContain('Dark');
    expect(hint).not.toContain('Forest');

    // Ensure the quantity (3) is removed.
    expect(hint).not.toMatch(/\b3\b/);
  });
});
