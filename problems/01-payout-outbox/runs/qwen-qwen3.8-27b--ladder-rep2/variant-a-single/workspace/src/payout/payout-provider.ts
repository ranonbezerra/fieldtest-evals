/**
 * Contract for the external blockchain provider SDK.
 */
export interface PayoutProvider {
  /**
   * Per the spec: `provider.transfer({to, amount}) -> {txHash}`. May throw,
   * time out, or succeed slowly. A resolved txHash means "submitted", not
   * "settled" — settlement is never inferred from it.
   */
  transfer(input: { to: string; amount: bigint }): Promise<{ txHash: string }>;

  /**
   * ASSUMPTION: the spec forbids treating a txHash as confirmation but the SDK
   * is assumed to expose some way to learn the outcome of a submitted
   * transaction, so we model it as `confirmSettlement`. `settled: false` must
   * be definitive: the transaction provably did not and will not move funds.
   */
  confirmSettlement(txHash: string): Promise<{ settled: boolean }>;
}

/** DI token for the provider client. */
export const PAYOUT_PROVIDER = 'PAYOUT_PROVIDER';
