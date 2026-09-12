// Characterization tests for scripts/reporting.ts, written BEFORE the
// PaymentStatusMapper extraction. They pin the reporting copy's exact
// current output for every status it handles — including the legacy
// upper-cased 'FAILED' quirk its consumers depend on — plus how buildRows
// treats unknown codes and empty input. The extraction must keep every
// assertion green.
import { describe, expect, it } from 'vitest';
import { buildRows, mapProviderStatus } from '../scripts/reporting.js';

describe('reporting mapProviderStatus (characterization)', () => {
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

  it('maps both refund codes to refunded', () => {
    expect(mapProviderStatus('REFUNDED')).toBe('refunded');
    expect(mapProviderStatus('PARTIAL_REFUND')).toBe('refunded');
  });

  it('upper-cases the failure codes (legacy report quirk)', () => {
    expect(mapProviderStatus('DECLINED')).toBe('FAILED');
    expect(mapProviderStatus('EXPIRED')).toBe('FAILED');
  });

  it('maps CHARGEBACK to chargeback', () => {
    expect(mapProviderStatus('CHARGEBACK')).toBe('chargeback');
  });

  it('returns null for a code it does not know', () => {
    expect(mapProviderStatus('WHATEVER')).toBeNull();
  });
});

describe('reporting buildRows (characterization)', () => {
  it('emits one row per known payment with the mapped status', () => {
    const rows = buildRows([
      { reference: 'r1', providerStatus: 'CAPTURED', amountMinor: 100 },
      { reference: 'r2', providerStatus: 'DECLINED', amountMinor: 250 },
      { reference: 'r3', providerStatus: 'AWAITING_PAYMENT', amountMinor: 75 },
    ]);
    expect(rows).toEqual([
      { reference: 'r1', status: 'paid', amountMinor: 100 },
      { reference: 'r2', status: 'FAILED', amountMinor: 250 },
      { reference: 'r3', status: 'pending', amountMinor: 75 },
    ]);
  });

  it('silently skips payments whose code it does not know', () => {
    const rows = buildRows([
      { reference: 'r1', providerStatus: 'SETTLED', amountMinor: 100 },
      { reference: 'r2', providerStatus: 'SOME_FUTURE_CODE', amountMinor: 200 },
      { reference: 'r3', providerStatus: 'CHARGEBACK', amountMinor: 300 },
    ]);
    expect(rows).toEqual([
      { reference: 'r1', status: 'paid', amountMinor: 100 },
      { reference: 'r3', status: 'chargeback', amountMinor: 300 },
    ]);
  });

  it('returns an empty array when no payment maps', () => {
    expect(buildRows([])).toEqual([]);
    expect(buildRows([{ reference: 'r1', providerStatus: 'NOPE', amountMinor: 5 }])).toEqual([]);
  });
});
