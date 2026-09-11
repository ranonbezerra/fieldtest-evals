// Characterization tests for the reporting copy of the status mapping
// (scripts/reporting.ts), written BEFORE the extraction into
// src/shared/payment-status.mapper.ts.
//
// They pin the reporting script's current output for every provider code it
// maps -- including the 'FAILED' upper-casing quirk the finance CSV
// consumers depend on -- and its behaviour for codes it does not know.
//
// Note: the two payout-only codes (PAYOUT_SETTLED, PAYOUT_REVERSED) are
// deliberately NOT pinned here. Before the extraction the reporting copy
// did not know them (it would have skipped the rows), but the shared mapper
// covers the union of all call sites' codes, so after the extraction they
// map to 'paid' / 'refunded'. See NOTES.md.

import { describe, expect, it } from 'vitest';
import { buildRows, mapProviderStatus } from '../scripts/reporting.js';

describe('reporting status mapping (characterization)', () => {
  it('maps every provider code it knows to the exact string the CSV carries', () => {
    expect(mapProviderStatus('PENDING')).toBe('pending');
    expect(mapProviderStatus('AWAITING_PAYMENT')).toBe('pending');
    expect(mapProviderStatus('AUTHORIZED')).toBe('authorized');
    expect(mapProviderStatus('CAPTURED')).toBe('paid');
    expect(mapProviderStatus('SETTLED')).toBe('paid');
    expect(mapProviderStatus('REFUNDED')).toBe('refunded');
    expect(mapProviderStatus('PARTIAL_REFUND')).toBe('refunded');
    expect(mapProviderStatus('CHARGEBACK')).toBe('chargeback');
  });

  it("upper-cases the failed codes to 'FAILED' (the legacy report casing)", () => {
    // finance's sheet filters on the upper-cased value in this column
    expect(mapProviderStatus('DECLINED')).toBe('FAILED');
    expect(mapProviderStatus('EXPIRED')).toBe('FAILED');
  });

  it('returns null for a provider code it does not know', () => {
    expect(mapProviderStatus('NEVER_SEEN_BY_ANY_COPY')).toBeNull();
    expect(mapProviderStatus('')).toBeNull();
  });
});

describe('reporting buildRows (characterization)', () => {
  it('drops the rows for unknown codes and keeps the rest unchanged', () => {
    const rows = buildRows([
      { reference: 'ord_100', providerStatus: 'CAPTURED', amountMinor: 12500 },
      { reference: 'ord_101', providerStatus: 'NEVER_SEEN_BY_ANY_COPY', amountMinor: 990 },
      { reference: 'ord_102', providerStatus: 'DECLINED', amountMinor: 3200 },
      { reference: 'ord_103', providerStatus: 'AWAITING_PAYMENT', amountMinor: 75 },
    ]);

    expect(rows).toEqual([
      { reference: 'ord_100', status: 'paid', amountMinor: 12500 },
      { reference: 'ord_102', status: 'FAILED', amountMinor: 3200 },
      { reference: 'ord_103', status: 'pending', amountMinor: 75 },
    ]);
  });
});
