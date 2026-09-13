import { ChainReceipt, ChainClient } from './chain.interface.ts';

export class MockChainClient implements ChainClient {
  private prepared = new Map<string, { txId: string; signedTx: string; input: unknown }>();
  private broadcasted = new Set<string>();
  private chainReceipts = new Map<string, ChainReceipt>();
  private broadcastTimeout = false;

  prepare(tx: unknown): { txId: string; signedTx: string } {
    const txId = crypto.randomUUID();
    const signedTx = `signed-${txId}`;
    this.prepared.set(txId, { txId, signedTx, input: tx });
    return { txId, signedTx };
  }

  async broadcast(signedTx: string): Promise<void> {
    if (this.broadcastTimeout) {
      throw new Error('broadcast timed out');
    }
    this.broadcasted.add(signedTx);
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    return this.chainReceipts.get(txId) ?? null;
  }

  setBroadcastTimeout(value: boolean): void {
    this.broadcastTimeout = value;
  }

  setReceipt(txId: string, receipt: ChainReceipt): void {
    this.chainReceipts.set(txId, receipt);
  }

  getBroadcastedSignedTxs(): string[] {
    return [...this.broadcasted];
  }

  wasBroadcast(signedTx: string): boolean {
    return this.broadcasted.has(signedTx);
  }

  simulateCrash(): void {
    this.broadcasted.clear();
  }

  reset(): void {
    this.prepared.clear();
    this.broadcasted.clear();
    this.chainReceipts.clear();
    this.broadcastTimeout = false;
  }
}
