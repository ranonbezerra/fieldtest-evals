// Characterization tests for the reporting copy (scripts/reporting.ts).
//
// Written BEFORE the mapping was extracted to
// src/shared/payment-status-mapper.ts, pinning the reporting copy's current
// output for every provider status -- including the 'FAILED' casing quirk
// the finance CSV has depended on since 2021, and the silent skip of codes
// the copy does not know (including the payout-only codes, which it never
// learned).
//
// If any of these change as a result of the extraction, the CSV format
// changed: that is a behaviour change, not a refactor.

import { describe, expect, it } from 'vitest';
import { buildRows, mapProviderStatus } from '../scripts/reporting.js';

describe('reporting provider-status mapping (characterization, pre-extraction)', () => {
  it('maps every status the copy knows today, exactly as it does today', () => {
    expect(mapProviderStatus('PENDING')).toBe('pending');
    expect(mapProviderStatus('AWAITING_PAYMENT')).toBe('pending');
    expect(mapProviderStatus('AUTHORIZED')).toBe('authorized');
    expect(mapProviderStatus('CAPTURED')).toBe('paid');
    expect(mapProviderStatus('SETTLED')).toBe('paid');
    expect(mapProviderStatus('REFUNDED')).toBe('refunded');
    expect(mapProviderStatus('PARTIAL_REFUND')).toBe('refunded');
    expect(mapProviderStatus('CHARGEBACK')).toBe('chargeback');
  });

  it('emits the upper-cased FAILED for the two failure statuses (the quirk)', () => {
    // orders and payouts emit 'failed'; the report must keep 'FAILED'.
    expect(mapProviderStatus('DECLINED')).toBe('FAILED');
    expect(mapProviderStatus('EXPIRED')).toBe('FAILED');
  });

  it('returns null for codes it does not know, including the payout-only codes', () => {
    // The reporting copy predates the payout codes and never learned them.
    // That drift is preserved on purpose, not unified.
    expect(mapProviderStatus('PAYOUT_SETTLED')).toBeNull();
    expect(mapProviderStatus('PAYOUT_REVERSED')).toBeNull();
    expect(mapProviderStatus('NOT_A_PROVIDER_CODE')).toBeNull();
  });

  it('buildRows keeps the rows it can map, in input order', () => {
    const rows = buildRows([
      { reference: 'r1', providerStatus: 'SETTLED', amountMinor: 12050 },
      { reference: 'r2', providerStatus: 'PENDING', amountMinor: 300 },
      { reference: 'r3', providerStatus: 'EXPIRED', amountMinor: 900 },
    ]);
    expect(rows).toEqual([
      { reference: 'r1', status: 'paid', amountMinor: 12050 },
      { reference: 'r2', status: 'pending', amountMinor: 300 },
      { reference: 'r3', status: 'FAILED', amountMinor: 900 },
    ]);
  });

  it('buildRows skips the rows it cannot map', () => {
    const rows = buildRows([
      { reference: 'r1', providerStatus: 'SETTLED', amountMinor: 1000 },
      { reference: 'r2', providerStatus: 'PAYOUT_SETTLED', amountMinor: 2000 },
      { reference: 'r3', providerStatus: 'NOT_A_PROVIDER_CODE', amountMinor: 3000 },
    ]);
    expect(rows).toEqual([{ reference: 'r1', status: 'paid', amountMinor: 1000 }]);
  });

  it('buildRows returns an empty report for empty or fully unmappable input', () => {
    expect(buildRows([])).toEqual([]);
    expect(buildRows([{ reference: 'r1', providerStatus: 'GIBBERISH', amountMinor: 1 }])).toEqual([]);
  });
});
