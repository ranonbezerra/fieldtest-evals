import { Injectable } from '@nestjs/common';
import { ChainClient } from './chain-client.interface.js';
import { randomUUID } from 'crypto';

/**
 * Simple in‑memory fake that allows tests to control behavior.
 * It records prepared txs and simulates broadcast outcomes.
 */
@Injectable()
export class FakeChainClient implements ChainClient {
  // txId => { signedTx, landed?, blockNumber }
  private store = new Map<
    string,
    { signedTx: string; landed: boolean; blockNumber?: number }
  >();

  // Controls for tests
  public shouldBroadcastSucceed = true;
  public nextBlockNumber = 1000;

  async prepare(payload: {
    documentId: string;
    version: number;
    hash: string;
  }): Promise<{ txId: string; signedTx: string }> {
    const txId = randomUUID();
    const signedTx = `signed(${payload.documentId}|${payload.version}|${payload.hash})`;
    this.store.set(txId, { signedTx, landed: false });
    return { txId, signedTx };
  }

  async broadcast(signedTx: string): Promise<void> {
    // Find the txId for this signedTx
    const entry = [...this.store.entries()].find(
      ([, v]) => v.signedTx === signedTx,
    );
    if (!entry) {
      throw new Error('Unknown signedTx');
    }
    const [txId, meta] = entry;
    if (!this.shouldBroadcastSucceed) {
      // Simulate timeout – we do *not* mark landed
      throw new Error('Broadcast timeout');
    }
    // Mark as landed
    meta.landed = true;
    meta.blockNumber = this.nextBlockNumber++;
    this.store.set(txId, meta);
  }

  async getReceipt(
    txId: string,
  ): Promise<{ blockNumber: number } | null> {
    const meta = this.store.get(txId);
    if (meta && meta.landed && meta.blockNumber !== undefined) {
      return { blockNumber: meta.blockNumber };
    }
    return null;
  }
}
