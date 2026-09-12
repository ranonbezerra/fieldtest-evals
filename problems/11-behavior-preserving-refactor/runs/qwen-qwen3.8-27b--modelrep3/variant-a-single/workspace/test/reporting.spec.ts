import { describe, expect, it } from 'vitest';
import { buildRows, mapProviderStatus } from '../scripts/reporting.js';

// Characterization tests for the reporting copy of the provider-status
// mapping, written before the code moved to the shared PaymentStatusMapper.
// They pin its exact current output for every provider code — including the
// legacy 'FAILED' casing and the skip-on-unknown behavior — so the
// extraction can be verified against them.

describe('reporting mapProviderStatus (characterization)', () => {
  it('pins the current output for every known provider code', () => {
    const expected: Record<string, string> = {
      PENDING: 'pending',
      AWAITING_PAYMENT: 'pending',
      AUTHORIZED: 'authorized',
      CAPTURED: 'paid',
      SETTLED: 'paid',
      REFUNDED: 'refunded',
      PARTIAL_REFUND: 'refunded',
      DECLINED: 'FAILED',
      EXPIRED: 'FAILED',
      CHARGEBACK: 'chargeback',
    };
    for (const [code, status] of Object.entries(expected)) {
      expect(mapProviderStatus(code), `provider code ${code}`).toBe(status);
    }
  });

  it("emits the failure statuses upper-cased as 'FAILED' (legacy CSV quirk)", () => {
    expect(mapProviderStatus('DECLINED')).toBe('FAILED');
    expect(mapProviderStatus('EXPIRED')).toBe('FAILED');
  });

  it('returns null for a provider code it does not know', () => {
    expect(mapProviderStatus('NEVER_SEEN')).toBeNull();
  });
});

describe('reporting buildRows (characterization)', () => {
  it('writes the status column exactly as the legacy switch produced it', () => {
    expect(
      buildRows([
        { reference: 'a', providerStatus: 'PENDING', amountMinor: 10 },
        { reference: 'b', providerStatus: 'AWAITING_PAYMENT', amountMinor: 20 },
        { reference: 'c', providerStatus: 'AUTHORIZED', amountMinor: 30 },
        { reference: 'd', providerStatus: 'CAPTURED', amountMinor: 40 },
        { reference: 'e', providerStatus: 'SETTLED', amountMinor: 50 },
        { reference: 'f', providerStatus: 'REFUNDED', amountMinor: 60 },
        { reference: 'g', providerStatus: 'PARTIAL_REFUND', amountMinor: 70 },
        { reference: 'h', providerStatus: 'DECLINED', amountMinor: 80 },
        { reference: 'i', providerStatus: 'EXPIRED', amountMinor: 90 },
        { reference: 'j', providerStatus: 'CHARGEBACK', amountMinor: 100 },
      ]),
    ).toEqual([
      { reference: 'a', status: 'pending', amountMinor: 10 },
      { reference: 'b', status: 'pending', amountMinor: 20 },
      { reference: 'c', status: 'authorized', amountMinor: 30 },
      { reference: 'd', status: 'paid', amountMinor: 40 },
      { reference: 'e', status: 'paid', amountMinor: 50 },
      { reference: 'f', status: 'refunded', amountMinor: 60 },
      { reference: 'g', status: 'refunded', amountMinor: 70 },
      { reference: 'h', status: 'FAILED', amountMinor: 80 },
      { reference: 'i', status: 'FAILED', amountMinor: 90 },
      { reference: 'j', status: 'chargeback', amountMinor: 100 },
    ]);
  });

  it('silently skips payments with a provider code it does not know', () => {
    expect(
      buildRows([
        { reference: 'a', providerStatus: 'SETTLED', amountMinor: 1 },
        { reference: 'b', providerStatus: 'FRESH_PROVIDER_CODE', amountMinor: 2 },
        { reference: 'c', providerStatus: 'PENDING', amountMinor: 3 },
      ]),
    ).toEqual([
      { reference: 'a', status: 'paid', amountMinor: 1 },
      { reference: 'c', status: 'pending', amountMinor: 3 },
    ]);
  });

  it('returns no rows for empty input or all-unknown input', () => {
    expect(buildRows([])).toEqual([]);
    expect(
      buildRows([{ reference: 'x', providerStatus: '???', amountMinor: 5 }]),
    ).toEqual([]);
  });
});
