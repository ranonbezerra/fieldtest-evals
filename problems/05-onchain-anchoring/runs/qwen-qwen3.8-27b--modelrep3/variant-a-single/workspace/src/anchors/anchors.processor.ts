import { Inject, Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { CHAIN_CLIENT, ChainClient, ChainReceipt, ChainRejectionError } from '../chain/chain.client.js';
import { AnchorsRepository } from './anchors.repository.js';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  }
  return value;
}

/**
 * Confirmation worker + recovery sweep.
 *  - runConfirmationPoll: polls receipts for every non-terminal anchor and
 *    advances CONFIRMED/FAILED as soon as the chain reports.
 *  - runRecoverySweep: resolves anchors stuck in broadcast-limbo (crash, lost
 *    broadcast) by querying the chain FIRST — only when the chain has no record
 *    of the tx does it re-broadcast the same signed tx (deterministic txId ⇒
 *    idempotent, it can never create a second anchor).
 */
@Injectable()
export class AnchorsProcessor implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly workerIntervalMs: number;
  private readonly staleAfterMs: number;
  private readonly maxBroadcastAttempts: number;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly anchors: AnchorsRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
  ) {
    this.workerIntervalMs = envInt('ANCHOR_WORKER_INTERVAL_MS', 5000);
    this.staleAfterMs = envInt('ANCHOR_STALE_AFTER_MS', 30_000);
    this.maxBroadcastAttempts = envInt('ANCHOR_MAX_BROADCAST_ATTEMPTS', 5);
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.tick(), this.workerIntervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    await this.runConfirmationPoll();
    await this.runRecoverySweep();
  }

  /** Poll receipts for anchors awaiting confirmation and advance their state. */
  async runConfirmationPoll(): Promise<void> {
    const pending = await this.anchors.findNonTerminal();
    for (const row of pending) {
      await this.applyReceipt(row.id, await this.chain.getReceipt(row.txId));
    }
  }

  /** Resolve anchors stuck in broadcast-limbo by querying the chain first. */
  async runRecoverySweep(): Promise<void> {
    const staleBefore = new Date(Date.now() - this.staleAfterMs);
    const stale = await this.anchors.findNonTerminalStale(staleBefore);
    for (const row of stale) {
      // Query the chain first: the tx may already be on chain (crash after broadcast).
      const receipt = await this.chain.getReceipt(row.txId);
      if (receipt) {
        await this.applyReceipt(row.id, receipt);
        continue;
      }
      if (row.attempt >= this.maxBroadcastAttempts) {
        await this.anchors.markFailed(row.id, `no receipt after ${row.attempt} broadcast attempts (broadcast limbo exhausted)`);
        continue;
      }
      // Not on chain: (re)broadcast the same signed tx — deterministic txId
      // makes this idempotent.
      try {
        await this.chain.broadcast(row.signedTx);
      } catch (err) {
        if (err instanceof ChainRejectionError) {
          await this.anchors.markFailed(row.id, `chain rejected the transaction: ${err.message}`);
          continue;
        }
        // Unknown again: keep it in limbo, retry on the next sweep.
      }
      await this.anchors.recordBroadcastAttempt(row.id);
    }
  }

  private async applyReceipt(id: string, receipt: ChainReceipt | null): Promise<void> {
    if (!receipt) return;
    if (receipt.status === 'confirmed') {
      await this.anchors.markConfirmed(id, receipt.blockNumber, receipt.blockHash);
    } else {
      await this.anchors.markFailed(id, receipt.failureReason ?? 'transaction failed on chain');
    }
  }
}
