import { describe, expect, it } from 'vitest';
import { mapProviderStatus } from '../src/payouts/payouts.status.js';

describe('payouts status mapping', () => {
  it('treats the payout-specific settle code as paid', () => {
    expect(mapProviderStatus('PAYOUT_SETTLED')).toBe('paid');
  });

  it('treats a reversal as a refund', () => {
    expect(mapProviderStatus('PAYOUT_REVERSED')).toBe('refunded');
  });
});
