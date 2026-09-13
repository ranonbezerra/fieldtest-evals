export interface ChainReceipt {
  txId: string;
  block: number;
  status: 'confirmed' | 'failed';
}

export interface ChainPrepareResult {
  txId: string;
  signedTx: string;
}

export interface ChainClient {
  prepare(tx: unknown): ChainPrepareResult;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}
