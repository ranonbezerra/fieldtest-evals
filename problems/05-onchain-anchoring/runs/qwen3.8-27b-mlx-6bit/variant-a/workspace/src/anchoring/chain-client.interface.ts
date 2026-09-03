export interface ChainReceipt {
  blockNumber: bigint;
  blockHash: string;
  status: 'success' | 'failure';
}

export interface PreparedTx {
  txId: string;
  signedTx: string;
}

export interface ChainClient {
  prepare(contentHash: string): Promise<PreparedTx>;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}

export class BroadcastTimeoutError extends Error {
  constructor(message = 'Broadcast timed out with unknown outcome') {
    super(message);
    this.name = 'BroadcastTimeoutError';
  }
}
