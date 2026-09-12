import { describe, it, expect } from 'vitest';
import { mapProviderStatus } from '../scripts/reporting.js';

describe('reporting status mapping', () => {
  const cases: Array<[string, string | null]> = [
    ['PENDING', 'pending'],
    ['AWAITING_PAYMENT', 'pending'],
    ['AUTHORIZED', 'authorized'],
    ['CAPTURED', 'paid'],
    ['SETTLED', 'paid'],
    ['REFUNDED', 'refunded'],
    ['PARTIAL_REFUND', 'refunded'],
    ['DECLINED', 'FAILED'],
    ['EXPIRED', 'FAILED'],
    ['CHARGEBACK', 'chargeback'],
  ];

  for (const [code, expected] of cases) {
    it(`maps ${code} → ${expected}`, () => {
      expect(mapProviderStatus(code)).toBe(expected);
    });
  }

  it('returns null for an unknown provider status', () => {
    expect(mapProviderStatus('WHATEVER')).toBeNull();
  });
});
