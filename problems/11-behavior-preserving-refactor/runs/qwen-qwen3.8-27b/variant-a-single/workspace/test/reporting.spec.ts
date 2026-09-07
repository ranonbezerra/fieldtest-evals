/**
 * Characterization tests for the reporting script's status mapping.
 *
 * Written BEFORE the PaymentStatusMapper extraction: the reporting copy had no
 * tests at all. These pin its current output for every provider status it
 * understood (including the uppercase "VOIDED" quirk) and its silent-skip
 * behavior for codes it did not know. The extraction must keep them green.
 */
import { describe, expect, it } from 'vitest';
import { toReportLines, type ReportingRow } from '../scripts/generate-status-report.js';

const row = (id: string, providerStatus: string): ReportingRow => ({
  kind: 'order',
  id,
  providerStatus,
  amountCents: 1,
});

const statusOf = (id: string, providerStatus: string): string | undefined =>
  toReportLines([row(id, providerStatus)]).find((line) => line.id === id)?.status;

describe('reporting status mapping (characterization, pinned before extraction)', () => {
  it.each([
    ['AUTHORIZED', 'authorized'],
    ['CAPTURED', 'captured'],
    ['PENDING', 'pending'],
    ['DECLINED', 'declined'],
    ['REFUNDED', 'refunded'],
  ])('maps %s to %s', (providerStatus, expected) => {
    expect(statusOf('o-1', providerStatus)).toBe(expected);
  });

  it('maps REVERSED to the legacy uppercase token "VOIDED" (quirk CSV consumers depend on)', () => {
    expect(statusOf('o-1', 'REVERSED')).toBe('VOIDED');
  });

  it('emits one line per known row with kind, id, status and amount', () => {
    const lines = toReportLines([{ kind: 'payout', id: 'p-9', providerStatus: 'CAPTURED', amountCents: 2500 }]);
    expect(lines).toEqual([{ kind: 'payout', id: 'p-9', status: 'captured', amountCents: 2500 }]);
  });

  it('silently skips rows with provider codes the reporting copy did not know', () => {
    const lines = toReportLines([
      row('o-1', 'BOGUS_CODE'),
      row('o-2', 'NOT_A_STATUS'),
      row('o-3', 'AUTHORIZED'),
    ]);
    expect(lines.map((line) => line.id)).toEqual(['o-3']);
    expect(lines[0]?.status).toBe('authorized');
  });
});
