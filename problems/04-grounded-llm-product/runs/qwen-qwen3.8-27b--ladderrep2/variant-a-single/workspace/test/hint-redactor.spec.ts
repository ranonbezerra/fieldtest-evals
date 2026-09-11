import { describe, expect, it } from 'vitest';

import { HintRedactor } from '../src/answer/hint-redactor.js';

const redactor = new HintRedactor();

describe('HintRedactor.redact', () => {
  it('removes a boss name, a location and a quantity in one sentence', () => {
    const out = redactor.redact(
      'The Hollow Matriarch guards the Dusk Caverns and demands four ember shards.',
      'How do I progress?',
    );
    expect(out).not.toContain('Hollow Matriarch');
    expect(out).not.toContain('Dusk Caverns');
    expect(out).not.toMatch(/\bfour\b/i);
    expect(out).not.toMatch(/\b4\b/);
    expect(out).toBe('The [redacted] guards the [redacted] and demands [redacted] ember shards.');
  });

  it('redacts digit quantities too', () => {
    const out = redactor.redact('Place 4 ember shards on the braziers.', 'How do I open it?');
    expect(out).toBe('Place [redacted] ember shards on the braziers.');
  });

  it('keeps quantities the player already mentioned', () => {
    const out = redactor.redact(
      'Bring the three ember shards to the Hollow Vale.',
      'I already have three shards. What now?',
    );
    expect(out).toContain('three');
    expect(out).not.toContain('Hollow Vale');
    expect(out).toBe('Bring the three ember shards to the [redacted].');
  });

  it('does not over-redact common-case wording', () => {
    const out = redactor.redact('Place the ember shards on the braziers.', 'How do I open it?');
    expect(out).toContain('ember shards');
    expect(out).toContain('braziers');
    expect(out).not.toContain('[redacted]');
  });
});
