import { Injectable } from '@nestjs/common';
import { ChainClient } from './chain-client.interface.js';
import { randomUUID } from 'crypto';

interface BroadcastOutcome {
  shouldTimeout: boolean;
  shouldLand: boolean;
}

/**
 * In-memory fake implementation of the L2 chain client.
 * Allows tests to configure broadcast outcomes and inspect call counts.
 */
@Injectable()
export class FakeChainClient implements ChainClient {
  private txStore = new Map<
    string,
    {
      signedTx: string;
      receipt?: { blockNumber: number };
    }
  >();

  private blockCounter = 0;
  private nextBroadcastOutcome: BroadcastOutcome = { shouldTimeout: false, shouldLand: true };
  private broadcastCount = 0;

  /**
   * Configures the outcome of the next broadcast call.
   * Subsequent calls revert to the default (no timeout, lands).
   */
  setNextBroadcastOutcome(opts: Partial<BroadcastOutcome>) {
    this.nextBroadcastOutcome = {
      shouldTimeout: opts.shouldTimeout ?? this.nextBroadcastOutcome.shouldTimeout,
      shouldLand: opts.shouldLand ?? this.nextBroadcastOutcome.shouldLand,
    };
  }

  reset() {
    this.txStore.clear();
    this.blockCounter = 0;
    this.broadcastCount = 0;
    this.nextBroadcastOutcome = { shouldTimeout: false, shouldLand: true };
  }

  getBroadcastCount(): number {
    return this.broadcastCount;
  }

  async prepare(txData: { documentId: string; version: number; hash: string }): Promise<{ txId: string; signedTx: string }> {
    const txId = randomUUID();
    const signedTx = JSON.stringify({ txId, txData });
    this.txStore.set(txId, { signedTx });
    return { txId, signedTx };
  }

  async broadcast(signedTx: string): Promise<void> {
    this.broadcastCount += 1;

    let parsed: any;
    try {
      parsed = JSON.parse(signedTx);
    } catch {
      throw new Error('InvalidSignedTx');
    }
    const txId: string = parsed.txId;
    const record = this.txStore.get(txId);
    if (!record) {
      throw new Error(`Unknown txId ${txId}`);
    }

    // Simulate landing on chain if configured to do so
    if (this.nextBroadcastOutcome.shouldLand) {
      if (!record.receipt) {
        this.blockCounter += 1;
        record.receipt = { blockNumber: this.blockCounter };
      }
    }

    // Simulate timeout condition
    if (this.nextBroadcastOutcome.shouldTimeout) {
      // Reset outcome for subsequent calls
      this.nextBroadcastOutcome = { shouldTimeout: false, shouldLand: true };
      throw new Error('BroadcastTimeout');
    }

    // Reset outcome for subsequent calls
    this.nextBroadcastOutcome = { shouldTimeout: false, shouldLand: true };
  }

  async getReceipt(txId: string): Promise<{ txId: string; blockNumber: number } | null> {
    const record = this.txStore.get(txId);
    if (record && record.receipt) {
      return { txId, blockNumber: record.receipt.blockNumber };
    }
    return null;
  }
}
