import { describe, expect, it } from 'vitest';
import { mapProviderStatus, buildRows } from '../scripts/reporting.js';

describe('reporting status mapping', () => {
  it('maps pending codes', () => {
    expect(mapProviderStatus('PENDING')).toBe('pending');
    expect(mapProviderStatus('AWAITING_PAYMENT')).toBe('pending');
  });

  it('maps authorized', () => {
    expect(mapProviderStatus('AUTHORIZED')).toBe('authorized');
  });

  it('maps captured and settled to paid', () => {
    expect(mapProviderStatus('CAPTURED')).toBe('paid');
    expect(mapProviderStatus('SETTLED')).toBe('paid');
  });

  it('maps refund codes to refunded', () => {
    expect(mapProviderStatus('REFUNDED')).toBe('refunded');
    expect(mapProviderStatus('PARTIAL_REFUND')).toBe('refunded');
  });

  it('applies legacy report casing for declined (quirk)', () => {
    expect(mapProviderStatus('DECLINED')).toBe('FAILED');
  });

  it('applies legacy report casing for expired (quirk)', () => {
    expect(mapProviderStatus('EXPIRED')).toBe('FAILED');
  });

  it('maps chargeback', () => {
    expect(mapProviderStatus('CHARGEBACK')).toBe('chargeback');
  });

  it('returns null for unknown codes', () => {
    expect(mapProviderStatus('WHATEVER')).toBeNull();
  });

  it('buildRows skips rows whose provider status maps to null', () => {
    const rows = buildRows([
      { reference: 'R1', providerStatus: 'CAPTURED', amountMinor: 100 },
      { reference: 'R2', providerStatus: 'WHATEVER', amountMinor: 200 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ reference: 'R1', status: 'paid', amountMinor: 100 });
  });
});
