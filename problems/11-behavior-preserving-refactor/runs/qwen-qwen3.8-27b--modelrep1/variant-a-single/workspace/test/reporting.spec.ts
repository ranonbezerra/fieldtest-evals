// Characterization tests for the reporting copy (scripts/reporting.ts).
//
// Written against the copy's historical output BEFORE the mapping was
// extracted into src/shared/payment-status.mapper.ts, pinning the nightly
// CSV's status column (consumed by finance spreadsheets since 2021).
// The upper-cased 'FAILED' for DECLINED/EXPIRED is a load-bearing quirk,
// not a typo: finance's sheet filters on it. See NOTES.md.
import { describe, expect, it } from 'vitest';
import { buildRows, mapProviderStatus } from '../scripts/reporting.js';

describe('reporting status mapping (characterization)', () => {
  it('maps every code the reporting copy historically knew', () => {
    expect(mapProviderStatus('PENDING')).toBe('pending');
    expect(mapProviderStatus('AWAITING_PAYMENT')).toBe('pending');
    expect(mapProviderStatus('AUTHORIZED')).toBe('authorized');
    expect(mapProviderStatus('CAPTURED')).toBe('paid');
    expect(mapProviderStatus('SETTLED')).toBe('paid');
    expect(mapProviderStatus('REFUNDED')).toBe('refunded');
    expect(mapProviderStatus('PARTIAL_REFUND')).toBe('refunded');
    expect(mapProviderStatus('CHARGEBACK')).toBe('chargeback');
  });

  it('keeps the legacy quirk: DECLINED and EXPIRED are upper-cased FAILED', () => {
    expect(mapProviderStatus('DECLINED')).toBe('FAILED');
    expect(mapProviderStatus('EXPIRED')).toBe('FAILED');
  });

  it('maps the payout-specific codes now that the shared mapper covers the union', () => {
    // Unknown to the old reporting copy (dropped from the CSV); the union
    // mapper knows them, so they now appear. See NOTES.md.
    expect(mapProviderStatus('PAYOUT_SETTLED')).toBe('paid');
    expect(mapProviderStatus('PAYOUT_REVERSED')).toBe('refunded');
  });

  it('returns null for codes outside the union, as before', () => {
    expect(mapProviderStatus('WHATEVER')).toBeNull();
    expect(mapProviderStatus('')).toBeNull();
  });
});

describe('reporting buildRows (characterization)', () => {
  it('emits one row per known payment, keeping reference and amount', () => {
    expect(
      buildRows([
        { reference: 'ref-1', providerStatus: 'CAPTURED', amountMinor: 1500 },
        { reference: 'ref-2', providerStatus: 'DECLINED', amountMinor: 200 },
      ]),
    ).toEqual([
      { reference: 'ref-1', status: 'paid', amountMinor: 1500 },
      { reference: 'ref-2', status: 'FAILED', amountMinor: 200 },
    ]);
  });

  it('silently skips payments whose code is outside the union', () => {
    expect(
      buildRows([
        { reference: 'ref-1', providerStatus: 'NOT_A_CODE', amountMinor: 10 },
        { reference: 'ref-2', providerStatus: 'SETTLED', amountMinor: 20 },
      ]),
    ).toEqual([{ reference: 'ref-2', status: 'paid', amountMinor: 20 }]);
  });
});
