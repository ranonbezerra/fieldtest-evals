import { describe, expect, it } from 'vitest';
import { mapProviderStatus } from '../scripts/reporting.js';

describe('reporting status mapping (characterization)', () => {
  it('maps pending codes to pending', () => {
    expect(mapProviderStatus('PENDING')).toBe('pending');
    expect(mapProviderStatus('AWAITING_PAYMENT')).toBe('pending');
  });

  it('maps authorized code to authorized', () => {
    expect(mapProviderStatus('AUTHORIZED')).toBe('authorized');
  });

  it('maps settled codes to paid', () => {
    expect(mapProviderStatus('CAPTURED')).toBe('paid');
    expect(mapProviderStatus('SETTLED')).toBe('paid');
  });

  it('maps refund codes to refunded', () => {
    expect(mapProviderStatus('REFUNDED')).toBe('refunded');
    expect(mapProviderStatus('PARTIAL_REFUND')).toBe('refunded');
  });

  it('maps declined and expired to FAILED (legacy casing)', () => {
    expect(mapProviderStatus('DECLINED')).toBe('FAILED');
    expect(mapProviderStatus('EXPIRED')).toBe('FAILED');
  });

  it('maps chargeback to chargeback', () => {
    expect(mapProviderStatus('CHARGEBACK')).toBe('chargeback');
  });

  it('returns null for unknown provider status', () => {
    expect(mapProviderStatus('WHATEVER')).toBeNull();
    // Payout‑specific codes are unknown to the reporting script.
    expect(mapProviderStatus('PAYOUT_SETTLED')).toBeNull();
    expect(mapProviderStatus('PAYOUT_REVERSED')).toBeNull();
  });
});
