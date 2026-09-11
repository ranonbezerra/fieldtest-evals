import { describe, expect, it } from 'vitest';
import { REFUSAL_TEXT } from '../src/guide/answer.types';
import { gateAnswer } from '../src/guide/grounding';

const KEY_SOURCES = [
  'Bring 4 sunshard keys to the altar in Emberfall Hollow to unlock the trial of Gloomwing. The altar will not accept a partial set.',
  'Collect sunshard keys from the vault in Sunspire Cathedral. The vault opens during the blue moon.',
];

const ALTAR_SOURCES = [
  'The altar in Emberfall Hollow asks for 4 sunshard keys, no more and no less. The altar will not accept a partial set.',
];

describe('grounding gate', () => {
  it('keeps sentences the sources support and drops the invented ones', () => {
    const result = gateAnswer(
      'Bring 4 sunshard keys to the altar in Emberfall Hollow. Forge a Moonstone Sigil first. The vault opens during the blue moon.',
      KEY_SOURCES,
    );
    expect(result.refused).toBe(false);
    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toEqual(['Forge a Moonstone Sigil first.']);
    expect(result.text).not.toContain('Moonstone Sigil');
    expect(result.text).toContain('Bring 4 sunshard keys');
    expect(result.text).toContain('blue moon');
  });

  it('refuses with the exact standard message when nothing survives', () => {
    const result = gateAnswer(
      'You tame the river serpents by feeding them moonlit eels at dawn.',
      KEY_SOURCES,
    );
    expect(result.refused).toBe(true);
    expect(result.text).toBe(REFUSAL_TEXT);
    expect(result.dropped).toHaveLength(1);
  });

  it('catches a quantity error exactly: 5 against a source that says 4', () => {
    const wrong = gateAnswer('The altar asks for 5 sunshard keys, no more and no less.', ALTAR_SOURCES);
    expect(wrong.refused).toBe(true);
    expect(wrong.text).toBe(REFUSAL_TEXT);
    expect(wrong.dropped[0]).toContain('5 sunshard keys');

    // The same sentence with the sources' own number survives: the check is
    // exact, not "some number near some number".
    const right = gateAnswer('The altar asks for 4 sunshard keys, no more and no less.', ALTAR_SOURCES);
    expect(right.refused).toBe(false);
    expect(right.text).toContain('4 sunshard keys');
  });

  it('treats number words and digits as the same quantity', () => {
    const result = gateAnswer('The altar asks for four sunshard keys, no more and no less.', ALTAR_SOURCES);
    expect(result.refused).toBe(false);
    expect(result.text).toContain('four sunshard keys');
  });

  it('drops a sentence whose location name the sources never mention', () => {
    const result = gateAnswer('The trial takes place in Frostpeak Sanctum.', KEY_SOURCES);
    expect(result.refused).toBe(true);
    expect(result.dropped[0]).toContain('Frostpeak Sanctum');
  });
});
