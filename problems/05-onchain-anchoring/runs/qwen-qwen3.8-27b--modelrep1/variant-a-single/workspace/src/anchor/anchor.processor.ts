import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository.js';
import { CHAIN_CLIENT } from './chain-client.interface.js';
import type { ChainClient } from './chain-client.interface.js';

export const ANCHOR_PROCESSOR_OPTIONS = 'ANCHOR_PROCESSOR_OPTIONS';

export interface AnchorProcessorOptions {
  enabled: boolean;
  confirmationIntervalMs: number;
  recoveryIntervalMs: number;
  recoveryMinAgeMs: number;
  batchLimit: number;
}

/** Reads the worker configuration from environment variables only. */
export function processorOptionsFromEnv(): AnchorProcessorOptions {
  const positiveInt = (raw: string | undefined, fallback: number): number => {
    const n = raw === undefined ? Number.NaN : Number(raw);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  const nonNegativeInt = (raw: string | undefined, fallback: number): number => {
    const n = raw === undefined ? Number.NaN : Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : fallback;
  };
  return {
    enabled: process.env.ANCHOR_WORKER_ENABLED !== 'false',
    confirmationIntervalMs: positiveInt(process.env.ANCHOR_CONFIRMATION_INTERVAL_MS, 5_000),
    recoveryIntervalMs: positiveInt(process.env.ANCHOR_RECOVERY_INTERVAL_MS, 30_000),
    recoveryMinAgeMs: nonNegativeInt(process.env.ANCHOR_RECOVERY_MIN_AGE_MS, 5_000),
    batchLimit: positiveInt(process.env.ANCHOR_WORKER_BATCH_LIMIT, 50),
  };
}

export interface ConfirmationTickResult {
  checked: number;
  confirmed: number;
  failed: number;
}

export interface RecoverySweepResult {
  checked: number;
  confirmed: number;
  rebroadcast: number;
  failed: number;
}

/**
 * Confirmation worker + recovery sweep.
 *
 * - The confirmation worker polls receipts for anchors whose send was
 *   recorded and advances them to 'confirmed'.
 * - The recovery sweep resolves anchors stuck in broadcast-limbo — the
 *   broadcast timed out with an unknown outcome, or the process died between
 *   the broadcast and the post-broadcast persistence. It queries the chain
 *   FIRST: if the tx is already mined the anchor is confirmed and the tx is
 *   NOT re-sent; only when the chain does not have the tx does the sweep
 *   re-broadcast the stored signed payload.
 */
@Injectable()
export class AnchorProcessor implements OnModuleInit, OnModuleDestroy {
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(AnchorRepository) private readonly anchors: AnchorRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    @Inject(ANCHOR_PROCESSOR_OPTIONS) private readonly options: AnchorProcessorOptions,
  ) {}

  onModuleInit(): void {
    if (!this.options.enabled) return;
    this.timers.push(
      setInterval(() => {
        void this.runConfirmationTick().catch((err: unknown) =>
          console.error('[anchor-processor] confirmation tick failed', err),
        );
      }, this.options.confirmationIntervalMs),
    );
    this.timers.push(
      setInterval(() => {
        void this.runRecoverySweep().catch((err: unknown) =>
          console.error('[anchor-processor] recovery sweep failed', err),
        );
      }, this.options.recoveryIntervalMs),
    );
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  async runConfirmationTick(): Promise<ConfirmationTickResult> {
    const rows = await this.anchors.findPendingSent(this.options.batchLimit);
    const result: ConfirmationTickResult = { checked: rows.length, confirmed: 0, failed: 0 };
    for (const row of rows) {
      try {
        const receipt = await this.chain.getReceipt(row.txId);
        if (receipt !== null && (await this.anchors.confirm(row.id, receipt.blockNumber))) {
          result.confirmed += 1;
        }
      } catch (err) {
        result.failed += 1;
        console.error(`[anchor-processor] receipt lookup failed for ${row.id} (txId ${row.txId})`, err);
      }
    }
    return result;
  }

  async runRecoverySweep(): Promise<RecoverySweepResult> {
    const cutoff = new Date(Date.now() - this.options.recoveryMinAgeMs);
    const rows = await this.anchors.findStalePending(cutoff, this.options.batchLimit);
    const result: RecoverySweepResult = { checked: rows.length, confirmed: 0, rebroadcast: 0, failed: 0 };
    for (const row of rows) {
      try {
        // Chain first: the tx may already be on chain (e.g. the process
        // crashed after the chain recorded it but before we persisted the send).
        const receipt = await this.chain.getReceipt(row.txId);
        if (receipt !== null) {
          if (await this.anchors.confirm(row.id, receipt.blockNumber)) result.confirmed += 1;
        } else {
          await this.chain.broadcast(row.signedTx);
          await this.anchors.markBroadcast(row.id);
          result.rebroadcast += 1;
        }
      } catch (err) {
        result.failed += 1;
        console.error(`[anchor-processor] recovery failed for ${row.id} (txId ${row.txId})`, err);
      }
    }
    return result;
  }
}
