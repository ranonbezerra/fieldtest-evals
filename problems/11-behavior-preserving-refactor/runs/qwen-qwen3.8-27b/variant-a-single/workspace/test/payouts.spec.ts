/**
 * Pre-existing payouts tests. Coverage is partial on purpose (only some
 * statuses were pinned before the extraction) -- left unmodified by the
 * refactor, they must keep passing.
 */
import { describe, expect, it } from 'vitest';
import { PayoutsService } from '../src/payouts/payouts.service.js';
import { PayoutsRepository } from '../src/payouts/payouts.repository.js';

// The status-mapping methods never touch the repository, so a stub is enough.
const service = new PayoutsService({} as PayoutsRepository);

describe('PayoutsService#paymentStatusFor (pre-existing, partial)', () => {
  it('maps AUTHORIZED to "authorized"', () => {
    expect(service.paymentStatusFor('AUTHORIZED')).toBe('authorized');
  });

  it('maps DECLINED to "declined"', () => {
    expect(service.paymentStatusFor('DECLINED')).toBe('declined');
  });

  it('maps the payout-only code SETTLED to "settled"', () => {
    expect(service.paymentStatusFor('SETTLED')).toBe('settled');
  });

  it('maps the payout-only code RECALLED to "recalled"', () => {
    expect(service.paymentStatusFor('RECALLED')).toBe('recalled');
  });

  it('returns the "unknown" sentinel for an unrecognized provider status (preserved payouts behavior)', () => {
    expect(service.paymentStatusFor('WHATEVER')).toBe('unknown');
  });
});
