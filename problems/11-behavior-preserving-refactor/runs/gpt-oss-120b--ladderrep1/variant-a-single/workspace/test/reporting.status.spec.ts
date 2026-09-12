import { describe, expect, it } from 'vitest';
import { mapProviderStatus, buildRows } from '../scripts/reporting.js';

describe('reporting status mapping (characterisation)', () => {
  it('maps pending codes to "pending"', () => {
    expect(mapProviderStatus('PENDING')).toBe('pending');
    expect(mapProviderStatus('AWAITING_PAYMENT')).toBe('pending');
  });

  it('maps authorized code to "authorized"', () => {
    expect(mapProviderStatus('AUTHORIZED')).toBe('authorized');
  });

  it('maps settled codes to "paid"', () => {
    expect(mapProviderStatus('CAPTURED')).toBe('paid');
    expect(mapProviderStatus('SETTLED')).toBe('paid');
  });

  it('maps refund codes to "refunded"', () => {
    expect(mapProviderStatus('REFUNDED')).toBe('refunded');
    expect(mapProviderStatus('PARTIAL_REFUND')).toBe('refunded');
  });

  it('maps failed codes to upper‑cased "FAILED"', () => {
    expect(mapProviderStatus('DECLINED')).toBe('FAILED');
    expect(mapProviderStatus('EXPIRED')).toBe('FAILED');
  });

  it('maps chargeback to "chargeback"', () => {
    expect(mapProviderStatus('CHARGEBACK')).toBe('chargeback');
  });

  it('returns null for unknown codes', () => {
    expect(mapProviderStatus('UNKNOWN_CODE')).toBeNull();
  });

  it('buildRows skips rows with unknown status', () => {
    const payments = [
      { reference: 'a', providerStatus: 'CAPTURED', amountMinor: 100 },
      { reference: 'b', providerStatus: 'UNKNOWN_CODE', amountMinor: 200 },
    ];
    const rows = buildRows(payments);
    expect(rows).toEqual([
      { reference: 'a', status: 'paid', amountMinor: 100 },
    ]);
  });
});
