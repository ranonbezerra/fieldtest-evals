export interface ChainClient {
  /**
   * Deterministically creates a transaction for anchoring.
   */
  prepare(payload: {
    documentId: string;
    version: number;
    hash: string;
  }): Promise<{ txId: string; signedTx: string }>;

  /**
   * Sends a signed transaction to the L2.
   * May reject (e.g., timeout) with unknown outcome.
   */
  broadcast(signedTx: string): Promise<void>;

  /**
   * Retrieves a receipt if the transaction has been included.
   * Returns null when unknown.
   */
  getReceipt(txId: string): Promise<{ blockNumber: number } | null>;
}
