export interface PrepareResult {
  txId: string;
  signedTx: string;
}

export interface ChainClient {
  /**
   * Prepare a transaction containing the given payload.
   * Returns a deterministic txId and a signed transaction ready for broadcast.
   */
  prepare(payload: { hash: string }): Promise<PrepareResult>;

  /**
   * Broadcast a signed transaction. May timeout; the outcome is unknown.
   */
  broadcast(signedTx: string): Promise<void>;

  /**
   * Retrieve a receipt for a previously broadcast txId.
   * Returns undefined if the transaction is not yet mined.
   */
  getReceipt(txId: string): Promise<{ blockNumber: number } | undefined>;
}
