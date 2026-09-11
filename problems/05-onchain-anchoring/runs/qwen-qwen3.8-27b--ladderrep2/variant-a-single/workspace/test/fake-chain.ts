import { createHash } from 'node:crypto';
import { canonicalize } from '../src/anchoring/canonical-json.js';
import {
  type AnchorPayload,
  type ChainClient,
  type ChainReceipt,
  type PreparedTx,
} from '../src/anchoring/chain-client.js';

/**
 * A deterministic in-memory chain for tests.
 *
 * As on a real chain, the transaction identity is derived from the signed
 * bytes: the same signedTx always has the same txId, and a tx is at most
 * landed once — re-sending it cannot create a second anchor.
 */
export class FakeChain implements ChainClient {
  readonly landed = new Map<string, ChainReceipt>();
  readonly broadcasts: string[] = [];
  /** When set, thrown from broadcast() (after the tx has landed, if landOnBroadcast) — simulates a timeout or a process crash. */
  broadcastError: Error | null = null;
  /** Whether a successful broadcast() makes the tx land immediately. */
  landOnBroadcast = true;
  /** Observes external state at the moment broadcast() is called. */
  onBeforeBroadcast?: (txId: string) => Promise<void> | void;
  private blockCounter = 42;

  static sign(payload: AnchorPayload): string {
    return 'fake-signed:' + canonicalize(payload);
  }

  static txIdFor(signedTx: string): string {
    return 'tx_' + createHash('sha256').update(signedTx, 'utf8').digest('hex').slice(0, 24);
  }

  reset(): void {
    this.landed.clear();
    this.broadcasts.length = 0;
    this.broadcastError = null;
    this.landOnBroadcast = true;
    this.onBeforeBroadcast = undefined;
    this.blockCounter = 42;
  }

  prepare(payload: AnchorPayload): PreparedTx {
    const signedTx = FakeChain.sign(payload);
    return { txId: FakeChain.txIdFor(signedTx), signedTx };
  }

  async broadcast(signedTx: string): Promise<void> {
    this.broadcasts.push(signedTx);
    const txId = FakeChain.txIdFor(signedTx);
    if (this.onBeforeBroadcast) {
      await this.onBeforeBroadcast(txId);
    }
    if (this.landOnBroadcast) {
      this.land(txId);
    }
    if (this.broadcastError) {
      throw this.broadcastError;
    }
  }

  /** Manually mark a tx as landed (e.g. it arrived late). */
  land(txId: string, status: 'success' | 'failure' = 'success'): void {
    if (!this.landed.has(txId)) {
      this.blockCounter += 1;
      this.landed.set(txId, {
        txId,
        blockNumber: this.blockCounter,
        blockHash: '0x' + txId.slice(3),
        status,
      });
    }
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    return this.landed.get(txId) ?? null;
  }

  txIdsOnChain(): string[] {
    return [...this.landed.keys()];
  }
}
