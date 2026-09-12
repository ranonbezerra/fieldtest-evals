import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { AnchorTxInput, ChainClient, ChainTxReceipt, PreparedTx } from '../../src/anchor/chain-client.interface.js';

export interface FakeChainClientOptions {
  /** Block number of the first tx this fake mines (default: 100). */
  startingBlock?: number;
  /** If true, prepare() rejects (the chain is unreachable). */
  failPrepare?: boolean;
  /** If true, broadcast() rejects with a timeout; the outcome is unknown to the caller. */
  failBroadcast?: boolean;
  /** If true, broadcast txs are not mined until mine() is called. */
  deferMining?: boolean;
  /** Kill the process right after the tx is recorded on chain (simulates a crash between broadcast and post-broadcast persistence). */
  crashAfterBroadcast?: boolean;
  /** If set, the chain state (txId -> blockNumber) is written to this file after each broadcast. */
  writeChainStateTo?: string;
  /** Seeds existing chain state, e.g. from a file written by a crashed process. */
  seedChainState?: Record<string, number>;
}

/**
 * In-memory L2 fake implementing the ChainClient contract.
 *
 * prepare() is deterministic, so the same (documentId, version, contentHash)
 * always yields the same txId across instances; the signed payload embeds the
 * txId so independent instances (e.g. one constructed after a simulated
 * crash) can address the same chain state.
 */
export class FakeChainClient implements ChainClient {
  private readonly blocks = new Map<string, number>();
  private readonly broadcastCounts = new Map<string, number>();
  private nextBlock: number;

  constructor(private readonly options: FakeChainClientOptions = {}) {
    this.nextBlock = options.startingBlock ?? 100;
    for (const [txId, blockNumber] of Object.entries(options.seedChainState ?? {})) {
      this.blocks.set(txId, blockNumber);
    }
  }

  get broadcastTotal(): number {
    return [...this.broadcastCounts.values()].reduce((sum, n) => sum + n, 0);
  }

  broadcastsOf(signedTx: string): number {
    return this.broadcastCounts.get(signedTx) ?? 0;
  }

  async prepare(tx: AnchorTxInput): Promise<PreparedTx> {
    if (this.options.failPrepare) {
      throw new Error('fake chain: prepare failed (unreachable)');
    }
    const txId =
      '0x' + createHash('sha256').update(`anchor-v1|${tx.documentId}|${tx.version}|${tx.contentHash}`).digest('hex');
    return { txId, signedTx: `sig:${txId}` };
  }

  async broadcast(signedTx: string): Promise<void> {
    this.broadcastCounts.set(signedTx, (this.broadcastCounts.get(signedTx) ?? 0) + 1);
    if (this.options.failBroadcast) {
      throw new Error('fake chain: broadcast timed out (unknown outcome)');
    }
    const txId = this.txIdOf(signedTx);
    if (!this.options.deferMining) this.mine(txId);
    this.persistChainState();
    if (this.options.crashAfterBroadcast) {
      // Simulate the process being killed right after the chain recorded the
      // tx, before the service persists the post-broadcast state.
      const crash = (process as unknown as { crash?: () => void }).crash;
      if (typeof crash === 'function') crash();
      process.exit(137);
    }
  }

  async getReceipt(txId: string): Promise<ChainTxReceipt | null> {
    const blockNumber = this.blocks.get(txId);
    return blockNumber === undefined ? null : { txId, blockNumber };
  }

  /** Manually mines a previously broadcast (deferred) tx. */
  mine(txId: string): void {
    if (!this.blocks.has(txId)) this.blocks.set(txId, this.nextBlock++);
  }

  private txIdOf(signedTx: string): string {
    if (!signedTx.startsWith('sig:')) {
      throw new Error(`fake chain: unrecognised signed tx "${signedTx}"`);
    }
    return signedTx.slice('sig:'.length);
  }

  private persistChainState(): void {
    const file = this.options.writeChainStateTo;
    if (file === undefined) return;
    writeFileSync(file, JSON.stringify(Object.fromEntries(this.blocks)));
  }
}
