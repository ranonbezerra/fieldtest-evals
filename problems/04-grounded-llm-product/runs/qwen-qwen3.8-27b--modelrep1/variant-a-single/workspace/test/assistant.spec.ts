import { describe, expect, it } from 'vitest';
import { AssistantService } from '../src/assistant/assistant.service';
import { ScriptedLlmClient } from '../src/assistant/assistant.llm-client';
import { REFUSAL_TEXT } from '../src/assistant/assistant.types';
import { redactForHint } from '../src/assistant/assistant.redactor';
import type { SpoilerLexicon } from '../src/assistant/assistant.redactor';
import { SUN_GATE_PAGES } from '../src/eval/eval.scenarios';

const QUESTION = 'How do I open the Sun Gate?';
const GOOD_ANSWER = 'You need 4 shards to open the Sun Gate. The Ashen Warden guards the gate on the Ashen Road.';
const LEXICON: SpoilerLexicon = { bossNames: ['Ashen Warden'], locations: ['Ashen Road'] };

function makeService(answerText: string): { service: AssistantService; llm: ScriptedLlmClient } {
  const llm = new ScriptedLlmClient(() => answerText);
  return { service: new AssistantService(llm, LEXICON), llm };
}

describe('AssistantService.answer (full mode)', () => {
  it('returns a fully grounded answer unchanged', async () => {
    const { service } = makeService(GOOD_ANSWER);
    const result = await service.answer(QUESTION, SUN_GATE_PAGES, 'full');
    expect(result.refused).toBe(false);
    expect(result.text).toBe(GOOD_ANSWER);
    expect(result.dropped).toEqual([]);
  });

  it('drops ungrounded sentences and keeps the grounded ones', async () => {
    const lie = 'The Crypt of Echoes is a safe house for refugees.';
    const { service } = makeService(`${GOOD_ANSWER} ${lie}`);
    const result = await service.answer(QUESTION, SUN_GATE_PAGES, 'full');
    expect(result.refused).toBe(false);
    expect(result.text).toBe(GOOD_ANSWER);
    expect(result.dropped).toEqual([lie]);
  });

  it('refuses with the exact message when no sentence is grounded', async () => {
    const { service } = makeService(
      "The dragon's hoard is hidden in the Crypt of Echoes. It has been there since the first age.",
    );
    const result = await service.answer("Where is the dragon's hoard hidden?", SUN_GATE_PAGES, 'full');
    expect(result.refused).toBe(true);
    expect(result.text).toBe(REFUSAL_TEXT);
    expect(result.text).toBe('not covered by my sources');
    expect(result.dropped).toHaveLength(2);
  });

  it('refuses a sentence whose only error is a quantity the sources contradict', async () => {
    const wrong = 'You need 5 shards to open the Sun Gate.';
    const { service } = makeService(wrong);
    const result = await service.answer(QUESTION, SUN_GATE_PAGES, 'full');
    expect(result.refused).toBe(true);
    expect(result.text).toBe(REFUSAL_TEXT);
    expect(result.dropped).toEqual([wrong]);
  });

  it('throws when no LLM client was injected', async () => {
    const service = new AssistantService(undefined);
    await expect(service.answer(QUESTION, SUN_GATE_PAGES, 'full')).rejects.toThrow(/LlmClient/);
  });
});

describe('AssistantService.answer (hint mode)', () => {
  it('redacts boss names, locations and quantities the player did not mention', async () => {
    const { service } = makeService(GOOD_ANSWER);
    const result = await service.answer(QUESTION, SUN_GATE_PAGES, 'hint');
    expect(result.refused).toBe(false);
    expect(result.text).toBe('You need [N] shards to open the Sun Gate. The [boss] guards the gate on [location].');
  });

  it('keeps quantities the player already mentioned', async () => {
    const { service } = makeService(GOOD_ANSWER);
    const result = await service.answer(
      'I have 4 shards. Is that enough to open the Sun Gate?',
      SUN_GATE_PAGES,
      'hint',
    );
    expect(result.text).toBe('You need 4 shards to open the Sun Gate. The [boss] guards the gate on [location].');
  });

  it('keeps boss names the player already mentioned', async () => {
    const { service } = makeService(GOOD_ANSWER);
    const result = await service.answer(
      'How do I open the Sun Gate while the Ashen Warden guards it?',
      SUN_GATE_PAGES,
      'hint',
    );
    expect(result.text).toBe(
      'You need [N] shards to open the Sun Gate. The Ashen Warden guards the gate on [location].',
    );
  });

  it('is derived by redacting the full grounded answer, not by re-prompting', async () => {
    const llm = new ScriptedLlmClient(() => GOOD_ANSWER);
    const service = new AssistantService(llm, LEXICON);
    const full = await service.answer(QUESTION, SUN_GATE_PAGES, 'full');
    const hint = await service.answer(QUESTION, SUN_GATE_PAGES, 'hint');
    expect(llm.requests).toHaveLength(2); // one call per answer, never a second "hint" call
    expect(llm.requests[0].prompt).toBe(llm.requests[1].prompt); // mode never changes the prompt
    expect(hint.text).toBe(redactForHint(full.text, QUESTION, LEXICON));
  });
});
