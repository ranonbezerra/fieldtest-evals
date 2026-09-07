import { describe, expect, it } from 'vitest';

import { AnswerService } from '../src/answer/answer-service.js';
import { ScriptedLlmClient } from '../src/answer/llm-client.js';
import { NOT_COVERED_MESSAGE } from '../src/answer/refusal.js';
import { CELLAR_PAGES, CONFIDENT_LIE_REPLY, GROUNDED_REPLY } from '../src/eval/golden-scenarios.js';

const QUESTION = 'How do I get past the cellar door?';

describe('hint mode', () => {
  it('redacts boss names, item locations and quantities from the grounded answer', async () => {
    const service = new AnswerService(ScriptedLlmClient.fromText(GROUNDED_REPLY));
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'hint');

    expect(result.refusal).toBe(false);
    expect(result.text).not.toContain('Gravel Wretch');
    expect(result.text).not.toContain('bakery');
    expect(result.text.toLowerCase()).not.toContain('four');
    expect(result.text).not.toMatch(/\d/);
    expect(result.text).toContain('hidden place');
    expect(result.text).toContain('the hidden name');
    expect(result.text).toContain('several shards');
    expect(result.fullAnswer).toBe(GROUNDED_REPLY);
  });

  it('keeps quantities the player already mentioned in their question', async () => {
    const service = new AnswerService(
      ScriptedLlmClient.fromText('Four shards are required to seal the cellar door.'),
    );
    const result = await service.answer('I have four shards already. What now?', CELLAR_PAGES, 'hint');

    expect(result.refusal).toBe(false);
    expect(result.text).toContain('Four shards are required');
  });

  it('is derived from the grounded answer by redaction, not by a second LLM call', async () => {
    const llm = ScriptedLlmClient.fromText(GROUNDED_REPLY);
    const service = new AnswerService(llm);
    const hint = await service.answer(QUESTION, CELLAR_PAGES, 'hint');

    expect(llm.calls).toHaveLength(1);

    const answerText = (
      await new AnswerService(ScriptedLlmClient.fromText(GROUNDED_REPLY)).answer(QUESTION, CELLAR_PAGES, 'answer')
    ).text;
    expect(hint.fullAnswer).toBe(answerText);
    expect(hint.text).not.toBe(answerText);
  });

  it('refuses in hint mode when nothing is grounded', async () => {
    const service = new AnswerService(ScriptedLlmClient.fromText(CONFIDENT_LIE_REPLY));
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'hint');

    expect(result.refusal).toBe(true);
    expect(result.text).toBe(NOT_COVERED_MESSAGE);
  });
});
