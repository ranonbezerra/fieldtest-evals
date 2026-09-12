export interface ChainTx {
  txId: string;
  signedTx: string;
}

export interface ChainReceipt {
  txId: string;
  blockNumber: number;
  status: 'success' | 'failed';
}

export interface BlockchainClient {
  prepare(txData: any): Promise<ChainTx>;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}

/**
 * Thrown when a broadcast operation times out and the outcome is unknown.
 */
export class BroadcastTimeoutError extends Error {
  constructor(message?: string) {
    super(message ?? 'Broadcast timed out');
    this.name = 'BroadcastTimeoutError';
  }
}
