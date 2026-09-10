/**
 * The blockchain provider SDK contract:
 * `provider.transfer({to, amount}) -> {txHash}`, which may throw, time out,
 * or succeed slowly. Assume nothing else about it.
 *
 * ASSUMPTION: the SDK itself is not present in this repo, so this is the
 * exact contract the service depends on. `amount` is in minor units; the
 * SDK's integer type is assumed to accept BigInt.
 */
export interface PayoutProvider {
  transfer(input: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}

export const PAYOUT_PROVIDER = 'PAYOUT_PROVIDER';

/**
 * ASSUMPTION: no real SDK client is available in this repo. The stub keeps
 * the application bootable; bind the real client in production. Failing
 * loudly here is safe: the worker retries, then parks the payout.
 */
export class StubPayoutProvider implements PayoutProvider {
  async transfer(_input: { to: string; amount: bigint }): Promise<{ txHash: string }> {
    throw new Error('payout provider is not configured; bind a real PayoutProvider');
  }
}
