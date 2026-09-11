import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { FORGE_PAGE_KEEP, FORGE_PAGE_SOCKET } from '../src/eval/golden-scenarios';
import { assessAnswer } from '../src/guide/grounding';
import { GuideService } from '../src/guide/guide.service';
import { REFUSAL, ScriptedLlmClient } from '../src/guide/llm.client';
import { redactForHint } from '../src/guide/redaction';

const SOURCES = [FORGE_PAGE_SOCKET, FORGE_PAGE_KEEP];

function serviceWith(reply: string): { service: GuideService; client: ScriptedLlmClient } {
  const client = new ScriptedLlmClient({ replies: [{ when: 'forge', reply }] });
  return { service: new GuideService(client), client };
}

describe('GuideService.answer (full mode)', () => {
  it('keeps grounded sentences and drops ungrounded ones', async () => {
    const { service } = serviceWith(
      'You need 4 ember shards to light the Beacon Forge. You must also obtain the Obsidian Chalice from the Frozen Spire.',
    );
    const result = await service.answer({
      question: 'How do I light the Beacon Forge?',
      sources: SOURCES,
      mode: 'full',
    });
    expect(result.refused).toBe(false);
    expect(result.totalSentences).toBe(2);
    expect(result.droppedSentences).toBe(1);
    expect(result.answer).toBe('You need 4 ember shards to light the Beacon Forge.');
    expect(result.answer).not.toMatch(/obsidian|chalice|frozen|spire/i);
  });

  it('refuses with the standard phrase when no sentence is grounded', async () => {
    const { service } = serviceWith('The Beacon Forge is a myth and the shards never existed.');
    const result = await service.answer({
      question: 'How do I light the Beacon Forge?',
      sources: SOURCES,
      mode: 'full',
    });
    expect(result.refused).toBe(true);
    expect(result.answer).toBe(REFUSAL);
  });

  it('catches a quantity error exactly: "5 shards" against sources saying 4', async () => {
    const reply =
      'You need 5 ember shards to light the Beacon Forge. Insert them into the socket above the anvil.';
    const assessment = assessAnswer(reply, SOURCES, 'How many ember shards does the Beacon Forge need?');
    expect(assessment.sentences).toHaveLength(2);
    expect(assessment.sentences[0].grounded).toBe(false);
    expect(assessment.sentences[0].missing).toEqual(['5']);
    expect(assessment.sentences[1].grounded).toBe(true);

    const { service } = serviceWith(reply);
    const result = await service.answer({
      question: 'How many ember shards does the Beacon Forge need?',
      sources: SOURCES,
      mode: 'full',
    });
    expect(result.droppedSentences).toBe(1);
    expect(result.answer).not.toContain('5');
    expect(result.answer).toBe('Insert them into the socket above the anvil.');
  });

  it('catches a spoken quantity error the same way', async () => {
    const assessment = assessAnswer(
      'You need five ember shards to light the Beacon Forge.',
      SOURCES,
      'How many shards do I need?',
    );
    expect(assessment.sentences[0].grounded).toBe(false);
    expect(assessment.sentences[0].missing).toContain('five');
  });

  it('accepts a number the player already mentioned in the question', async () => {
    const assessment = assessAnswer(
      'You already have 2 shards.',
      SOURCES,
      'I have 2 shards. How many more do I need?',
    );
    expect(assessment.sentences[0].grounded).toBe(true);
  });

  it('hint mode redacts the grounded answer without a second LLM call', async () => {
    const reply =
      'You need 4 ember shards to light the Beacon Forge. ' +
      'The shards are found in the Molten Keep, and Pyreth the Ashen guards its entrance.';
    const client = new ScriptedLlmClient({ replies: [{ when: 'forge', reply }] });
    const service = new GuideService(client);
    const input = {
      question: 'How do I light the Beacon Forge, and where do I find the shards?',
      sources: SOURCES,
    };
    const full = await service.answer({ ...input, mode: 'full' });
    const hint = await service.answer({ ...input, mode: 'hint' });

    // Two answer() calls, two prompts total: hint mode did not re-prompt.
    expect(client.prompts).toHaveLength(2);
    expect(full.refused).toBe(false);
    expect(hint.refused).toBe(false);
    // Hint is derived by redacting the answer that passed the gate.
    expect(hint.answer).toBe(redactForHint(full.answer, input.question));
    expect(hint.answer).not.toMatch(/pyreth|ashen|molten|keep|forge|beacon|\b4\b/i);
    expect(hint.answer).toContain('[name]');
    expect(hint.answer).toContain('[quantity]');
  });

  it('hint mode of a refusal is the refusal itself', async () => {
    const { service } = serviceWith('The forge is powered by a secret crystal that hums at dawn.');
    const result = await service.answer({
      question: 'How do I light the Beacon Forge?',
      sources: SOURCES,
      mode: 'hint',
    });
    expect(result.refused).toBe(true);
    expect(result.answer).toBe(REFUSAL);
  });
});

describe('redactForHint', () => {
  it('removes a boss name, a location, and an unmentioned quantity from one sentence', () => {
    const out = redactForHint(
      'Pyreth the Ashen guards the Molten Keep behind the altar, and you need 9 ember shards to enter.',
      'How do I get past the front gate?',
    );
    expect(out).not.toMatch(/pyreth|ashen|molten|keep|altar|\b9\b/i);
    expect(out).toContain('[name]');
    expect(out).toContain('[location]');
    expect(out).toContain('[quantity]');
    expect(out).toContain('ember shards');
  });

  it('keeps quantities the player already mentioned, in digits and words', () => {
    expect(
      redactForHint('You already have 2 shards and need 2 more.', 'I have 2 shards. How many more do I need?'),
    ).toBe('You already have 2 shards and need 2 more.');
    expect(
      redactForHint('You have two shards and need two more.', 'I have two shards. How many more do I need?'),
    ).toBe('You have two shards and need two more.');
  });
});
