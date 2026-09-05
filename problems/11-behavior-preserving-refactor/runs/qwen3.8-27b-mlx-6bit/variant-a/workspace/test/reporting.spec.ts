import { describe, it, expect } from 'vitest';
import { PaymentStatusMapper } from '../src/shared/payment-status-mapper';

// Characterization tests for the reporting call site.
// These pin the current output of the reporting status mapper, including
// the legacyReportCasing quirk (completed → 'COMPLETED') and the skip-on-unknown behavior.

const mapper = new PaymentStatusMapper({
  unknownPolicy: 'skip',
  legacyReportCasing: true,
});

describe('reporting status mapper (characterization)', () => {
  it('maps pending to pending', () => {
    expect(mapper.map('pending')).toBe('pending');
  });

  it('maps completed to COMPLETED (legacy quirk)', () => {
    expect(mapper.map('completed')).toBe('COMPLETED');
  });

  it('maps failed to failed', () => {
    expect(mapper.map('failed')).toBe('failed');
  });

  it('maps refunded to refunded', () => {
    expect(mapper.map('refunded')).toBe('refunded');
  });

  it('skips unknown codes (returns undefined)', () => {
    // ASSUMPTION: the test runner's expect type does not expose toBeUndefined;
    // using toBe(undefined) which is equivalent and available.
    expect(mapper.map('zzz')).toBe(undefined);
  });

  it('maps payout_initiated to pending', () => {
    expect(mapper.map('payout_initiated')).toBe('pending');
  });

  it('maps payout_settled to COMPLETED (legacy quirk applies)', () => {
    expect(mapper.map('payout_settled')).toBe('COMPLETED');
  });
});
