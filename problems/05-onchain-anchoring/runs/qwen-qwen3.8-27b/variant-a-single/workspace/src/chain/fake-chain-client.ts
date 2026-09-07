import { createHash } from 'node:crypto';
import { BroadcastTimeoutError } from './chain-client.js';
import type { AnchorPayload, ChainClient, ChainReceipt, PreparedTx } from './chain-client.js';

export type FakeBroadcastOutcome = 'ok' | 'timeout' | 'fail';

/**
 * Deterministic in-memory stand-in for the L2 chain.
 *
 * - prepare derives a stable txId from the payload (same payload -> same txId),
 *   mirroring a deterministic local signer.
 * - broadcast honours `broadcastOutcome`; 'timeout' rejects with
 *   BroadcastTimeoutError and — when `timeoutLands` is true — still lands the
 *   tx, modelling the unknown-outcome case.
 * - receipts become available as soon as a tx has landed; a tx is idempotent
 *   on chain by txId (landing twice is a no-op).
 */
export class FakeChainClient implements ChainClient {
  broadcastOutcome: FakeBroadcastOutcome = 'ok';
  /** When true, a timed-out broadcast still lands the tx on chain. */
  timeoutLands = false;
  /** Receipt status used when a tx lands. */
  receiptStatus: 'success' | 'failed' = 'success';
  /** Optional hook invoked at broadcast time (used to observe state ordering). */
  broadcastHook: ((signedTx: string) => void | Promise<void>) | null = null;

  /** Every signedTx that was broadcast, in order. */
  readonly broadcasts: string[] = [];

  private readonly prepared = new Map<string, { txId: string; payload: AnchorPayload }>();
  private readonly landed = new Map<string, ChainReceipt>();
  private blockHeight = 1_000;

  async prepare(tx: AnchorPayload): Promise<PreparedTx> {
    const txId = `0x${createHash('sha256')
      .update(`${tx.kind}:${tx.documentId}:${tx.version}:${tx.contentHash}`, 'utf8')
      .digest('hex')}`;
    const signedTx = `fake-sign:${txId}`;
    this.prepared.set(signedTx, { txId, payload: tx });
    return { txId, signedTx };
  }

  async broadcast(signedTx: string): Promise<void> {
    const known = this.prepared.get(signedTx);
    if (!known) throw new Error(`FakeChainClient: unknown signedTx "${signedTx}"`);
    this.broadcasts.push(signedTx);
    await this.broadcastHook?.(signedTx);
    if (this.broadcastOutcome === 'timeout') {
      if (this.timeoutLands) this.land(known);
      throw new BroadcastTimeoutError();
    }
    if (this.broadcastOutcome === 'fail') {
      throw new Error('FakeChainClient: chain rejected the broadcast');
    }
    this.land(known);
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    return this.landed.get(txId) ?? null;
  }

  /** Distinct txIds currently on chain — the set of on-chain anchors. */
  distinctTxIds(): string[] {
    return [...this.landed.keys()];
  }

  private land(known: { txId: string; payload: AnchorPayload }): void {
    if (this.landed.has(known.txId)) return; // same txId is one on-chain tx
    const receipt: ChainReceipt = {
      txId: known.txId,
      status: this.receiptStatus,
      blockNumber: BigInt(this.blockHeight),
      logIndex: 0,
    };
    this.blockHeight += 1;
    this.landed.set(known.txId, receipt);
  }
}
