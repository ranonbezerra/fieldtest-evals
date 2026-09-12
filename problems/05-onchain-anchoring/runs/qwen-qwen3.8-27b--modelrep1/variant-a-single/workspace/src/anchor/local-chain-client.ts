import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { AnchorTxInput, ChainClient, ChainTxReceipt, PreparedTx } from './chain-client.interface.js';

// ASSUMPTION: the task provides no real chain client (no keys, no RPC), so the
// app's default ChainClient is this deterministic in-memory L2 stand-in. It
// lets the API run end-to-end locally; tests override CHAIN_CLIENT with a
// failure-injecting fake.
@Injectable()
export class LocalChainClient implements ChainClient {
  private readonly mined = new Map<string, number>();
  private nextBlock = 1;

  async prepare(tx: AnchorTxInput): Promise<PreparedTx> {
    const txId =
      '0x' + createHash('sha256').update(`anchor-v1|${tx.documentId}|${tx.version}|${tx.contentHash}`).digest('hex');
    return { txId, signedTx: `local:${txId}` };
  }

  async broadcast(signedTx: string): Promise<void> {
    const txId = signedTx.startsWith('local:') ? signedTx.slice('local:'.length) : signedTx;
    if (!this.mined.has(txId)) this.mined.set(txId, this.nextBlock++);
  }

  async getReceipt(txId: string): Promise<ChainTxReceipt | null> {
    const blockNumber = this.mined.get(txId);
    return blockNumber === undefined ? null : { txId, blockNumber };
  }
}
