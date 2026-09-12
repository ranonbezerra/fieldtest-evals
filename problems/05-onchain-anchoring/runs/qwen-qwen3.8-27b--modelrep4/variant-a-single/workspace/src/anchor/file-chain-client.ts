import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AnchorTx, ChainClient, PreparedTx, TxReceipt } from './chain-client.js';

interface StoredTx {
  txId: string;
  signedTx: string;
  blockNumber: number;
  status: 'success' | 'failure';
}

interface ChainState {
  txs: StoredTx[];
  nextBlock: number;
}

/**
 * Deterministic, file-backed stand-in for the L2 client (no real keys or
 * RPC). Used for local runs of the app and by tests that need chain state to
 * survive across processes:
 *
 * - prepare() derives txId/signedTx deterministically from the tx, so the
 *   same tx always recovers the same identity
 * - broadcast() appends the tx to a JSON state file, idempotent by txId
 * - getReceipt() reports the stored block
 *
 * Test hook: `crashAfterBroadcast` SIGKILLs the process right after the tx
 * is accepted, simulating a node that dies between broadcast and persistence.
 */
export class FileChainClient implements ChainClient {
  private readonly statePath: string;

  constructor(statePath: string, private readonly opts: { crashAfterBroadcast?: boolean } = {}) {
    this.statePath = statePath;
  }

  async prepare(tx: AnchorTx): Promise<PreparedTx> {
    const txId = `0x${createHash('sha256').update(JSON.stringify(tx)).digest('hex')}`;
    return { txId, signedTx: `sig:${txId}` };
  }

  async broadcast(signedTx: string): Promise<void> {
    const state = this.readState();
    const txId = this.txIdFromSigned(signedTx);
    if (!state.txs.some((stored) => stored.txId === txId)) {
      state.txs.push({ txId, signedTx, blockNumber: state.nextBlock, status: 'success' });
      state.nextBlock += 1;
      this.writeState(state);
    }
    if (this.opts.crashAfterBroadcast) {
      // A genuine, uncatchable crash: nothing after this line runs.
      process.kill(process.pid, 'SIGKILL');
    }
  }

  async getReceipt(txId: string): Promise<TxReceipt | null> {
    const stored = this.readState().txs.find((entry) => entry.txId === txId);
    return stored ? { txId: stored.txId, blockNumber: stored.blockNumber, status: stored.status } : null;
  }

  private txIdFromSigned(signedTx: string): string {
    // The fake "signature" carries the txId verbatim, mirroring the real
    // client's deterministic signing.
    return signedTx.replace(/^sig:/, '');
  }

  private readState(): ChainState {
    try {
      return JSON.parse(readFileSync(this.statePath, 'utf8')) as ChainState;
    } catch {
      return { txs: [], nextBlock: 1 };
    }
  }

  private writeState(state: ChainState): void {
    mkdirSync(dirname(this.statePath), { recursive: true });
    writeFileSync(this.statePath, JSON.stringify(state, null, 2));
  }
}
