import { Injectable } from '@nestjs/common';
import { ChainClient, PrepareResult } from './chain-client.interface';
import { randomUUID } from 'crypto';

interface TxRecord {
  signedTx: string;
  receipt?: { blockNumber: number };
}

/**
 * A deterministic in‑memory fake chain client used only for tests.
 */
@Injectable()
export class FakeChainClient implements ChainClient {
  private readonly txStore: Map<string, TxRecord> = new Map();

  async prepare(payload: { hash: string }): Promise<PrepareResult> {
    const txId = `tx_${randomUUID()}`;
    const signedTx = `signed_${payload.hash}_${txId}`;
    this.txStore.set(txId, { signedTx });
    return { txId, signedTx };
  }

  async broadcast(signedTx: string): Promise<void> {
    // In the fake client we consider broadcast instantaneous.
    // Find the txId associated with this signedTx.
    const entry = Array.from(this.txStore.entries()).find(([, v]) => v.signedTx === signedTx);
    if (!entry) return;
    const [txId, record] = entry;
    // Simulate mining by creating a receipt with an incrementing block number.
    const blockNumber = Math.floor(Math.random() * 1_000_000);
    record.receipt = { blockNumber };
    this.txStore.set(txId, record);
  }

  async getReceipt(txId: string): Promise<{ blockNumber: number } | undefined> {
    const record = this.txStore.get(txId);
    return record?.receipt;
  }
}
