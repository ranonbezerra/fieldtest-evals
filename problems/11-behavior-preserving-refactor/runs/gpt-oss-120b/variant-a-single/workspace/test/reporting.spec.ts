import { describe, expect, it } from 'vitest';
import { mapProviderStatus, buildRows } from '../scripts/reporting.js';

describe('reporting status mapping (characterization)', () => {
  it('maps pending codes to "pending"', () => {
    expect(mapProviderStatus('PENDING')).toBe('pending');
    expect(mapProviderStatus('AWAITING_PAYMENT')).toBe('pending');
  });

  it('maps authorized code to "authorized"', () => {
    expect(mapProviderStatus('AUTHORIZED')).toBe('authorized');
  });

  it('maps settled/paid codes to "paid"', () => {
    expect(mapProviderStatus('CAPTURED')).toBe('paid');
    expect(mapProviderStatus('SETTLED')).toBe('paid');
    expect(mapProviderStatus('PAYOUT_SETTLED')).toBe('paid');
  });

  it('maps refund codes to "refunded"', () => {
    expect(mapProviderStatus('REFUNDED')).toBe('refunded');
    expect(mapProviderStatus('PARTIAL_REFUND')).toBe('refunded');
    expect(mapProviderStatus('PAYOUT_REVERSED')).toBe('refunded');
  });

  it('maps declined/expired to upper‑cased "FAILED" (legacy quirk)', () => {
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

describe('buildRows skips payments with unknown status', () => {
  it('filters out rows whose status is null', () => {
    const payments = [
      { reference: 'a', providerStatus: 'CAPTURED', amountMinor: 100 },
      { reference: 'b', providerStatus: 'UNKNOWN_CODE', amountMinor: 200 },
    ];
    const rows = buildRows(payments);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      reference: 'a',
      status: 'paid',
      amountMinor: 100,
    });
  });
});
