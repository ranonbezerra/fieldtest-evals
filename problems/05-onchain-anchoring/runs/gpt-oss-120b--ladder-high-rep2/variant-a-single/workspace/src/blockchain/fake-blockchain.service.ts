import { Injectable } from '@nestjs/common';
import { BlockchainClient, ChainTx, ChainReceipt, BroadcastTimeoutError } from './blockchain.client.js';
import { createHash } from 'crypto';

interface TxRecord {
  signedTx: string;
  receipt?: ChainReceipt;
  broadcasted: boolean;
}

/**
 * A fake in‑memory blockchain client for tests.
 * Allows configuring timeouts and manually injecting receipts.
 */
@Injectable()
export class FakeBlockchainService implements BlockchainClient {
  private txMap: Map<string, TxRecord> = new Map();
  private timeoutTxIds: Set<string> = new Set();
  private alwaysTimeout = false;

  /** Force every broadcast to timeout (used by tests). */
  public setAlwaysTimeout(value: boolean) {
    this.alwaysTimeout = value;
  }

  /** Mark a specific transaction ID to timeout on broadcast. */
  public setTimeoutForTxId(txId: string) {
    this.timeoutTxIds.add(txId);
  }

  /** Remove a timeout flag for a specific transaction ID. */
  public clearTimeoutForTxId(txId: string) {
    this.timeoutTxIds.delete(txId);
  }

  /** Manually inject a receipt for a given transaction. */
  public setReceipt(txId: string, receipt: ChainReceipt) {
    const record = this.txMap.get(txId);
    if (record) {
      record.receipt = receipt;
    } else {
      this.txMap.set(txId, { signedTx: '', receipt, broadcasted: false });
    }
  }

  private computeTxId(txData: any): string {
    const hash = createHash('sha256');
    hash.update(JSON.stringify(txData));
    return hash.digest('hex');
  }

  async prepare(txData: any): Promise<ChainTx> {
    const txId = this.computeTxId(txData);
    const signedTx = JSON.stringify(txData); // deterministic signed payload
    if (!this.txMap.has(txId)) {
      this.txMap.set(txId, { signedTx, broadcasted: false });
    }
    return { txId, signedTx };
  }

  async broadcast(signedTx: string): Promise<void> {
    const txData = JSON.parse(signedTx);
    const txId = this.computeTxId(txData);
    const record = this.txMap.get(txId);
    if (!record) {
      throw new Error(`Transaction ${txId} not prepared`);
    }
    record.broadcasted = true;

    if (this.alwaysTimeout || this.timeoutTxIds.has(txId)) {
      // Simulate timeout – outcome unknown.
      throw new BroadcastTimeoutError();
    }

    // In the fake client we do not automatically generate a receipt.
    // Tests are expected to call `setReceipt` when they want the receipt to appear.
    return;
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    const record = this.txMap.get(txId);
    return record?.receipt ?? null;
  }
}
