import { describe, expect, it } from 'vitest';

import { AnswerService } from '../src/answer/answer-service.js';
import { ScriptedLlmClient } from '../src/answer/llm-client.js';
import { NOT_COVERED_MESSAGE } from '../src/answer/refusal.js';
import { CELLAR_PAGES, CONFIDENT_LIE_REPLY, GROUNDED_REPLY } from '../src/eval/golden-scenarios.js';

const QUESTION = 'How do I get past the cellar door?';

describe('AnswerService', () => {
  it('returns the grounded answer untouched when every sentence is supported', async () => {
    const service = new AnswerService(ScriptedLlmClient.fromText(GROUNDED_REPLY));
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'answer');

    expect(result.refusal).toBe(false);
    expect(result.text).toBe(GROUNDED_REPLY);
    expect(result.droppedSentences).toEqual([]);
  });

  it('refuses with "not covered by my sources" when the reply is a confident lie', async () => {
    const service = new AnswerService(ScriptedLlmClient.fromText(CONFIDENT_LIE_REPLY));
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'answer');

    expect(result.refusal).toBe(true);
    expect(result.text).toBe(NOT_COVERED_MESSAGE);
  });

  it('refuses when the LLM itself says the pages do not cover the question', async () => {
    const service = new AnswerService(ScriptedLlmClient.fromText('NOT_COVERED'));
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'answer');

    expect(result.refusal).toBe(true);
    expect(result.text).toBe(NOT_COVERED_MESSAGE);
  });

  it('drops only the sentence with the wrong quantity and keeps the correct one', async () => {
    const service = new AnswerService(
      ScriptedLlmClient.fromText('Four shards are required. Bring five shards to the door.'),
    );
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'answer');

    expect(result.refusal).toBe(false);
    expect(result.text).toBe('Four shards are required.');
    expect(result.droppedSentences).toEqual(['Bring five shards to the door.']);
    expect(result.text.toLowerCase()).not.toContain('five');
  });

  it('treats the exact quantity stated in the sources as grounded', async () => {
    const service = new AnswerService(ScriptedLlmClient.fromText('Bring four shards to the door.'));
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'answer');

    expect(result.refusal).toBe(false);
    expect(result.text).toBe('Bring four shards to the door.');
  });

  it('refuses an invented name that appears in no source', async () => {
    const service = new AnswerService(ScriptedLlmClient.fromText('The Rusted Key opens the gate.'));
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'answer');

    expect(result.refusal).toBe(true);
    expect(result.text).toBe(NOT_COVERED_MESSAGE);
  });
});
