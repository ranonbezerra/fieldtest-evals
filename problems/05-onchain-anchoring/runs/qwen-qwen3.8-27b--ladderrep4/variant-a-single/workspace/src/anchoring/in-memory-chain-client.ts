import { createHash } from 'node:crypto';
import type { ChainClient, ChainReceipt, ChainTxInput, PreparedTx } from './chain-client.js';

/**
 * The "chain" side of the fake: state a real L2 would keep regardless of our
 * process (accepted txs, receipts, block numbers). Sharing one instance across
 * two InMemoryChainClient instances simulates a process restart: the app state
 * is gone, the chain is not.
 */
export class InMemoryChainState {
  readonly receipts = new Map<string, ChainReceipt>();
  /** Every signed tx the chain has accepted, in order (duplicates included). */
  readonly broadcastLog: string[] = [];
  private nextBlock = 1;

  land(txId: string, status: 'success' | 'failure' = 'success'): void {
    if (this.receipts.has(txId)) return; // the chain deduplicates by tx identity
    this.receipts.set(txId, {
      txId,
      blockNumber: this.nextBlock++,
      blockHash: `blk_${txId.slice(0, 16)}`,
      status,
    });
  }
}

/**
 * In-process ChainClient. It is the default provider because the task scopes
 * out real keys/RPC, and it doubles as the fake for tests (via `setBroadcast`
 * to simulate timeouts, crashes, and non-landing).
 */
export class InMemoryChainClient implements ChainClient {
  private readonly txIds = new Map<string, string>();
  private behavior: ((signedTx: string, txId: string, state: InMemoryChainState) => Promise<void>) | null = null;

  constructor(readonly state: InMemoryChainState = new InMemoryChainState()) {}

  prepare(tx: ChainTxInput): PreparedTx {
    const digest = createHash('sha256').update(`${tx.documentId}|${tx.version}|${tx.contentHash}`).digest('hex');
    const txId = `tx_${digest.slice(0, 40)}`;
    const signedTx = `signed:${txId}`;
    this.txIds.set(signedTx, txId);
    return { txId, signedTx };
  }

  async broadcast(signedTx: string): Promise<void> {
    const txId =
      this.txIds.get(signedTx) ?? `tx_${createHash('sha256').update(signedTx).digest('hex').slice(0, 40)}`;
    this.state.broadcastLog.push(signedTx);
    if (this.behavior) {
      await this.behavior(signedTx, txId, this.state);
    } else {
      this.state.land(txId);
    }
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    return this.state.receipts.get(txId) ?? null;
  }

  /** Test hook: override the broadcast behavior. null restores the default (accept and land). */
  setBroadcast(behavior: ((signedTx: string, txId: string, state: InMemoryChainState) => Promise<void>) | null): void {
    this.behavior = behavior;
  }
}
