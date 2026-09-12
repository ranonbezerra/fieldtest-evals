import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AnchorState } from '@prisma/client';
import { loadConfig } from '../config';
import { AnchorRepository } from './anchor.repository';
import { CHAIN_CLIENT, type ChainClient } from './chain.client';

/**
 * Polls the chain for receipts of acknowledged broadcasts (BROADCASTING) and
 * advances them to CONFIRMED. Limbo (PENDING) anchors are the recovery
 * sweep's job — they may not have reached the chain at all.
 */
@Injectable()
export class AnchorConfirmationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnchorConfirmationWorker.name);
  private readonly config = loadConfig();
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;

  constructor(
    @Inject(AnchorRepository) private readonly anchors: AnchorRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick().catch((err: unknown) =>
        this.logger.error(`confirmation tick failed: ${err instanceof Error ? err.message : String(err)}`),
      );
    }, this.config.confirmationIntervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One confirmation pass; timer-driven in production, direct in tests. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const anchors = await this.anchors.listByStates([AnchorState.BROADCASTING], this.config.batchSize);
      for (const anchor of anchors) {
        try {
          const receipt = await this.chain.getReceipt(anchor.txId);
          if (receipt) {
            const { count } = await this.anchors.confirm(anchor.id, receipt.blockNumber, receipt.blockHash);
            if (count > 0) this.logger.log(`confirmed ${anchor.documentId}@v${anchor.version} in block ${receipt.blockNumber}`);
          }
        } catch (err) {
          this.logger.warn(
            `receipt poll failed for ${anchor.documentId}@v${anchor.version}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } finally {
      this.ticking = false;
    }
  }
}
