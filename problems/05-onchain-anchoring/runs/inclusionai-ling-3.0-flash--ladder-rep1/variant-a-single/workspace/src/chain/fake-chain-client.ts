import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ChainClient, ChainReceipt } from './chain-client.interface.js';

@Injectable()
export class FakeChainClient implements ChainClient {
  private receipts = new Map<string, ChainReceipt>();
  private broadcastOutcome: 'success' | 'timeout' = 'success';

  setBroadcastOutcome(outcome: 'success' | 'timeout') {
    this.broadcastOutcome = outcome;
  }

  addReceipt(txId: string, block: number, status: 'confirmed' | 'failed' = 'confirmed') {
    this.receipts.set(txId, { txId, block, status });
  }

  reset() {
    this.receipts.clear();
    this.broadcastOutcome = 'success';
  }

  prepare(tx: unknown): { txId: string; signedTx: string } {
    const txData = JSON.stringify(tx);
    const txId = createHash('sha256').update(txData).digest('hex');
    const signedTx = `signed:${txId}`;
    return { txId, signedTx };
  }

  async broadcast(_signedTx: string): Promise<void> {
    if (this.broadcastOutcome === 'timeout') {
      const err = new Error('broadcast timed out');
      (err as any).code = 'ETIMEDOUT';
      throw err;
    }
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    return this.receipts.get(txId) ?? null;
  }
}
