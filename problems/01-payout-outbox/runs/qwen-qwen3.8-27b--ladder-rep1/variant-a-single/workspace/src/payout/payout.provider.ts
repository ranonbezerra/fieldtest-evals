import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

/**
 * The assumed chain provider SDK surface. `transfer` may throw, time out, or
 * succeed slowly; a resolved value carrying a `txHash` is the only definitive
 * outcome the service relies on. A rejection is never proof that the transfer
 * did not happen (a timeout can hide a landed transfer).
 */
export interface PayoutProvider {
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}

/** Injection token for the provider implementation. */
export const PAYOUT_PROVIDER = 'PAYOUT_PROVIDER';

// ASSUMPTION: the real chain provider SDK is not present in this repository, so a
// stub stands in behind the PAYOUT_PROVIDER token to keep the module runnable and
// testable. Register the real SDK adapter in place of this class in production.
@Injectable()
export class StubPayoutProvider implements PayoutProvider {
  async transfer(_to: string, _amount: bigint): Promise<{ txHash: string }> {
    return { txHash: `stub-${randomUUID()}` };
  }
}
