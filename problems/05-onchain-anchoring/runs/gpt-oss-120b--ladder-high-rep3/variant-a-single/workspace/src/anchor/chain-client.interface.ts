export interface ChainClient {
  /**
   * Prepares a transaction given its hash.
   * Returns deterministic transaction identity and signed transaction payload.
   */
  prepare(tx: { hash: string }): Promise<{ txId: string; signedTx: string }>;

  /**
   * Broadcasts the signed transaction to the network.
   * May reject (e.g., timeout) with unknown outcome.
   */
  broadcast(signedTx: string): Promise<void>;

  /**
   * Retrieves a receipt for a given transaction identity.
   * Returns null if no receipt is available.
   */
  getReceipt(txId: string): Promise<{ txId: string; blockNumber: number } | null>;
}
