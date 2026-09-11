import { describe, expect, it } from 'vitest';
import { AnswerService } from '../src/guide/answer.service';
import { REFUSAL_TEXT, type LlmClient, type LlmRequest } from '../src/guide/answer.types';
import { ScriptedLlmClient } from '../src/guide/scripted-llm.client';

const QUESTION = 'How do I unlock the trial of Gloomwing?';
const SOURCES = [
  'Bring 4 sunshard keys to the altar in Emberfall Hollow to unlock the trial of Gloomwing. The altar will not accept a partial set.',
  'Collect sunshard keys from the vault in Sunspire Cathedral. The vault opens during the blue moon.',
];
const GROUNDED_ANSWER =
  'Bring 4 sunshard keys to the altar in Emberfall Hollow to unlock the trial of Gloomwing. Collect the sunshard keys from the vault in Sunspire Cathedral.';

function countingLlm(answer: string): { llm: LlmClient; calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    llm: {
      complete: async (request: LlmRequest) => {
        calls.push(request);
        return answer;
      },
    },
  };
}

describe('AnswerService', () => {
  it('returns the model answer when every sentence is grounded', async () => {
    const service = new AnswerService(new ScriptedLlmClient({ [QUESTION]: GROUNDED_ANSWER }));
    const result = await service.answer(QUESTION, SOURCES, 'full');
    expect(result.refused).toBe(false);
    expect(result.text).toBe(GROUNDED_ANSWER);
    expect(result.droppedSentences).toEqual([]);
  });

  it('drops only the ungrounded sentence and keeps the supported one', async () => {
    const service = new AnswerService(
      new ScriptedLlmClient({
        [QUESTION]:
          'Bring 4 sunshard keys to the altar in Emberfall Hollow. You must also bring a Moonstone Sigil to the warden.',
      }),
    );
    const result = await service.answer(QUESTION, SOURCES, 'full');
    expect(result.refused).toBe(false);
    expect(result.text).toBe('Bring 4 sunshard keys to the altar in Emberfall Hollow.');
    expect(result.droppedSentences).toHaveLength(1);
    expect(result.droppedSentences[0]).toContain('Moonstone Sigil');
  });

  it('refuses with the exact message when nothing is grounded', async () => {
    const q = 'How do I tame the river serpents?';
    const service = new AnswerService(
      new ScriptedLlmClient({ [q]: 'You tame the river serpents by feeding them moonlit eels at dawn.' }),
    );
    const result = await service.answer(q, SOURCES, 'full');
    expect(result.refused).toBe(true);
    expect(result.text).toBe(REFUSAL_TEXT);
  });

  it('hint mode makes exactly one llm call and redacts the gated answer', async () => {
    const { llm, calls } = countingLlm(GROUNDED_ANSWER);
    const service = new AnswerService(llm);
    const hint = await service.answer(QUESTION, SOURCES, 'hint');
    // One call, and it is not a "be vague" prompt: no mode goes to the model.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ question: QUESTION, sources: SOURCES });
    expect(hint.refused).toBe(false);
    expect(hint.text).not.toContain('Emberfall Hollow');
    expect(hint.text).not.toContain('Gloomwing');
    expect(hint.text).not.toContain('4 sunshard keys');
    expect(hint.text).toContain('sunshard keys');
  });

  it('refuses in hint mode too when nothing survives the gate', async () => {
    const q = 'How do I tame the river serpents?';
    const service = new AnswerService(
      new ScriptedLlmClient({ [q]: 'You tame the river serpents by feeding them moonlit eels at dawn.' }),
    );
    const result = await service.answer(q, SOURCES, 'hint');
    expect(result.refused).toBe(true);
    expect(result.text).toBe(REFUSAL_TEXT);
  });
});
