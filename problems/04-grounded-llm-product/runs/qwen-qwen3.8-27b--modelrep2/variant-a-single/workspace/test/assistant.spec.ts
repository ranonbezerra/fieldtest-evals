import 'reflect-metadata';
import { describe, expect, it } from 'vitest';

import { AssistantController } from '../src/assistant/assistant.controller.js';
import { AssistantService } from '../src/assistant/assistant.service.js';
import { ScriptedLlmClient, type LlmRequest } from '../src/assistant/llm-client.js';
import { redactSpoilers } from '../src/assistant/spoiler-redactor.js';
import { REFUSAL_MESSAGE } from '../src/assistant/types.js';
import { GOLDEN_SCENARIOS } from '../src/eval/golden-scenarios.js';

function scenario(id: string) {
  const found = GOLDEN_SCENARIOS.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`unknown scenario ${id}`);
  }
  return found;
}

function makeService(script: (request: LlmRequest) => string) {
  const llm = new ScriptedLlmClient(script);
  return { service: new AssistantService(llm), llm };
}

describe('AssistantService.answer', () => {
  it('returns the grounded answer when every sentence is grounded', async () => {
    const good = scenario('gate-open-good');
    const { service } = makeService(() => good.scriptedAnswer);

    const result = await service.answer(good.question, good.sources, 'full');

    expect(result.status).toBe('answered');
    expect(result.answer).toBe(good.scriptedAnswer);
    expect(result.droppedSentences).toEqual([]);
  });

  it('drops ungrounded sentences and keeps grounded ones', async () => {
    const { service } = makeService(() =>
      'The gate hums when all the shards are set. You must also carry the Amber Key.',
    );

    const result = await service.answer(
      'What happens when the shards are set?',
      scenario('gate-open-good').sources,
      'full',
    );

    expect(result.status).toBe('answered');
    expect(result.answer).toBe('The gate hums when all the shards are set.');
    expect(result.droppedSentences).toEqual(['You must also carry the Amber Key.']);
  });

  it('refuses with the exact message when no sentence is grounded', async () => {
    const uncovered = scenario('uncovered-final-boss');
    const { service } = makeService(() => uncovered.scriptedAnswer);

    const result = await service.answer(uncovered.question, uncovered.sources, 'full');

    expect(result.status).toBe('refused');
    expect(result.answer).toBe(REFUSAL_MESSAGE);
    expect(result.droppedSentences).toHaveLength(2);
  });

  it('derives hint mode by redacting the grounded answer, without re-prompting the LLM', async () => {
    const good = scenario('gate-open-good');
    const { service, llm } = makeService(() => good.scriptedAnswer);

    const result = await service.answer(good.question, good.sources, 'hint');

    expect(result.status).toBe('answered');
    expect(result.answer).toBe(
      'To open the Sun Gate, place [hidden] shards on the [hidden] plinths. ' +
        'Shards drop from ember wisps in the [hidden]. ' +
        '[hidden] guards the path beyond the gate.',
    );
    // boss names, item locations, and unmentioned quantities are redacted
    expect(result.answer).not.toMatch(/warden|kael/i);
    expect(result.answer).not.toMatch(/ashen|hollow/i);
    expect(result.answer).not.toMatch(/\b4\b|\bfour\b/i);
    // safe content survives the redaction
    expect(result.answer).toContain('shards');
    expect(result.answer).toContain('Sun Gate');
    expect(result.answer).toContain('plinths');
    // the hint was redacted locally: exactly one LLM prompt was sent
    expect(llm.calls).toHaveLength(1);
  });

  it('refuses in hint mode as well when the sources lack the answer', async () => {
    const uncovered = scenario('uncovered-final-boss');
    const { service } = makeService(() => uncovered.scriptedAnswer);

    const result = await service.answer(uncovered.question, uncovered.sources, 'hint');

    expect(result.status).toBe('refused');
    expect(result.answer).toBe(REFUSAL_MESSAGE);
  });
});

describe('redactSpoilers', () => {
  it('keeps quantities the player already mentioned and hides the rest', () => {
    const redacted = redactSpoilers('You need 2 more of the 4 shards.', {
      question: 'I have 2 shards.',
      sources: scenario('gate-open-good').sources,
    });

    expect(redacted).toBe('You need 2 more of the [hidden] shards.');
  });
});

describe('AssistantController', () => {
  it('delegates a valid request to the service', async () => {
    const good = scenario('gate-open-good');
    const { service } = makeService(() => good.scriptedAnswer);
    const controller = new AssistantController(service);

    const result = await controller.answer({ question: good.question, sources: good.sources, mode: 'full' });

    expect(result.status).toBe('answered');
    expect(result.answer).toBe(good.scriptedAnswer);
  });

  it('rejects invalid input with the standard error envelope', async () => {
    const { service } = makeService(() => 'x');
    const controller = new AssistantController(service);

    await expect(controller.answer({ question: '', sources: [] })).rejects.toMatchObject({
      response: { error: { code: 'invalid_input', details: { field: 'question' } } },
    });
    await expect(
      controller.answer({ question: 'q', sources: [{ text: 'p' }], mode: 'spoiler' }),
    ).rejects.toMatchObject({
      response: { error: { code: 'invalid_input', details: { field: 'mode' } } },
    });
  });
});
