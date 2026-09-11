import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { WIKI_PAGES } from '../src/eval/golden-scenarios.js';
import { REFUSAL_TEXT } from '../src/guide/answer-result.js';
import { checkSentence, filterGroundedSentences } from '../src/guide/grounding-gate.js';
import { redactForHint } from '../src/guide/hint-redaction.js';
import { ScriptedLlmClient } from '../src/guide/llm-client.js';
import { GuideService } from '../src/guide/guide.service.js';

const GATE_SOURCES = [WIKI_PAGES.emberSanctum, WIKI_PAGES.cinderGate];
const ALL_SOURCES = [WIKI_PAGES.emberSanctum, WIKI_PAGES.hollowKing, WIKI_PAGES.cinderGate];

const makeGuide = (answers: Record<string, string>): GuideService =>
  new GuideService(new ScriptedLlmClient(answers));

describe('GuideService.answer — grounding gate', () => {
  it('keeps grounded sentences and drops ungrounded ones', async () => {
    const question = 'What does the Cinder Gate require?';
    const guide = makeGuide({
      [question]: 'The Cinder Gate requires four Ember Shards. Feed the gate two Ashen Keys.',
    });

    const result = await guide.answer(question, GATE_SOURCES, 'full');

    expect(result.status).toBe('answered');
    expect(result.keptSentences).toEqual(['The Cinder Gate requires four Ember Shards.']);
    expect(result.droppedSentences).toEqual(['Feed the gate two Ashen Keys.']);
    expect(result.text).toBe('The Cinder Gate requires four Ember Shards.');
  });

  it('refuses with the exact phrase when nothing is grounded', async () => {
    const question = 'What does the Cinder Gate require?';
    const guide = makeGuide({
      [question]: 'Feed three Moonstone Amulets to the altar. It works.',
    });

    const result = await guide.answer(question, GATE_SOURCES, 'full');

    expect(result.status).toBe('refused');
    expect(result.text).toBe(REFUSAL_TEXT);
    expect(result.text).toBe('not covered by my sources');
    expect(result.keptSentences).toEqual([]);
    expect(result.droppedSentences).toHaveLength(2);
  });

  it('makes exactly one LLM call, and hint mode is a redaction of that same grounded answer', async () => {
    const question = 'How many Ember Shards do I need for the Cinder Gate?';
    const script: Record<string, string> = {
      [question]: 'Four Ember Shards are required. The Cinder Gate accepts no other offering.',
    };

    const full = await new GuideService(new ScriptedLlmClient(script)).answer(
      question,
      GATE_SOURCES,
      'full',
    );
    const hintClient = new ScriptedLlmClient(script);
    const hint = await new GuideService(hintClient).answer(question, GATE_SOURCES, 'hint');

    expect(hintClient.calls).toHaveLength(1); // no second generation
    expect(hint.status).toBe('answered');
    expect(hint.text).toBe(redactForHint(full.text, question)); // derived, not re-prompted
  });
});

describe('GuideService.answer — hint mode', () => {
  it('removes the boss name, the location and the unmentioned quantity', async () => {
    const question = 'How do I beat the boss?';
    const guide = makeGuide({
      [question]:
        'The Hollow King guards the Ember Sanctum behind the Cinder Gate. It takes four Ember Shards.',
    });

    const result = await guide.answer(question, ALL_SOURCES, 'hint');

    expect(result.status).toBe('answered');
    expect(result.text.toLowerCase()).not.toMatch(/hollow|king|ember|sanctum|cinder|gate|four|\b4\b/);
  });

  it('keeps a quantity the player already mentioned, still redacting the name', async () => {
    const question = 'Do I need four shards for the gate?';
    const guide = makeGuide({ [question]: 'You need four Ember Shards.' });

    const result = await guide.answer(question, [WIKI_PAGES.emberSanctum], 'hint');

    expect(result.text).toMatch(/four/);
    expect(result.text.toLowerCase()).not.toContain('ember');
  });
});

describe('grounding gate', () => {
  it('catches a quantity error exactly: "five" fails where the sources say four, "four" passes', () => {
    const wrong = checkSentence("Five Ember Shards power the sanctum's altar.", [
      WIKI_PAGES.emberSanctum,
    ]);
    expect(wrong.grounded).toBe(false);
    expect(wrong.missing).toContain('5');

    const right = checkSentence("Four Ember Shards power the sanctum's altar.", [
      WIKI_PAGES.emberSanctum,
    ]);
    expect(right.grounded).toBe(true);

    const filtered = filterGroundedSentences(
      "Five Ember Shards power the sanctum's altar. Four Ember Shards power the sanctum's altar.",
      [WIKI_PAGES.emberSanctum],
    );
    expect(filtered.kept).toEqual(["Four Ember Shards power the sanctum's altar."]);
    expect(filtered.dropped).toEqual(["Five Ember Shards power the sanctum's altar."]);
  });

  it('drops an invented item requirement', () => {
    const verdict = checkSentence('Bring two Ashen Keys to the shrine.', GATE_SOURCES);
    expect(verdict.grounded).toBe(false);
    expect(verdict.missing).toEqual(expect.arrayContaining(['2', 'shrine']));
  });
});

describe('hint redaction', () => {
  it('removes a boss name, a location and a quantity from a single sentence', () => {
    const redacted = redactForHint(
      'The Hollow King waits in the Ember Sanctum and it takes four Ember Shards.',
      'I need a nudge without spoilers.',
    );

    expect(redacted.toLowerCase()).not.toMatch(/hollow|king|ember|sanctum|four|\b4\b/);
  });
});
