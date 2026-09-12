import { describe, expect, it } from 'vitest';
import { ALL_WIKI_PAGES, EMBER_ALTAR_PAGE, MIREFEN_PAGE } from '../src/guide/fixtures.js';
import { isSentenceGrounded } from '../src/guide/grounder.js';
import { GuideService } from '../src/guide/guide.service.js';
import { redactToHint } from '../src/guide/redactor.js';
import { ScriptedLlmClient } from '../src/guide/scripted-llm-client.js';
import type { ScriptEntry } from '../src/guide/scripted-llm-client.js';
import { REFUSAL_MESSAGE } from '../src/guide/guide.types.js';

const KINDLE_QUESTION = 'How do I kindle the Ember Altar?';
const CORRECT_KINDLE = 'The Ember Altar demands 4 ember shards before it can be kindled.';
const FAKE_ITEM_SENTENCE = 'A Moonblade is also required.';
const NEXT_QUESTION = 'I have 2 ember shards so far. What do I do next?';
const NEXT_REPLY =
  "Ember shards grow on the pale reeds along the Mirefen's eastern bank. " +
  'The Duskfang Warden guards the Ember Altar. ' +
  'You need 4 ember shards in all.';
const EXPECTED_HINT =
  "Ember shards grow on the pale reeds along the secret place's eastern bank. " +
  'The hidden boss guards the secret place. ' +
  'You need several ember shards in all.';

function build(entries: ScriptEntry[]): { service: GuideService; llm: ScriptedLlmClient } {
  const llm = new ScriptedLlmClient(entries);
  return { service: new GuideService(llm), llm };
}

describe('GuideService.answer - full mode', () => {
  it('returns the model answer untouched when every sentence is grounded', async () => {
    const { service } = build([{ match: 'kindle', reply: CORRECT_KINDLE }]);
    const res = await service.answer(KINDLE_QUESTION, ALL_WIKI_PAGES, 'full');

    expect(res.status).toBe('answered');
    expect(res.mode).toBe('full');
    expect(res.text).toBe(CORRECT_KINDLE);
    expect(res.droppedSentences).toEqual([]);
    expect(res.refusalReason).toBeNull();
    expect(res.sourcesUsed).toContain('ember-altar');
  });

  it('drops the ungrounded sentence and keeps the grounded one', async () => {
    const { service } = build([{ match: 'kindle', reply: `${CORRECT_KINDLE} ${FAKE_ITEM_SENTENCE}` }]);
    const res = await service.answer(KINDLE_QUESTION, ALL_WIKI_PAGES, 'full');

    expect(res.status).toBe('answered');
    expect(res.text).toBe(CORRECT_KINDLE);
    expect(res.droppedSentences).toEqual([FAKE_ITEM_SENTENCE]);
  });

  it('refuses with the exact phrase when the sources lack the answer', async () => {
    const { service } = build([
      { match: 'defeat', reply: 'The Duskfang Warden falls to 3 frost arrows. It weakens at dawn.' },
    ]);
    const res = await service.answer('How do I defeat the Duskfang Warden?', [EMBER_ALTAR_PAGE, MIREFEN_PAGE], 'full');

    expect(res.status).toBe('refused');
    expect(res.refusalReason).toBe(REFUSAL_MESSAGE);
    expect(res.refusalReason).toBe('not covered by my sources');
    expect(res.text).toBe('');
    expect(res.droppedSentences).toHaveLength(2);
  });

  it('refuses without calling the model when there are no sources', async () => {
    const { service, llm } = build([{ match: 'anything', reply: 'Sure, do the thing.' }]);
    const res = await service.answer('Anything at all', [], 'full');

    expect(res.status).toBe('refused');
    expect(res.refusalReason).toBe(REFUSAL_MESSAGE);
    expect(llm.callCount).toBe(0);
  });

  it('fails loudly when the scripted model has no reply for the question', async () => {
    const { service } = build([{ match: 'kindle', reply: CORRECT_KINDLE }]);

    await expect(service.answer('What is the weather like?', ALL_WIKI_PAGES)).rejects.toThrow(/no scripted reply/);
  });
});

describe('grounding gate', () => {
  it('catches a quantity error exactly: 5 shards fails when the sources say 4', () => {
    const verdict = isSentenceGrounded('You need 5 ember shards.', [EMBER_ALTAR_PAGE, MIREFEN_PAGE]);

    expect(verdict.grounded).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/quantity "5 ember shards" is not stated in any source/);
  });

  it('accepts the quantity the sources actually state', () => {
    const verdict = isSentenceGrounded('You need 4 ember shards.', [EMBER_ALTAR_PAGE, MIREFEN_PAGE]);

    expect(verdict.grounded).toBe(true);
    expect(verdict.reasons).toEqual([]);
  });

  it('rejects invented item names even in a fluent sentence', () => {
    const verdict = isSentenceGrounded(FAKE_ITEM_SENTENCE, ALL_WIKI_PAGES);

    expect(verdict.grounded).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/name "Moonblade" does not appear in any source/);
  });

  it('refuses end to end when the only reply carries the wrong quantity', async () => {
    const { service } = build([{ match: 'kindle', reply: 'You need 5 ember shards.' }]);
    const res = await service.answer(KINDLE_QUESTION, ALL_WIKI_PAGES, 'full');

    expect(res.status).toBe('refused');
    expect(res.droppedSentences).toEqual(['You need 5 ember shards.']);
  });
});

describe('hint mode', () => {
  it('redacts boss names, place names and unknown quantities from the grounded answer', async () => {
    const { service } = build([{ match: 'What do', reply: NEXT_REPLY }]);
    const res = await service.answer(NEXT_QUESTION, ALL_WIKI_PAGES, 'hint');

    expect(res.status).toBe('answered');
    expect(res.mode).toBe('hint');
    expect(res.text).toBe(EXPECTED_HINT);
    expect(res.text).not.toContain('Mirefen');
    expect(res.text).not.toContain('Duskfang');
    expect(res.text).not.toContain('4 ember shards');
  });

  it('is derived from the full answer by redaction, with one model call per answer', async () => {
    const { service, llm } = build([{ match: 'What do', reply: NEXT_REPLY }]);
    const full = await service.answer(NEXT_QUESTION, ALL_WIKI_PAGES, 'full');
    const hint = await service.answer(NEXT_QUESTION, ALL_WIKI_PAGES, 'hint');

    expect(llm.callCount).toBe(2);
    expect(full.text).toBe(NEXT_REPLY);
    expect(redactToHint(full.text, NEXT_QUESTION)).toBe(hint.text);
    expect(hint.text).not.toBe(full.text);
  });

  it('keeps a quantity the player already mentioned', async () => {
    const question = 'I have 4 ember shards. What do I do next?';
    const { service } = build([{ match: 'What do', reply: 'You need 4 ember shards in all.' }]);
    const res = await service.answer(question, ALL_WIKI_PAGES, 'hint');

    expect(res.status).toBe('answered');
    expect(res.text).toBe('You need 4 ember shards in all.');
  });
});
