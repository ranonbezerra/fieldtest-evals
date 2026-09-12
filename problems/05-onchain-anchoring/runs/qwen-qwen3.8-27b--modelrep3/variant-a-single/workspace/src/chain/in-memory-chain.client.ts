import { createHash } from 'node:crypto';
import { canonicalHash } from '../common/canonicalize.js';
import { AnchorTxPayload, ChainClient, ChainReceipt, ChainRejectionError, PreparedTx } from './chain.client.js';

export interface InMemoryChainTx {
  txId: string;
  signedTx: string;
  payload: AnchorTxPayload;
  broadcastCount: number;
}

export interface InMemoryChainOptions {
  /** Runs before a tx is recorded on the chain. If it throws (e.g. a simulated RPC timeout), the tx never lands. */
  onBroadcastAttempt?: (signedTx: string) => void;
  /** Runs after a tx is recorded on the chain. If it throws, it simulates the local process dying right after the tx went out. */
  onBroadcastRecorded?: (tx: InMemoryChainTx) => void;
  /** > 0: auto-finalize broadcast txs into blocks after this many ms (standalone runs). Tests drive settle() manually. */
  autoFinalizeMs?: number;
}

interface StoredTx extends InMemoryChainTx {
  receipt: ChainReceipt | null;
}

/**
 * Deterministic local L2 emulator: same payload ⇒ same txId, so re-broadcasting
 * a signed tx is always idempotent, exactly as on a real chain with a
 * deterministic tx identity.
 */
export class InMemoryChainClient implements ChainClient {
  onBroadcastAttempt?: (signedTx: string) => void;
  onBroadcastRecorded?: (tx: InMemoryChainTx) => void;
  autoFinalizeMs = 0;

  readonly broadcastLog: string[] = [];
  private readonly txs = new Map<string, StoredTx>();
  private nextBlockNumber = 1;

  constructor(options: InMemoryChainOptions = {}) {
    Object.assign(this, options);
  }

  async prepare(payload: AnchorTxPayload): Promise<PreparedTx> {
    const txId = canonicalHash(payload); // deterministic tx identity
    const signedTx = JSON.stringify({ v: 1, txId, payload, sig: 'in-memory-emulator' });
    if (!this.txs.has(txId)) {
      this.txs.set(txId, { txId, signedTx, payload, broadcastCount: 0, receipt: null });
    }
    return { txId, signedTx };
  }

  async broadcast(signedTx: string): Promise<void> {
    this.onBroadcastAttempt?.(signedTx);
    const parsed = JSON.parse(signedTx) as { txId: string };
    const tx = this.txs.get(parsed.txId);
    if (!tx) throw new ChainRejectionError(`unknown txId ${parsed.txId}`);
    this.broadcastLog.push(signedTx);
    tx.broadcastCount += 1;
    this.onBroadcastRecorded?.(tx);
    if (this.autoFinalizeMs > 0) {
      setTimeout(() => void this.settle(), this.autoFinalizeMs).unref?.();
    }
  }

  /** Emulate chain progression: every broadcast tx without a receipt is included in a new block (or fails). */
  async settle(txIdsToFail: string[] = []): Promise<void> {
    for (const tx of this.txs.values()) {
      if (tx.receipt || tx.broadcastCount === 0) continue; // never reached the chain
      if (txIdsToFail.includes(tx.txId)) {
        tx.receipt = { txId: tx.txId, status: 'failed', failureReason: 'simulated on-chain failure' };
      } else {
        const blockNumber = this.nextBlockNumber++;
        const blockHash = createHash('sha256').update(`block:${blockNumber}`).digest('hex');
        tx.receipt = { txId: tx.txId, status: 'confirmed', blockNumber, blockHash };
      }
    }
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    return this.txs.get(txId)?.receipt ?? null;
  }
}
