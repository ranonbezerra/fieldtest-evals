// Characterization tests for the nightly reporting copy of the
// provider-status mapping (scripts/reporting.ts).
//
// These were written BEFORE the mapping was extracted into
// src/shared/payment-status.mapper.ts (see NOTES.md): the reporting copy
// was the one with no tests and the behaviour the CSV depends on. They pin
// its exact pre-move output for every status it knew — including the
// upper-cased 'FAILED' quirk — plus its silent-skip of unknown codes. They
// pass unmodified on both sides of the move.
//
// The two payout-only codes (PAYOUT_SETTLED, PAYOUT_REVERSED) are
// deliberately not pinned: the report did not know them (it skipped them),
// and the extraction moves them into the shared table on purpose — see the
// "union table" note in NOTES.md.

import { describe, expect, it } from 'vitest';
import { buildRows, mapProviderStatus } from '../scripts/reporting.js';

describe('reporting: provider-status mapping (characterization)', () => {
  it('maps each status it knew, exactly as before the extraction', () => {
    expect(mapProviderStatus('PENDING')).toBe('pending');
    expect(mapProviderStatus('AWAITING_PAYMENT')).toBe('pending');
    expect(mapProviderStatus('AUTHORIZED')).toBe('authorized');
    expect(mapProviderStatus('CAPTURED')).toBe('paid');
    expect(mapProviderStatus('SETTLED')).toBe('paid');
    expect(mapProviderStatus('REFUNDED')).toBe('refunded');
    expect(mapProviderStatus('PARTIAL_REFUND')).toBe('refunded');
    expect(mapProviderStatus('CHARGEBACK')).toBe('chargeback');
  });

  it('upper-cases exactly the failed status (the quirk the finance sheets depend on)', () => {
    expect(mapProviderStatus('DECLINED')).toBe('FAILED');
    expect(mapProviderStatus('EXPIRED')).toBe('FAILED');
  });

  it('returns null for a provider code it does not know', () => {
    expect(mapProviderStatus('WHATEVER')).toBeNull();
  });
});

describe('reporting: buildRows (characterization)', () => {
  it('emits one row per known payment, in input order, with the mapped status', () => {
    const rows = buildRows([
      { reference: 'r-1', providerStatus: 'PENDING', amountMinor: 100 },
      { reference: 'r-2', providerStatus: 'DECLINED', amountMinor: 250 },
      { reference: 'r-3', providerStatus: 'PARTIAL_REFUND', amountMinor: 300 },
      { reference: 'r-4', providerStatus: 'CHARGEBACK', amountMinor: 40 },
    ]);
    expect(rows).toEqual([
      { reference: 'r-1', status: 'pending', amountMinor: 100 },
      { reference: 'r-2', status: 'FAILED', amountMinor: 250 },
      { reference: 'r-3', status: 'refunded', amountMinor: 300 },
      { reference: 'r-4', status: 'chargeback', amountMinor: 40 },
    ]);
  });

  it('silently skips payments whose provider code it does not know', () => {
    const rows = buildRows([
      { reference: 'r-1', providerStatus: 'SETTLED', amountMinor: 100 },
      { reference: 'r-2', providerStatus: 'NO_SUCH_CODE', amountMinor: 200 },
      { reference: 'r-3', providerStatus: 'AWAITING_PAYMENT', amountMinor: 300 },
    ]);
    expect(rows).toEqual([
      { reference: 'r-1', status: 'paid', amountMinor: 100 },
      { reference: 'r-3', status: 'pending', amountMinor: 300 },
    ]);
  });

  it('returns an empty list when every payment is unknown', () => {
    expect(
      buildRows([
        { reference: 'r-1', providerStatus: 'NO_SUCH_CODE', amountMinor: 1 },
        { reference: 'r-2', providerStatus: 'ALSO_UNKNOWN', amountMinor: 2 },
      ]),
    ).toEqual([]);
  });
});
