import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  AnchorTxPayload,
  BroadcastRejectionError,
  BroadcastTimeoutError,
  ChainClient,
  ChainReceipt,
  PreparedTx,
} from './chain-client.js';

interface BroadcastLogEntry {
  txId: string;
  signedTx: string;
  at: string;
}

interface StoredReceipt {
  outcome: 'confirmed' | 'failed';
  blockNumber: string;
  blockHash: string;
  failureReason?: string;
}

interface FakeChainState {
  broadcasts: BroadcastLogEntry[];
  receipts: Record<string, StoredReceipt>;
}

export type ScriptedBroadcastOutcome = 'ok' | 'timeout' | 'timeout-not-landed' | 'reject';

/**
 * Deterministic fake of the chain client.
 *
 * State (broadcast log + receipts) lives in memory by default. Pass `stateFile`
 * to persist it to disk so it survives a process restart — modelling the fact
 * that a real chain's state is external to any single process. The
 * crash-recovery test relies on this: a child process "dies" after the fake
 * chain has accepted the transaction, and the restarted process sees the same
 * chain state.
 */
export class FakeChainClient implements ChainClient {
  private readonly state: FakeChainState;
  private readonly stateFile: string | undefined;
  private scripted: ScriptedBroadcastOutcome[] = [];
  private rejectionReason = 'simulated node rejection';

  /**
   * Invoked after the fake chain has accepted a broadcast (i.e. the chain now
   * has the transaction) and before the outcome is delivered to the caller.
   * Tests use this to kill the process mid-flight.
   */
  onBroadcast?: (txId: string) => void | Promise<void>;

  constructor(options: { stateFile?: string } = {}) {
    this.stateFile = options.stateFile;
    this.state =
      options.stateFile !== undefined && existsSync(options.stateFile)
        ? (JSON.parse(readFileSync(options.stateFile, 'utf8')) as FakeChainState)
        : { broadcasts: [], receipts: {} };
  }

  /** Queue the outcome of the next broadcast(s). Default (no script) is 'ok'. */
  scriptBroadcast(outcome: ScriptedBroadcastOutcome, rejectionReason?: string): void {
    this.scripted.push(outcome);
    if (rejectionReason !== undefined) this.rejectionReason = rejectionReason;
  }

  get broadcastLog(): readonly BroadcastLogEntry[] {
    return this.state.broadcasts;
  }

  broadcastCountFor(txId: string): number {
    return this.state.broadcasts.filter((entry) => entry.txId === txId).length;
  }

  /** Simulate chain inclusion with a success outcome. */
  confirmTx(txId: string, blockNumber: bigint = 1_000n): void {
    this.state.receipts[txId] = {
      outcome: 'confirmed',
      blockNumber: blockNumber.toString(),
      blockHash: `0x${sha256Hex(`${txId}:block:${blockNumber}`)}`,
    };
    this.persist();
  }

  /** Simulate chain inclusion with a failure outcome (in a block, but failed). */
  failTx(txId: string, failureReason = 'transaction reverted', blockNumber: bigint = 1_000n): void {
    this.state.receipts[txId] = {
      outcome: 'failed',
      blockNumber: blockNumber.toString(),
      blockHash: `0x${sha256Hex(`${txId}:block:${blockNumber}`)}`,
      failureReason,
    };
    this.persist();
  }

  async prepare(tx: AnchorTxPayload): Promise<PreparedTx> {
    // Local and deterministic: the same payload always produces the same identity.
    const canonical = JSON.stringify(tx, Object.keys(tx).sort());
    const txId = `0x${sha256Hex(canonical)}`;
    return { txId, signedTx: `fake-signed:${txId}` };
  }

  async broadcast(signedTx: string): Promise<void> {
    const outcome = this.scripted.shift() ?? 'ok';
    const txId = this.txIdFromSignedTx(signedTx);

    if (outcome === 'timeout-not-landed') {
      // The request was lost in flight: the chain has no record of it at all.
      throw new BroadcastTimeoutError();
    }

    // The chain accepted the transaction. Acceptance happens regardless of
    // whether the response to us arrives (that is the 'timeout' case).
    this.state.broadcasts.push({ txId, signedTx, at: new Date().toISOString() });
    this.persist();
    if (this.onBroadcast) await this.onBroadcast(txId);

    if (outcome === 'timeout') throw new BroadcastTimeoutError();
    if (outcome === 'reject') throw new BroadcastRejectionError(this.rejectionReason);
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    const stored = this.state.receipts[txId];
    if (!stored) return null;
    return {
      txId,
      outcome: stored.outcome,
      blockNumber: BigInt(stored.blockNumber),
      blockHash: stored.blockHash,
      ...(stored.failureReason !== undefined ? { failureReason: stored.failureReason } : {}),
    };
  }

  private txIdFromSignedTx(signedTx: string): string {
    const prefix = 'fake-signed:';
    return signedTx.startsWith(prefix) ? signedTx.slice(prefix.length) : '0xunknown';
  }

  private persist(): void {
    if (this.stateFile) writeFileSync(this.stateFile, JSON.stringify(this.state));
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
