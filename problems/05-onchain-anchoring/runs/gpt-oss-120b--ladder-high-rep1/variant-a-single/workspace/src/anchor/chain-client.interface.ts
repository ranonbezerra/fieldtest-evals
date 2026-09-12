export interface ChainClient {
  /**
   * Prepares a transaction for anchoring.
   * Returns the transaction identifier and the signed transaction payload.
   */
  prepare(txData: { documentId: string; version: number; hash: string }): Promise<{ txId: string; signedTx: string }>;

  /**
   * Broadcasts the signed transaction to the chain.
   * May throw an error (e.g., timeout) indicating the outcome is unknown.
   */
  broadcast(signedTx: string): Promise<void>;

  /**
   * Retrieves the receipt for a given transaction identifier.
   * Returns null if the transaction is not yet on-chain.
   */
  getReceipt(txId: string): Promise<{ txId: string; blockNumber: number } | null>;
}
