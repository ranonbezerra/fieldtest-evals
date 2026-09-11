import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CHAIN_CLIENT, type ChainClient, type ChainReceipt } from './chain-client.js';
import { AnchoringRepository } from './anchoring.repository.js';
import { ANCHORING_CONFIG, type AnchoringConfig } from './anchoring.config.js';

/**
 * The confirmation worker polls receipts and advances broadcast-sent anchors.
 *
 * broadcast() returning is NOT a confirmation — only a receipt with a success
 * status is. This worker never re-broadcasts: resolving broadcast limbo
 * (PREPARED / BROADCAST_UNKNOWN / stale SENT) is the recovery sweep's job.
 */
@Injectable()
export class ConfirmationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConfirmationWorker.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly anchors: AnchoringRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    @Inject(ANCHORING_CONFIG) private readonly config: AnchoringConfig,
  ) {}

  onModuleInit(): void {
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(): void {
    if (!this.config.enabled || this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.confirmationPollMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async tick(): Promise<void> {
    try {
      const report = await this.runOnce();
      if (report.checked > 0) {
        this.logger.log(`checked=${report.checked} confirmed=${report.confirmed} failed=${report.failed}`);
      }
    } catch (err) {
      this.logger.error(`confirmation tick failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** One polling pass over broadcast-sent anchors. Also usable directly (tests, manual runs). */
  async runOnce(): Promise<{ checked: number; confirmed: number; failed: number }> {
    const report = { checked: 0, confirmed: 0, failed: 0 };
    const sent = await this.anchors.findByStatus('BROADCAST_SENT', undefined, this.config.batchSize);

    for (const anchor of sent) {
      report.checked += 1;

      let receipt: ChainReceipt | null;
      try {
        receipt = await this.chain.getReceipt(anchor.txId);
      } catch (err) {
        // The chain is unreachable: skip; the next poll retries.
        this.logger.warn(`getReceipt(${anchor.txId}) failed: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      if (!receipt) {
        continue; // Still no receipt: not confirmed yet.
      }

      if (receipt.status === 'success') {
        const done = await this.anchors.transition(anchor.id, 'BROADCAST_SENT', {
          status: 'CONFIRMED',
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          confirmedAt: new Date(),
          lastError: null,
        });
        if (done) {
          report.confirmed += 1;
        }
      } else {
        const done = await this.anchors.transition(anchor.id, 'BROADCAST_SENT', {
          status: 'FAILED',
          lastError: 'receipt reports the transaction failed',
        });
        if (done) {
          report.failed += 1;
        }
      }
    }

    return report;
  }
}
