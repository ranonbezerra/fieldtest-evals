// Characterization tests for the reporting copy of the provider status
// mapping (scripts/reporting.ts). Written before the extraction to
// PaymentStatusMapper, against the pre-extraction copy, to pin its current
// output for every status it knows — including the upper-cased 'FAILED' the
// finance CSV consumers filter on — and its silent-skip behaviour for
// unknown codes. They must keep passing, unmodified, after the extraction.

import { describe, expect, it } from 'vitest';
import { buildRows, mapProviderStatus } from '../scripts/reporting.js';

describe('reporting copy: status mapping (characterization)', () => {
  it('maps the pending codes to pending', () => {
    expect(mapProviderStatus('PENDING')).toBe('pending');
    expect(mapProviderStatus('AWAITING_PAYMENT')).toBe('pending');
  });

  it('maps AUTHORIZED to authorized', () => {
    expect(mapProviderStatus('AUTHORIZED')).toBe('authorized');
  });

  it('maps the settled codes to paid', () => {
    expect(mapProviderStatus('CAPTURED')).toBe('paid');
    expect(mapProviderStatus('SETTLED')).toBe('paid');
  });

  it('maps the refund codes to refunded', () => {
    expect(mapProviderStatus('REFUNDED')).toBe('refunded');
    expect(mapProviderStatus('PARTIAL_REFUND')).toBe('refunded');
  });

  it('upper-cases the failed codes to FAILED (the quirk the CSV consumers filter on)', () => {
    expect(mapProviderStatus('DECLINED')).toBe('FAILED');
    expect(mapProviderStatus('EXPIRED')).toBe('FAILED');
  });

  it('maps CHARGEBACK to chargeback', () => {
    expect(mapProviderStatus('CHARGEBACK')).toBe('chargeback');
  });

  it('returns null for a code it does not know', () => {
    expect(mapProviderStatus('NOT_A_REAL_CODE')).toBeNull();
  });
});

describe('reporting copy: buildRows (characterization)', () => {
  it('emits one row per known payment, with the status as mapped', () => {
    const rows = buildRows([
      { reference: 'p-01', providerStatus: 'PENDING', amountMinor: 100 },
      { reference: 'p-02', providerStatus: 'AWAITING_PAYMENT', amountMinor: 200 },
      { reference: 'p-03', providerStatus: 'AUTHORIZED', amountMinor: 300 },
      { reference: 'p-04', providerStatus: 'CAPTURED', amountMinor: 400 },
      { reference: 'p-05', providerStatus: 'SETTLED', amountMinor: 500 },
      { reference: 'p-06', providerStatus: 'REFUNDED', amountMinor: 600 },
      { reference: 'p-07', providerStatus: 'PARTIAL_REFUND', amountMinor: 700 },
      { reference: 'p-08', providerStatus: 'DECLINED', amountMinor: 800 },
      { reference: 'p-09', providerStatus: 'EXPIRED', amountMinor: 900 },
      { reference: 'p-10', providerStatus: 'CHARGEBACK', amountMinor: 1000 },
    ]);

    expect(rows).toEqual([
      { reference: 'p-01', status: 'pending', amountMinor: 100 },
      { reference: 'p-02', status: 'pending', amountMinor: 200 },
      { reference: 'p-03', status: 'authorized', amountMinor: 300 },
      { reference: 'p-04', status: 'paid', amountMinor: 400 },
      { reference: 'p-05', status: 'paid', amountMinor: 500 },
      { reference: 'p-06', status: 'refunded', amountMinor: 600 },
      { reference: 'p-07', status: 'refunded', amountMinor: 700 },
      { reference: 'p-08', status: 'FAILED', amountMinor: 800 },
      { reference: 'p-09', status: 'FAILED', amountMinor: 900 },
      { reference: 'p-10', status: 'chargeback', amountMinor: 1000 },
    ]);
  });

  it('silently skips payments whose code it does not know', () => {
    const rows = buildRows([
      { reference: 'p-01', providerStatus: 'CAPTURED', amountMinor: 100 },
      { reference: 'p-02', providerStatus: 'WHATEVER', amountMinor: 200 },
      { reference: 'p-03', providerStatus: 'REFUNDED', amountMinor: 300 },
    ]);

    expect(rows).toEqual([
      { reference: 'p-01', status: 'paid', amountMinor: 100 },
      { reference: 'p-03', status: 'refunded', amountMinor: 300 },
    ]);
  });

  it('returns no rows when no code is known', () => {
    expect(
      buildRows([{ reference: 'p-01', providerStatus: 'WHATEVER', amountMinor: 100 }]),
    ).toEqual([]);
  });
});
