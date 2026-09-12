import { describe, expect, it } from 'vitest';
import { buildRows, mapProviderStatus } from '../scripts/reporting.js';

// Characterization tests for the nightly CSV (scripts/reporting.ts), written
// BEFORE the mapper extraction. They pin the copy's current output for every
// provider status it handles -- including the upper-cased 'FAILED' quirk that
// finance's spreadsheet filters on -- and for codes it does not handle.
// The extraction must keep all of these green.

const KNOWN_MAPPINGS: Array<[code: string, expected: string]> = [
  ['PENDING', 'pending'],
  ['AWAITING_PAYMENT', 'pending'],
  ['AUTHORIZED', 'authorized'],
  ['CAPTURED', 'paid'],
  ['SETTLED', 'paid'],
  ['REFUNDED', 'refunded'],
  ['PARTIAL_REFUND', 'refunded'],
  ['CHARGEBACK', 'chargeback'],
];

describe('reporting mapProviderStatus (characterization)', () => {
  it.each(KNOWN_MAPPINGS)('maps %s to %s', (code, expected) => {
    expect(mapProviderStatus(code)).toBe(expected);
  });

  it('upper-cases the failed status: the legacy quirk consumers depend on', () => {
    expect(mapProviderStatus('DECLINED')).toBe('FAILED');
    expect(mapProviderStatus('EXPIRED')).toBe('FAILED');
    // ...and every other status stays lower-case.
    expect(mapProviderStatus('CAPTURED')).toBe('paid');
    expect(mapProviderStatus('PENDING')).toBe('pending');
  });

  it('returns null for codes it does not know', () => {
    expect(mapProviderStatus('TOTALLY_UNKNOWN')).toBeNull();
    // The payout-only codes were never handled by this script; they hit the
    // default case. Pinned so the extraction cannot silently start
    // reporting them in the CSV.
    expect(mapProviderStatus('PAYOUT_SETTLED')).toBeNull();
    expect(mapProviderStatus('PAYOUT_REVERSED')).toBeNull();
  });
});

describe('reporting buildRows (characterization)', () => {
  const payment = (
    reference: string,
    providerStatus: string,
    amountMinor: number,
  ) => ({ reference, providerStatus, amountMinor });

  it('keeps one row per recognized payment, in input order', () => {
    expect(
      buildRows([
        payment('ord-1', 'PENDING', 100),
        payment('ord-2', 'SETTLED', 2500),
        payment('ord-3', 'PARTIAL_REFUND', 75),
        payment('ord-4', 'DECLINED', 40),
        payment('ord-5', 'CHARGEBACK', 300),
      ]),
    ).toEqual([
      { reference: 'ord-1', status: 'pending', amountMinor: 100 },
      { reference: 'ord-2', status: 'paid', amountMinor: 2500 },
      { reference: 'ord-3', status: 'refunded', amountMinor: 75 },
      { reference: 'ord-4', status: 'FAILED', amountMinor: 40 },
      { reference: 'ord-5', status: 'chargeback', amountMinor: 300 },
    ]);
  });

  it('omits unrecognized rows without stopping the report', () => {
    expect(
      buildRows([
        payment('ord-1', 'SETTLED', 100),
        payment('ord-2', 'TOTALLY_UNKNOWN', 200),
        payment('ord-3', 'PAYOUT_SETTLED', 300),
        payment('ord-4', 'PENDING', 400),
      ]),
    ).toEqual([
      { reference: 'ord-1', status: 'paid', amountMinor: 100 },
      { reference: 'ord-4', status: 'pending', amountMinor: 400 },
    ]);
  });

  it('produces an empty report for empty input', () => {
    expect(buildRows([])).toEqual([]);
  });

  it('produces an empty report when no payment is recognized', () => {
    expect(buildRows([payment('ord-1', 'TOTALLY_UNKNOWN', 1)])).toEqual([]);
  });
});
