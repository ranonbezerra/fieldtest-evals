import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CHAIN_CLIENT, type ChainClient, type ChainReceipt } from './chain-client.js';
import { AnchoringRepository } from './anchoring.repository.js';
import { ANCHORING_CONFIG, type AnchoringConfig } from './anchoring.config.js';

/**
 * The recovery sweep resolves anchors stuck in broadcast limbo
 * (PREPARED, BROADCAST_UNKNOWN) and broadcast-sent anchors that have gone
 * stale.
 *
 * The order is the whole point of issue #143:
 *   1. Ask the chain FIRST — getReceipt(txId). The tx identity was written
 *      ahead of the broadcast, so we always know what to ask for.
 *   2. If the chain has the tx, finalize from the receipt (confirmed or
 *      failed). Nothing is re-broadcast.
 *   3. Only when the chain has no trace is the SAME signed transaction
 *      re-broadcast — never a fresh one — so a re-send cannot become a
 *      second anchor.
 */
@Injectable()
export class RecoverySweep implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecoverySweep.name);
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
    }, this.config.recoveryPollMs);
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
      if (report.swept > 0) {
        this.logger.log(
          `swept=${report.swept} confirmed=${report.confirmed} failed=${report.failed} rebroadcast=${report.rebroadcast} pending=${report.pending}`,
        );
      }
    } catch (err) {
      this.logger.error(`recovery sweep tick failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** One sweep pass. Also usable directly (tests, manual runs). */
  async runOnce(): Promise<{ swept: number; confirmed: number; failed: number; rebroadcast: number; pending: number }> {
    const staleBefore = new Date(Date.now() - this.config.staleAfterMs);
    const limbo = [
      ...(await this.anchors.findByStatus('PREPARED', undefined, this.config.batchSize)),
      ...(await this.anchors.findByStatus('BROADCAST_UNKNOWN', undefined, this.config.batchSize)),
      ...(await this.anchors.findByStatus('BROADCAST_SENT', staleBefore, this.config.batchSize)),
    ];

    const report = { swept: 0, confirmed: 0, failed: 0, rebroadcast: 0, pending: 0 };

    for (const anchor of limbo) {
      report.swept += 1;

      // 1) Chain first.
      let receipt: ChainReceipt | null;
      try {
        receipt = await this.chain.getReceipt(anchor.txId);
      } catch (err) {
        // The chain is unreachable: do not act blind; the next sweep retries.
        this.logger.warn(`getReceipt(${anchor.txId}) failed: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      if (receipt) {
        if (receipt.status === 'success') {
          const done = await this.anchors.transition(anchor.id, anchor.status, {
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
          const done = await this.anchors.transition(anchor.id, anchor.status, {
            status: 'FAILED',
            lastError: 'receipt reports the transaction failed',
          });
          if (done) {
            report.failed += 1;
          }
        }
        continue;
      }

      // 2) No trace on chain: re-broadcast the same signed transaction.
      try {
        await this.chain.broadcast(anchor.signedTx);
        const done = await this.anchors.transition(anchor.id, anchor.status, {
          status: 'BROADCAST_SENT',
          broadcastAt: new Date(),
          lastError: null,
          incrementAttempts: true,
        });
        if (done) {
          report.rebroadcast += 1;
        }
      } catch (err) {
        const done = await this.anchors.transition(anchor.id, anchor.status, {
          status: 'BROADCAST_UNKNOWN',
          lastError: `re-broadcast failed: ${err instanceof Error ? err.message : String(err)}`,
          incrementAttempts: true,
        });
        if (done) {
          report.pending += 1;
        }
      }
    }

    return report;
  }
}
