import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { BroadcastTimeoutError, CHAIN_CLIENT } from '../chain/chain-client.js';
import type { ChainClient } from '../chain/chain-client.js';
import { AnchoringRepository } from './anchoring.repository.js';

/**
 * Background processor with two phases, run on a fixed interval:
 *
 *  - poll():  the confirmation worker — checks receipts for anchors whose
 *             broadcast was accepted and advances them to confirmed/failed.
 *  - sweep(): the recovery sweep — for anchors stuck in broadcast limbo
 *             (including intents that were persisted but never broadcast,
 *             e.g. after a process crash), it QUERIES THE CHAIN FIRST and
 *             only re-broadcasts the same signed tx (same tx identity,
 *             idempotent on chain) when the chain has no trace of it.
 *
 * Configuration (environment variables):
 *  - ANCHOR_WORKER_INTERVAL_MS    (default 1000)
 *  - ANCHOR_STUCK_AFTER_MS        (default 30000)
 *  - ANCHOR_MAX_BROADCAST_ATTEMPTS (default 5)
 */
@Injectable()
export class AnchoringWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly intervalMs: number;
  private readonly stuckAfterMs: number;
  private readonly maxAttempts: number;

  constructor(
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    @Inject(AnchoringRepository) private readonly anchors: AnchoringRepository,
  ) {
    this.intervalMs = Number(process.env.ANCHOR_WORKER_INTERVAL_MS ?? 1000);
    this.stuckAfterMs = Number(process.env.ANCHOR_STUCK_AFTER_MS ?? 30_000);
    this.maxAttempts = Number(process.env.ANCHOR_MAX_BROADCAST_ATTEMPTS ?? 5);
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.poll();
      await this.sweep();
    } catch (error) {
      console.error('[anchoring-worker] tick failed', error);
    } finally {
      this.running = false;
    }
  }

  /** Confirmation worker: poll receipts and advance state. */
  async poll(): Promise<void> {
    const rows = await this.anchors.findInFlight();
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId);
      if (!receipt) continue;
      if (receipt.status === 'success') {
        await this.anchors.markConfirmed(row.id, receipt.blockNumber, receipt.logIndex);
      } else {
        await this.anchors.markFailed(row.id, `chain reported receipt status "${receipt.status}" for tx ${row.txId}`);
      }
    }
  }

  /** Recovery sweep: resolve broadcast limbo, querying the chain first. */
  async sweep(): Promise<void> {
    const olderThan = new Date(Date.now() - this.stuckAfterMs);
    const rows = await this.anchors.findStuck(olderThan);
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId); // chain first
      if (receipt) {
        if (receipt.status === 'success') {
          await this.anchors.markConfirmed(row.id, receipt.blockNumber, receipt.logIndex);
        } else {
          await this.anchors.markFailed(row.id, `chain reported receipt status "${receipt.status}" for tx ${row.txId}`);
        }
        continue;
      }

      // No trace on chain: re-send the SAME signed tx (same tx identity).
      const nextAttempts = row.attempts + 1;
      try {
        await this.chain.broadcast(row.signedTx);
        await this.anchors.markBroadcastSent(row.id, nextAttempts);
      } catch (error) {
        if (error instanceof BroadcastTimeoutError) {
          await this.anchors.markBroadcastUnknown(row.id, nextAttempts);
          if (nextAttempts >= this.maxAttempts) {
            await this.anchors.markFailed(row.id, `broadcast attempts exhausted after ${nextAttempts} attempts`);
          }
        } else {
          await this.anchors.markFailed(row.id, `broadcast failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
}
