/**
 * The blockchain provider SDK is assumed to expose:
 *   provider.transfer({ to, amount }) -> Promise<{ txHash }>
 * which may throw, time out, or succeed slowly. Amounts are passed in minor
 * units (BigInt).
 */
export interface PayoutProvider {
  transfer(args: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}

/** DI token for the provider. Tests inject a fake; production wraps the real SDK. */
export const PAYOUT_PROVIDER = 'PAYOUT_PROVIDER';

// ASSUMPTION: the concrete SDK package is not specified by the task, so this
// factory is the seam where the real provider client would be constructed (e.g.
// `return new RealProviderSdk()`). It fails loudly rather than pretending to
// send money.
export function createPayoutProvider(): PayoutProvider {
  return {
    async transfer(): Promise<{ txHash: string }> {
      throw new Error('payout provider is not configured');
    },
  };
}
