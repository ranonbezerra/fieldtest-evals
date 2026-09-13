export interface IChainClient {
  prepare(tx: any): Promise<{ txId: string; signedTx: string }>;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<{ blockNumber: number; success: boolean } | null>;
}
