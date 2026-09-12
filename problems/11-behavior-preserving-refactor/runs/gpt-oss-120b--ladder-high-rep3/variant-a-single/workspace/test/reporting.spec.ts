import { describe, it, expect } from 'vitest';
import { mapProviderStatus } from '../scripts/reporting.js';

describe('reporting status mapping (characterization)', () => {
  it('maps pending‑like codes to "pending"', () => {
    expect(mapProviderStatus('PENDING')).toBe('pending');
    expect(mapProviderStatus('AWAITING_PAYMENT')).toBe('pending');
  });

  it('maps authorized to "authorized"', () => {
    expect(mapProviderStatus('AUTHORIZED')).toBe('authorized');
  });

  it('maps settled‑like codes to "paid"', () => {
    expect(mapProviderStatus('CAPTURED')).toBe('paid');
    expect(mapProviderStatus('SETTLED')).toBe('paid');
  });

  it('maps refund‑like codes to "refunded"', () => {
    expect(mapProviderStatus('REFUNDED')).toBe('refunded');
    expect(mapProviderStatus('PARTIAL_REFUND')).toBe('refunded');
  });

  it('maps decline/expires to uppercase "FAILED"', () => {
    expect(mapProviderStatus('DECLINED')).toBe('FAILED');
    expect(mapProviderStatus('EXPIRED')).toBe('FAILED');
  });

  it('maps chargeback to "chargeback"', () => {
    expect(mapProviderStatus('CHARGEBACK')).toBe('chargeback');
  });

  it('returns null for unknown provider codes', () => {
    expect(mapProviderStatus('UNKNOWN_CODE')).toBeNull();
  });
});
