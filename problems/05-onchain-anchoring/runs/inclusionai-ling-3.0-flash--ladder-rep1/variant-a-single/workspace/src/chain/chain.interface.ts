export interface ChainReceipt {
  txId: string;
  block: number;
  success: boolean;
}

export interface ChainClient {
  prepare(tx: unknown): { txId: string; signedTx: string };
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}
