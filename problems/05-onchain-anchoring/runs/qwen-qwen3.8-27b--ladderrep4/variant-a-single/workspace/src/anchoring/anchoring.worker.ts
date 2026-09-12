import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ANCHORING_CONFIG, type AnchoringConfig } from './anchoring.config.js';
import { CHAIN_CLIENT, type ChainClient } from './chain-client.js';
import { AnchoringRepository } from './anchoring.repository.js';
import { attemptBroadcast } from './broadcast.js';

const PAGE_SIZE = 100;
const LIMBO_STATES = ['prepared', 'broadcast_unknown'] as const;

/**
 * Confirmation worker + recovery sweep.
 *
 * Confirmation: `broadcast_sent` anchors are polled for a receipt and advanced
 * to `confirmed`/`failed`. Confirmation always comes from a receipt, never
 * from broadcast() returning.
 *
 * Recovery: anchors stuck in broadcast-limbo (`prepared`, `broadcast_unknown`)
 * are resolved by querying the chain FIRST. If a receipt exists, the anchor is
 * confirmed from it — no re-broadcast. Only when the chain has no trace is the
 * SAME signed tx re-broadcast (never a new one, so a re-send cannot become a
 * second anchor).
 */
@Injectable()
export class AnchoringWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AnchoringWorker.name);
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly repo: AnchoringRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    @Inject(ANCHORING_CONFIG) private readonly config: AnchoringConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.confirmationPollMs > 0) {
      this.timers.push(setInterval(() => void this.runConfirmationPass(), this.config.confirmationPollMs));
    }
    if (this.config.recoverySweepMs > 0) {
      this.timers.push(setInterval(() => void this.runRecoveryPass(), this.config.recoverySweepMs));
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
  }

  /** One confirmation pass: poll receipts and advance broadcast-sent anchors. */
  async runConfirmationPass(): Promise<void> {
    const rows = await this.repo.listByStatuses(['broadcast_sent'], PAGE_SIZE);
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId);
      if (!receipt) continue;
      const advanced = await this.repo.transition(
        row.id,
        ['broadcast_sent'],
        receipt.status === 'success' ? 'confirmed' : 'failed',
        { blockNumber: receipt.blockNumber, receipt },
      );
      if (advanced) {
        this.logger.log(`anchor ${row.id} ${receipt.status === 'success' ? 'confirmed' : 'failed'} at block ${receipt.blockNumber}`);
      }
    }
  }

  /** One recovery pass: resolve anchors stuck in broadcast-limbo, chain first. */
  async runRecoveryPass(): Promise<void> {
    const stuckBefore = new Date(Date.now() - this.config.stuckAfterMs);
    const rows = await this.repo.listStuck([...LIMBO_STATES], stuckBefore, PAGE_SIZE);
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId);
      if (receipt) {
        // The tx landed (e.g. despite a broadcast timeout): confirm from the
        // receipt. Never re-broadcast.
        const advanced = await this.repo.transition(
          row.id,
          [...LIMBO_STATES],
          receipt.status === 'success' ? 'confirmed' : 'failed',
          { blockNumber: receipt.blockNumber, receipt },
        );
        if (advanced) this.logger.log(`recovered anchor ${row.id} from chain receipt, block ${receipt.blockNumber}`);
        continue;
      }
      // No trace on chain: re-broadcast the same signed transaction. (If two
      // workers race, the chain deduplicates by tx identity — one anchor.)
      const outcome = await attemptBroadcast(this.chain, row.signedTx, this.config.broadcastTimeoutMs);
      const advanced = await this.repo.transition(
        row.id,
        [...LIMBO_STATES],
        outcome === 'sent' ? 'broadcast_sent' : 'broadcast_unknown',
        { incrementBroadcastAttempts: true },
      );
      if (advanced) this.logger.log(`re-broadcast signed tx of anchor ${row.id} (no trace on chain)`);
    }
  }
}
