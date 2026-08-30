/**
 * Abstraction over the blockchain provider SDK used to execute stablecoin
 * transfers. The concrete SDK is out of scope; implementations (including
 * test fakes) are injected.
 *
 * `transfer` may throw, time out, or succeed slowly. It throws on transient
 * or permanent failure; the caller distinguishes by error shape: an ambiguous
 * failure (e.g. a timeout) means the transfer may have landed on-chain and
 * the funds must stay reserved, while a definitive failure (e.g. an invalid
 * destination address) means it did not.
 *
 * Amounts are in minor units, carried as `bigint` — never floating point.
 */
export interface PayoutProvider {
  /**
   * Executes a transfer of `amount` minor units to the destination address
   * `to`. Resolves with the provider's transaction hash on success and
   * throws otherwise.
   */
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}
