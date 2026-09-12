import { createHash } from 'node:crypto';
import type { AnchorTxInput, ChainClient, ChainReceipt, PreparedTx } from './chain.client';

const SIGNATURE_PREFIX = 'fake-signature:';

/**
 * In-memory L2 for tests and local runs. The ledger lives on this object, so
 * a test can pass the same instance into a "restarted" app to model a process
 * crash: the chain (and everything it already received) survives the process.
 */
export class FakeChainClient implements ChainClient {
  /** Mine a broadcast synchronously as soon as it reaches the chain. */
  autoMine = false;

  /** txIds in broadcast-call order (duplicates included). */
  readonly broadcastLog: string[] = [];

  private readonly mined = new Map<string, ChainReceipt>();
  private readonly mempool = new Set<string>();
  private nextBlock = 100;
  private _holdBroadcasts = false;
  private heldReleases: Array<() => void> = [];
  private broadcastWaiters: Array<{ txId: string; resolve: () => void }> = [];
  private pendingBroadcastFailure: { error: Error; reachedChain: boolean } | null = null;

  // --- test knobs ----------------------------------------------------------

  /** Broadcast calls reach the chain but their ack never arrives (a hang). */
  holdBroadcasts(): void {
    this._holdBroadcasts = true;
  }

  releaseHeldBroadcasts(): void {
    for (const release of this.heldReleases.splice(0)) release();
  }

  /**
   * The next broadcast throws `error`; `reachedChain` says whether the tx
   * nonetheless landed (unknown outcome) or never left the process.
   */
  failNextBroadcast(error: Error, reachedChain: boolean): void {
    this.pendingBroadcastFailure = { error, reachedChain };
  }

  /** Resolves once a broadcast for `txId` has reached the chain. */
  whenBroadcast(txId: string): Promise<void> {
    if (this.broadcastLog.includes(txId)) return Promise.resolve();
    return new Promise<void>((resolve) => this.broadcastWaiters.push({ txId, resolve: () => resolve() }));
  }

  // --- ChainClient ----------------------------------------------------------

  async prepare(input: AnchorTxInput): Promise<PreparedTx> {
    // Deterministic by construction: same input => same txId => same signedTx.
    const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const txId = `0x${digest.slice(0, 40)}`;
    return { txId, signedTx: `${SIGNATURE_PREFIX}${txId}` };
  }

  async broadcast(signedTx: string): Promise<void> {
    const txId = signedTx.slice(SIGNATURE_PREFIX.length);
    const failure = this.pendingBroadcastFailure;
    this.pendingBroadcastFailure = null;

    if (!failure || failure.reachedChain) {
      this.mempool.add(txId);
      if (this.autoMine) this.mine(txId);
    }
    this.broadcastLog.push(txId);
    this.notifyBroadcast(txId);

    if (failure) throw failure.error;

    if (this._holdBroadcasts) {
      await new Promise<void>((resolve) => this.heldReleases.push(() => resolve()));
    }
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    return this.mined.get(txId) ?? null;
  }

  // --- chain lifecycle (test helpers) ----------------------------------------

  /** Mine everything currently in the mempool into one block. */
  advanceBlock(): void {
    for (const txId of [...this.mempool]) this.mine(txId);
  }

  mine(txId: string): void {
    if (!this.mempool.has(txId)) return;
    const blockNumber = this.nextBlock++;
    this.mempool.delete(txId);
    this.mined.set(txId, { txId, blockNumber, blockHash: `0xblock${blockNumber.toString(16)}` });
  }

  // --- inspection -------------------------------------------------------------

  broadcastCount(): number {
    return this.broadcastLog.length;
  }

  distinctBroadcasts(): number {
    return new Set(this.broadcastLog).size;
  }

  minedTxIds(): string[] {
    return [...this.mined.keys()];
  }

  isMined(txId: string): boolean {
    return this.mined.has(txId);
  }

  private notifyBroadcast(txId: string): void {
    this.broadcastWaiters = this.broadcastWaiters.filter((waiter) => {
      if (waiter.txId === txId) {
        waiter.resolve();
        return false;
      }
      return true;
    });
  }
}
