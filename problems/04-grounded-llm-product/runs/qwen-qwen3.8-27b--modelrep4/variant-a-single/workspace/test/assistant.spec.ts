import { describe, expect, it } from 'vitest';

import { AssistantService, REFUSAL_MESSAGE } from '../src/assistant/assistant.service.js';
import { ScriptedLlmClient } from '../src/assistant/llm-client.js';
import { redactForHint } from '../src/assistant/redaction.js';
import { CAVERNS_PAGE, EMBER_VAULT_PAGE, OBSIDIAN_GATE_PAGE } from '../src/eval/golden-scenarios.js';

const GATE_QUESTION = 'What do I need to open the Obsidian Gate?';
const GATE_SOURCES = [OBSIDIAN_GATE_PAGE, EMBER_VAULT_PAGE];
const GATE_ANSWER = 'You need 4 Ember Shards to open the Obsidian Gate.';
const AMULET_QUESTION = 'Where is the Amulet of Dawn?';
const AMULET_LIE = 'The Amulet of Dawn hangs in the Vault of Whispers on the second floor.';

function scripted(script: (prompt: string) => string): {
  client: ScriptedLlmClient;
  service: AssistantService;
} {
  const client = new ScriptedLlmClient(script);
  return { client, service: new AssistantService(client) };
}

describe('answer(question, sources, mode), full mode', () => {
  it('returns the LLM text when every sentence is grounded in the fetched pages', async () => {
    const { service } = scripted(() => GATE_ANSWER);
    const result = await service.answer(GATE_QUESTION, GATE_SOURCES, 'full');
    expect(result.status).toBe('answered');
    expect(result.text).toBe(GATE_ANSWER);
  });

  it('drops ungrounded sentences and keeps the grounded ones', async () => {
    const { service } = scripted(() => `${GATE_ANSWER} The gate is protected by the Ghost of the North.`);
    const result = await service.answer(GATE_QUESTION, GATE_SOURCES, 'full');
    expect(result.status).toBe('answered');
    expect(result.text).toBe(GATE_ANSWER);
  });

  it('refuses with the exact message when the pages do not cover the question', async () => {
    const { service } = scripted(() => AMULET_LIE);
    const result = await service.answer(AMULET_QUESTION, GATE_SOURCES, 'full');
    expect(result.status).toBe('refused');
    expect(result.text).toBe(REFUSAL_MESSAGE);
  });

  it('refuses rather than returning an empty answer when nothing survives the gate', async () => {
    const { service } = scripted(() => '');
    const result = await service.answer(GATE_QUESTION, GATE_SOURCES, 'full');
    expect(result).toEqual({ status: 'refused', text: REFUSAL_MESSAGE });
  });

  it('catches a quantity error at the gate: the wrong-count sentence is dropped, the right one kept', async () => {
    const { service } = scripted(() => `${GATE_ANSWER} Bring 5 Ember Shards to be safe.`);
    const result = await service.answer(GATE_QUESTION, GATE_SOURCES, 'full');
    expect(result.status).toBe('answered');
    expect(result.text).toContain('4 Ember Shards');
    expect(result.text).not.toContain('5');
  });
});

describe('answer(question, sources, mode), hint mode', () => {
  it('redacts entities and quantities the player did not mention', async () => {
    const { service } = scripted(() => GATE_ANSWER);
    const result = await service.answer(GATE_QUESTION, GATE_SOURCES, 'hint');
    expect(result.status).toBe('answered');
    expect(result.text).toBe('You need [?] [REDACTED] [REDACTED] to open the Obsidian Gate.');
  });

  it('keeps names the player already mentioned in the question', async () => {
    const { service } = scripted(() => 'Malgrath is weak to frost damage.');
    const result = await service.answer('How do I defeat Malgrath?', [CAVERNS_PAGE, EMBER_VAULT_PAGE], 'hint');
    expect(result.status).toBe('answered');
    expect(result.text).toBe('Malgrath is weak to frost damage.');
  });

  it('is derived by redacting the grounded full answer, not by re-prompting the LLM', async () => {
    // A hint prompt would legitimately elicit this spoiler; the service must
    // never send one, so an implementation that re-prompts fails here.
    const { client, service } = scripted((prompt) =>
      prompt.toLowerCase().includes('hint') ? 'Malgrath waits by the north gate.' : GATE_ANSWER,
    );
    const full = await service.answer(GATE_QUESTION, GATE_SOURCES, 'full');
    const hint = await service.answer(GATE_QUESTION, GATE_SOURCES, 'hint');
    expect(hint.text).toBe(redactForHint(full.text, GATE_QUESTION));
    expect(hint.text).not.toContain('Malgrath waits');
    expect(client.prompts.every((p) => !p.toLowerCase().includes('hint'))).toBe(true);
  });

  it('refuses in hint mode too when the pages do not cover the question', async () => {
    const { service } = scripted(() => 'The Amulet of Dawn hangs in the Vault of Whispers.');
    const result = await service.answer(AMULET_QUESTION, GATE_SOURCES, 'hint');
    expect(result).toEqual({ status: 'refused', text: REFUSAL_MESSAGE });
  });
});

describe('redactForHint', () => {
  it('redacts quantities the player did not mention and keeps the ones they did', () => {
    expect(redactForHint('You need 4 shards; you have 2.', 'I have 2 shards.')).toBe(
      'You need [?] shards; you have 2.',
    );
    expect(redactForHint('The gate takes four shards.', 'How many shards?')).toBe(
      'The gate takes [?] shards.',
    );
  });

  it('redacts named entities absent from the question and keeps common words', () => {
    expect(redactForHint('The Ember Vault is guarded by the Warden of Coals.', 'What is the Ember Vault?')).toBe(
      'The Ember Vault is guarded by the [REDACTED] of [REDACTED].',
    );
  });
});
