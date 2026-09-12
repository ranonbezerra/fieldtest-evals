import { ChainClient } from './chain-client.interface.js';
import crypto from 'crypto';

type Receipt = { txId: string; blockNumber: number };

export class FakeChainClient implements ChainClient {
  // Map signedTx => txId
  private signedTxMap = new Map<string, string>();
  // Receipts stored by txId
  private receipts = new Map<string, Receipt>();
  // Global flag to force timeout on broadcast
  private forceTimeout = false;
  // Simple block number generator
  private nextBlockNumber = 1;

  /**
   * In tests, set to true to make all subsequent broadcast calls reject with a timeout.
   */
  setForceTimeout(flag: boolean) {
    this.forceTimeout = flag;
  }

  /**
   * Adds a receipt for a transaction, simulating that it landed on-chain.
   */
  addReceipt(txId: string, blockNumber?: number) {
    const bn = blockNumber ?? this.nextBlockNumber++;
    this.receipts.set(txId, { txId, blockNumber: bn });
  }

  /**
   * Clears all internal state (for test isolation).
   */
  clear() {
    this.signedTxMap.clear();
    this.receipts.clear();
    this.forceTimeout = false;
    this.nextBlockNumber = 1;
  }

  async prepare(tx: { hash: string }): Promise<{ txId: string; signedTx: string }> {
    // Deterministic txId based on hash
    const txId = crypto.createHash('sha256').update(tx.hash).digest('hex');
    const signedTx = `signed_${txId}`;
    this.signedTxMap.set(signedTx, txId);
    return { txId, signedTx };
  }

  async broadcast(signedTx: string): Promise<void> {
    const txId = this.signedTxMap.get(signedTx);
    if (!txId) {
      throw new Error('Unknown signed transaction');
    }
    if (this.forceTimeout) {
      // Simulate timeout without creating a receipt
      throw new Error('Timeout');
    }
    // Simulate successful broadcast by creating a receipt if absent
    if (!this.receipts.has(txId)) {
      this.addReceipt(txId);
    }
    // Resolve successfully
    return;
  }

  async getReceipt(txId: string): Promise<{ txId: string; blockNumber: number } | null> {
    const receipt = this.receipts.get(txId);
    return receipt ?? null;
  }
}
