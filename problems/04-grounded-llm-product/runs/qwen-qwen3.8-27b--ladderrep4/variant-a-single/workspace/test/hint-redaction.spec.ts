import { describe, expect, it } from 'vitest';
import { REDACTED, redactForHint } from '../src/guide/redaction';

describe('hint redaction', () => {
  it('removes a boss name, a location and an unmentioned quantity from one sentence', () => {
    const sentence = 'Defeat Gloomwing in the Emberfall Hollow before you spend 5 sunshard keys.';
    const hint = redactForHint(sentence, 'What should I do before the trial?');
    expect(hint).not.toContain('Gloomwing');
    expect(hint).not.toContain('Emberfall');
    expect(hint).not.toContain('Hollow');
    expect(hint).not.toContain('5');
    expect(hint).toContain(REDACTED);
  });

  it('keeps a quantity the player already mentioned in the question', () => {
    const hint = redactForHint(
      'The altar asks for 4 sunshard keys in Emberfall Hollow.',
      'I already have 4 sunshard keys. What next?',
    );
    expect(hint).toContain('4 sunshard keys');
    expect(hint).not.toContain('Emberfall');
  });

  it('redacts number-word quantities the question did not mention', () => {
    const hint = redactForHint('You need five sunshard keys for the altar.', 'What does the altar ask for?');
    expect(hint).not.toContain('five');
    expect(hint).toContain(`${REDACTED} sunshard keys`);
  });

  it('redacts names even when the player named them', () => {
    const hint = redactForHint(
      'Bring 4 sunshard keys to the altar in Emberfall Hollow to unlock the trial of Gloomwing.',
      'How do I unlock the trial of Gloomwing?',
    );
    expect(hint).not.toContain('Gloomwing');
    expect(hint).not.toContain('Emberfall Hollow');
    expect(hint).toContain('sunshard keys');
  });
});
